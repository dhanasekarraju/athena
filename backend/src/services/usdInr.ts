import type { FastifyBaseLogger } from "fastify";
import { env } from "../utils/env.js";

interface Cache {
  rate: number;
  fetchedAt: number;
  source: string;
}

let cache: Cache | null = null;
const TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Live USD/INR with TTL. Falls back to env.USD_INR_RATE.
 * Warns when configured env rate drifts >2% from live.
 */
export async function getUsdInrRate(log?: FastifyBaseLogger): Promise<{
  rate: number;
  source: string;
  warned?: string;
}> {
  const configured = env.USD_INR_RATE;
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return maybeWarn(configured, cache.rate, cache.source, log);
  }

  try {
    // Frankfurter (ECB) — free, no key
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: { INR?: number } };
      const live = Number(data.rates?.INR);
      if (Number.isFinite(live) && live > 0) {
        cache = { rate: live, fetchedAt: now, source: "frankfurter" };
        return maybeWarn(configured, live, "frankfurter", log);
      }
    }
  } catch (err) {
    log?.warn({ err }, "USD/INR live fetch failed — using configured rate");
  }

  cache = { rate: configured, fetchedAt: now, source: "env" };
  return { rate: configured, source: "env" };
}

function maybeWarn(
  configured: number,
  live: number,
  source: string,
  log?: FastifyBaseLogger,
): { rate: number; source: string; warned?: string } {
  // Prefer live for sizing when available
  const rate = source === "env" ? configured : live;
  let warned: string | undefined;
  if (source !== "env" && configured > 0) {
    const drift = Math.abs(live - configured) / configured;
    if (drift > 0.02) {
      warned = `USD_INR_RATE ${configured} is ${(drift * 100).toFixed(1)}% off live ${live.toFixed(2)}`;
      log?.warn({ configured, live, drift }, warned);
    }
  }
  return { rate, source, warned };
}
