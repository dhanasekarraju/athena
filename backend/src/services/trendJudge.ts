import type { FastifyBaseLogger } from "fastify";
import { env } from "../utils/env.js";

/**
 * Gemini-based trend judge.
 *
 * Rule-based signals can't tell a trend from chop — that caused the whipsaw
 * stop-out streaks. Before every auto-entry we ask Gemini to classify the
 * tradeable trend from multi-timeframe closes. Entries must agree with the
 * trend; "chop" blocks entirely.
 *
 * Fail-open by design: if the key is missing, the API errors, or the response
 * is unparseable, the verdict source is "unavailable" and the caller allows
 * the trade. The judge can only ever block, never place orders.
 */

export interface TrendVerdict {
  trend: "up" | "down" | "chop";
  /** 0-100, model's conviction in the classification */
  strength: number;
  reason: string;
  source: "gemini" | "unavailable";
}

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";
const PAIRS: Record<string, string> = { BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT" };

interface CacheEntry {
  verdict: TrendVerdict;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Parse the model's JSON reply into a verdict. Returns null when malformed. */
export function parseVerdict(text: string): TrendVerdict | null {
  try {
    // Models sometimes wrap JSON in markdown fences despite instructions.
    const cleaned = text.replace(/```(?:json)?/g, "").trim();
    const obj = JSON.parse(cleaned) as { trend?: string; strength?: number; reason?: string };
    const trend = String(obj.trend ?? "").toLowerCase();
    if (trend !== "up" && trend !== "down" && trend !== "chop") return null;
    const strength = Math.max(0, Math.min(100, Number(obj.strength ?? 0)));
    return {
      trend,
      strength: Number.isFinite(strength) ? strength : 0,
      reason: String(obj.reason ?? "").slice(0, 200),
      source: "gemini",
    };
  } catch {
    return null;
  }
}

/** Does the verdict allow entering in this direction? Fail-open on "unavailable". */
export function verdictAllows(
  direction: "BUY_CALL" | "BUY_PUT",
  verdict: TrendVerdict,
): { ok: boolean; why: string } {
  if (verdict.source === "unavailable") {
    return { ok: true, why: "trend judge unavailable — allowing" };
  }
  if (verdict.trend === "chop") {
    return { ok: false, why: `market is chop (${verdict.strength}) — ${verdict.reason}` };
  }
  const wanted = direction === "BUY_CALL" ? "up" : "down";
  if (verdict.trend !== wanted) {
    return {
      ok: false,
      why: `trend is ${verdict.trend} (${verdict.strength}), signal wants ${wanted} — ${verdict.reason}`,
    };
  }
  return { ok: true, why: `trend ${verdict.trend} (${verdict.strength}) agrees` };
}

async function fetchCloses(pair: string, interval: string, limit: number): Promise<number[]> {
  const url = `${BINANCE_KLINES}?symbol=${pair}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Binance klines ${interval} -> ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((row) => Number(row[4]));
}

function seriesLine(label: string, closes: number[]): string {
  const first = closes[0];
  const last = closes[closes.length - 1];
  const pct = ((last - first) / first) * 100;
  const compact = closes.map((c) => +c.toPrecision(6));
  return `${label} closes (oldest→newest, ${pct.toFixed(2)}% over window): ${compact.join(",")}`;
}

async function askGemini(symbol: string, log: FastifyBaseLogger): Promise<TrendVerdict | null> {
  const pair = PAIRS[symbol];
  if (!pair || !env.GEMINI_API_KEY) return null;

  const [m15, h1, h4] = await Promise.all([
    fetchCloses(pair, "15m", 48),
    fetchCloses(pair, "1h", 48),
    fetchCloses(pair, "4h", 42),
  ]);

  const prompt = [
    `You judge whether ${symbol}/USD is tradeable with long options (calls or puts) over the next 1-4 hours.`,
    seriesLine("15m", m15),
    seriesLine("1h", h1),
    seriesLine("4h", h4),
    `Classify the current tradeable trend:`,
    `- "up": clear upward momentum a call buyer could ride`,
    `- "down": clear downward momentum a put buyer could ride`,
    `- "chop": sideways / conflicting timeframes / whipsaw conditions where option buyers bleed premium`,
    `Be conservative: when in doubt, answer "chop".`,
    `Respond with ONLY this JSON, no markdown: {"trend":"up"|"down"|"chop","strength":<0-100 integer conviction>,"reason":"<max 15 words>"}`,
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.TREND_JUDGE_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text();
    log.warn({ status: res.status, body: body.slice(0, 300) }, "TrendJudge: Gemini request failed");
    return null;
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const verdict = parseVerdict(text);
  if (!verdict) {
    log.warn({ text: text.slice(0, 300) }, "TrendJudge: unparseable Gemini reply");
  }
  return verdict;
}

export async function getTrendVerdict(
  symbol: string,
  log: FastifyBaseLogger,
): Promise<TrendVerdict> {
  const sym = symbol.toUpperCase();
  const hit = cache.get(sym);
  if (hit && hit.expiresAt > Date.now()) return hit.verdict;

  let verdict: TrendVerdict | null = null;
  try {
    verdict = await askGemini(sym, log);
  } catch (err) {
    log.warn({ err, symbol: sym }, "TrendJudge: error — failing open");
  }

  const final: TrendVerdict = verdict ?? {
    trend: "chop",
    strength: 0,
    reason: "judge unavailable",
    source: "unavailable",
  };
  // Cache failures briefly too, so an outage doesn't hammer the API.
  const ttl = verdict ? env.TREND_JUDGE_TTL_MS : 60_000;
  cache.set(sym, { verdict: final, expiresAt: Date.now() + ttl });
  if (verdict) {
    log.info(
      { symbol: sym, trend: final.trend, strength: final.strength, reason: final.reason },
      "TrendJudge verdict",
    );
  }
  return final;
}
