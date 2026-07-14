import { env } from "../utils/env.js";

const BASE = env.AI_ENGINE_URL;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`AI engine request failed: ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const aiEngineClient = {
  getSignal: (symbol: string, timeframe = "15m") =>
    getJson(`/signals/${symbol}?timeframe=${timeframe}`),

  getMarketPrices: () => getJson<Record<string, number>>("/market/prices"),

  getFearGreed: () => getJson("/sentiment/fear-greed"),

  scoreNews: async (headlines: string[]) => {
    const res = await fetch(`${BASE}/sentiment/news`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(headlines),
    });
    if (!res.ok) throw new Error("AI engine news scoring failed");
    return res.json();
  },
};
