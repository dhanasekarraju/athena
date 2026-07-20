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
  /** Timeframes that agree with trend (e.g. ["1m","5m","15m"]). Empty when unknown. */
  frames?: string[];
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
    const obj = JSON.parse(cleaned) as {
      trend?: string;
      strength?: number;
      reason?: string;
      frames?: unknown;
    };
    const trend = String(obj.trend ?? "").toLowerCase();
    if (trend !== "up" && trend !== "down" && trend !== "chop") return null;
    const strength = Math.max(0, Math.min(100, Number(obj.strength ?? 0)));
    const frames = normalizeFrames(obj.frames);
    return {
      trend,
      strength: Number.isFinite(strength) ? strength : 0,
      reason: String(obj.reason ?? "").slice(0, 200),
      source: "gemini",
      frames,
    };
  } catch {
    return null;
  }
}

function normalizeFrames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(["1m", "5m", "15m"]);
  const out: string[] = [];
  for (const x of raw) {
    const f = String(x).toLowerCase().trim();
    if (allowed.has(f) && !out.includes(f)) out.push(f);
  }
  return out;
}

/** 1m+5m = actionable momentum; 15m lags and must not block entries. */
export function hasCoreMomentum(frames: string[] | undefined): boolean {
  const f = frames ?? [];
  return f.includes("1m") && f.includes("5m");
}

/** Does the verdict allow entering in this direction? Fail-open on "unavailable". */
export function verdictAllows(
  direction: "BUY_CALL" | "BUY_PUT",
  verdict: TrendVerdict,
  opts?: { requireCoreFrames?: boolean },
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

  const frames = verdict.frames ?? [];
  const core = hasCoreMomentum(frames);
  const mustCheckCore = opts?.requireCoreFrames || frames.length > 0;

  if (mustCheckCore && !core) {
    // Cached replies without frames: high strength ≈ model saw 1m+5m agree.
    if (frames.length === 0 && verdict.strength >= 65) {
      return { ok: true, why: `trend ${verdict.trend} (${verdict.strength}) agrees` };
    }
    return {
      ok: false,
      why: `needs 1m+5m momentum (15m lags; got ${frames.join("+") || "none"}) — ${verdict.reason}`,
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

  // Horizons match the bot's actual hold time (10-45 min): 1m/5m are the
  // heartbeat, 15m is the widest context. Anything slower (1h/4h) answers a
  // swing-trading question the bot never asks.
  const [m1, m5, m15] = await Promise.all([
    fetchCloses(pair, "1m", 60), // last hour, minute by minute
    fetchCloses(pair, "5m", 48), // last 4 hours
    fetchCloses(pair, "15m", 48), // last 12 hours
  ]);

  const prompt = [
    `You are a senior professional crypto trader running an institutional options desk. You have traded BTC and ETH through every market regime and your desk's edge is discipline: you never force a trade, you protect capital first, and you know option buyers bleed to theta in sideways markets.`,
    `Judge whether ${symbol}/USD is tradeable with long options (calls or puts) over the NEXT 15-60 MINUTES. Positions are held 10-45 minutes, so the 1m and 5m series matter most; 15m is context only.`,
    seriesLine("1m", m1),
    seriesLine("5m", m5),
    seriesLine("15m", m15),
    `Classify the current tradeable trend:`,
    `- "up": clear short-term upward momentum a call buyer could ride within the hour`,
    `- "down": clear short-term downward momentum a put buyer could ride within the hour`,
    `- "chop": sideways / whipsaw — 1m and 5m conflict, or both flat/ranging`,
    `HARD RULE (options are fast — 15m LAGS): answer "up" or "down" when 1m AND 5m clearly agree on direction. A flat or opposite 15m must NOT downgrade to chop — by the time 15m confirms, momentum is often gone.`,
    `Answer "chop" only when 1m and 5m disagree OR both show no directional momentum.`,
    `In "frames", list timeframes that agree with your trend. For up/down you MUST include both "1m" and "5m". Include "15m" only if it also agrees; omit it when flat/opposite.`,
    `In the reason, say e.g. "1m+5m up, 15m flat".`,
    `Be conservative on chop (conflicting 1m vs 5m), but do NOT wait for 15m to call a trend.`,
    `Respond with ONLY this JSON, no markdown: {"trend":"up"|"down"|"chop","strength":<0-100 integer conviction>,"frames":["1m","5m"],"reason":"<max 15 words>"}`,
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
