"""
ATHENA AI Engine - Sentiment module
Fetches Fear & Greed Index and scores crypto news headlines for
bullish/bearish sentiment using a lightweight lexicon approach
(swap in a transformer model later if needed).
"""

from __future__ import annotations
import httpx
from typing import Optional

FEAR_GREED_URL = "https://api.alternative.me/fng/?limit=1"

BULLISH_WORDS = {
    "surge", "rally", "bullish", "breakout", "adoption", "approval", "inflow",
    "record", "high", "gain", "soar", "upgrade", "partnership", "buy",
}
BEARISH_WORDS = {
    "crash", "plunge", "bearish", "selloff", "ban", "hack", "exploit", "outflow",
    "low", "loss", "drop", "downgrade", "lawsuit", "sell", "liquidation",
}


class SentimentEngine:
    def __init__(self, client: Optional[httpx.AsyncClient] = None):
        self._client = client

    async def fear_greed_index(self) -> dict:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(FEAR_GREED_URL)
            resp.raise_for_status()
            data = resp.json()["data"][0]
            return {
                "value": int(data["value"]),
                "classification": data["value_classification"],
                "timestamp": data["timestamp"],
            }

    def score_headline(self, headline: str) -> float:
        """Return a score from -1 (bearish) to +1 (bullish) for one headline."""
        text = headline.lower()
        bull_hits = sum(1 for w in BULLISH_WORDS if w in text)
        bear_hits = sum(1 for w in BEARISH_WORDS if w in text)
        total = bull_hits + bear_hits
        if total == 0:
            return 0.0
        return (bull_hits - bear_hits) / total

    def score_headlines(self, headlines: list[str]) -> dict:
        if not headlines:
            return {"score": 0.0, "label": "Neutral", "count": 0}
        scores = [self.score_headline(h) for h in headlines]
        avg = sum(scores) / len(scores)
        label = "Bullish" if avg > 0.15 else "Bearish" if avg < -0.15 else "Neutral"
        return {"score": round(avg, 3), "label": label, "count": len(headlines)}

    async def whale_alerts(self, min_usd: float = 1_000_000) -> list[dict]:
        """
        Placeholder for whale-tracking integration (e.g. Whale Alert API).
        Requires an API key at runtime — wired via WHALE_ALERT_API_KEY env var
        in api/main.py. Returns [] until configured.
        """
        return []
