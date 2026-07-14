"""
ATHENA AI Engine - Signal Strategy Engine

Implements the weighted confidence scoring model and BUY CALL / BUY PUT / HOLD
rules, and produces a fully explainable signal object.

Weights (must sum to 100):
  RSI                 20%
  MACD                20%
  EMA trend           20%
  Volume              15%
  Bollinger Bands     10%
  Support/Resistance  10%
  News sentiment       5%
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional
import math

Direction = Literal["BUY_CALL", "BUY_PUT", "HOLD"]
RiskLevel = Literal["Low", "Medium", "High"]

WEIGHTS = {
    "rsi": 0.20,
    "macd": 0.20,
    "ema_trend": 0.20,
    "volume": 0.15,
    "bollinger": 0.10,
    "support_resistance": 0.10,
    "news_sentiment": 0.05,
}


@dataclass
class FactorScore:
    name: str
    bullish_score: float  # 0..1, how strongly this factor favors BUY CALL
    bearish_score: float  # 0..1, how strongly this factor favors BUY PUT
    reason: Optional[str] = None


@dataclass
class Signal:
    symbol: str
    timeframe: str
    direction: Direction
    confidence: float
    risk_level: RiskLevel
    entry_low: float
    entry_high: float
    target_1: float
    target_2: float
    stop_loss: float
    reasons: list[str] = field(default_factory=list)
    factor_breakdown: dict = field(default_factory=dict)


class SignalEngine:
    def __init__(self, news_sentiment_score: float = 0.0):
        """
        news_sentiment_score: -1 (very bearish) .. +1 (very bullish)
        """
        self.news_sentiment_score = news_sentiment_score

    # ---------- individual factor scorers ----------

    def _score_rsi(self, rsi: float) -> FactorScore:
        if rsi is None or math.isnan(rsi):
            return FactorScore("RSI", 0, 0, None)
        if rsi < 35:
            strength = min(1.0, (35 - rsi) / 35)
            return FactorScore("RSI", strength, 0, f"RSI oversold ({rsi:.1f})")
        if rsi > 65:
            strength = min(1.0, (rsi - 65) / 35)
            return FactorScore("RSI", 0, strength, f"RSI overbought ({rsi:.1f})")
        return FactorScore("RSI", 0, 0, f"RSI neutral ({rsi:.1f})")

    def _score_macd(self, macd: float, macd_signal: float, macd_hist: float,
                     prev_hist: Optional[float]) -> FactorScore:
        if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in [macd, macd_signal, macd_hist]):
            return FactorScore("MACD", 0, 0, None)
        crossed_up = prev_hist is not None and prev_hist <= 0 < macd_hist
        crossed_down = prev_hist is not None and prev_hist >= 0 > macd_hist
        if crossed_up or (macd > macd_signal and macd_hist > 0):
            strength = 1.0 if crossed_up else 0.6
            label = "MACD bullish crossover" if crossed_up else "MACD bullish (above signal)"
            return FactorScore("MACD", strength, 0, label)
        if crossed_down or (macd < macd_signal and macd_hist < 0):
            strength = 1.0 if crossed_down else 0.6
            label = "MACD bearish crossover" if crossed_down else "MACD bearish (below signal)"
            return FactorScore("MACD", 0, strength, label)
        return FactorScore("MACD", 0, 0, "MACD flat")

    def _score_ema_trend(self, ema9: float, ema21: float, ema50: float, ema200: float) -> FactorScore:
        vals = [ema9, ema21, ema50, ema200]
        if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in vals):
            return FactorScore("EMA trend", 0, 0, None)
        if ema9 > ema21 > ema50:
            strength = 1.0 if ema50 > ema200 else 0.7
            return FactorScore("EMA trend", strength, 0, "EMA 9 > EMA 21 (bullish stack)")
        if ema9 < ema21 < ema50:
            strength = 1.0 if ema50 < ema200 else 0.7
            return FactorScore("EMA trend", 0, strength, "EMA 9 < EMA 21 (bearish stack)")
        if ema9 > ema21:
            return FactorScore("EMA trend", 0.5, 0, "EMA 9 > EMA 21")
        if ema9 < ema21:
            return FactorScore("EMA trend", 0, 0.5, "EMA 9 < EMA 21")
        return FactorScore("EMA trend", 0, 0, "EMA trend flat")

    def _score_volume(self, volume_ratio: float, price_above_vwap: bool) -> FactorScore:
        if volume_ratio is None or (isinstance(volume_ratio, float) and math.isnan(volume_ratio)):
            return FactorScore("Volume", 0, 0, None)
        above_avg = volume_ratio > 1.0
        if not above_avg:
            return FactorScore("Volume", 0, 0, "Volume below average")
        strength = min(1.0, (volume_ratio - 1.0))
        if price_above_vwap:
            return FactorScore("Volume", strength, 0, "Volume increasing, price above VWAP")
        return FactorScore("Volume", 0, strength, "Volume increasing, price below VWAP")

    def _score_bollinger(self, pct_b: float) -> FactorScore:
        if pct_b is None or (isinstance(pct_b, float) and math.isnan(pct_b)):
            return FactorScore("Bollinger Bands", 0, 0, None)
        if pct_b < 0.05:
            return FactorScore("Bollinger Bands", 1.0, 0, "Price at/below lower Bollinger Band")
        if pct_b > 0.95:
            return FactorScore("Bollinger Bands", 0, 1.0, "Price at/above upper Bollinger Band")
        return FactorScore("Bollinger Bands", 0, 0, "Price within Bollinger Bands")

    def _score_support_resistance(self, price: float, support: float, resistance: float) -> FactorScore:
        if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in [support, resistance]):
            return FactorScore("Support/Resistance", 0, 0, None)
        rng = resistance - support
        if rng <= 0:
            return FactorScore("Support/Resistance", 0, 0, None)
        dist_to_support = (price - support) / rng
        if dist_to_support < 0.1:
            return FactorScore("Support/Resistance", 0.8, 0, "Price near key support")
        if dist_to_support > 0.9:
            return FactorScore("Support/Resistance", 0, 0.8, "Price near key resistance")
        return FactorScore("Support/Resistance", 0, 0, "Price mid-range")

    def _score_news(self) -> FactorScore:
        s = self.news_sentiment_score
        if s > 0.15:
            return FactorScore("News sentiment", min(1.0, s), 0, "Market trend bullish (news sentiment positive)")
        if s < -0.15:
            return FactorScore("News sentiment", 0, min(1.0, -s), "Market trend bearish (news sentiment negative)")
        return FactorScore("News sentiment", 0, 0, "News sentiment neutral")

    # ---------- main entry point ----------

    def generate(self, symbol: str, timeframe: str, indicators: dict, prev_macd_hist: Optional[float] = None) -> Signal:
        price = indicators.get("close")
        vwap = indicators.get("vwap")
        price_above_vwap = bool(price is not None and vwap is not None and price > vwap)

        factors = [
            self._score_rsi(indicators.get("rsi")),
            self._score_macd(
                indicators.get("macd"), indicators.get("macd_signal"),
                indicators.get("macd_hist"), prev_macd_hist,
            ),
            self._score_ema_trend(
                indicators.get("ema_9"), indicators.get("ema_21"),
                indicators.get("ema_50"), indicators.get("ema_200"),
            ),
            self._score_volume(indicators.get("volume_ratio"), price_above_vwap),
            self._score_bollinger(indicators.get("bb_pct_b")),
            self._score_support_resistance(price, indicators.get("support"), indicators.get("resistance")),
            self._score_news(),
        ]

        weight_keys = ["rsi", "macd", "ema_trend", "volume", "bollinger", "support_resistance", "news_sentiment"]
        bullish_total = sum(f.bullish_score * WEIGHTS[k] for f, k in zip(factors, weight_keys))
        bearish_total = sum(f.bearish_score * WEIGHTS[k] for f, k in zip(factors, weight_keys))

        direction: Direction
        confidence: float
        if bullish_total >= bearish_total and bullish_total >= 0.30:
            direction = "BUY_CALL"
            confidence = round(bullish_total * 100, 1)
        elif bearish_total > bullish_total and bearish_total >= 0.30:
            direction = "BUY_PUT"
            confidence = round(bearish_total * 100, 1)
        else:
            direction = "HOLD"
            confidence = round(max(bullish_total, bearish_total) * 100, 1)

        # Hard rule overrides per spec (BUY CALL / BUY PUT criteria)
        rsi = indicators.get("rsi")
        macd_bull_cross = prev_macd_hist is not None and prev_macd_hist <= 0 < (indicators.get("macd_hist") or 0)
        macd_bear_cross = prev_macd_hist is not None and prev_macd_hist >= 0 > (indicators.get("macd_hist") or 0)
        ema9, ema21 = indicators.get("ema_9"), indicators.get("ema_21")
        vol_above_avg = bool(indicators.get("volume_above_avg"))

        strict_buy_call = (
            rsi is not None and rsi < 35 and macd_bull_cross and
            ema9 is not None and ema21 is not None and ema9 > ema21 and
            price_above_vwap and vol_above_avg
        )
        strict_buy_put = (
            rsi is not None and rsi > 65 and macd_bear_cross and
            ema9 is not None and ema21 is not None and ema9 < ema21 and
            not price_above_vwap and vol_above_avg
        )
        if strict_buy_call:
            direction = "BUY_CALL"
            confidence = max(confidence, 85.0)
        elif strict_buy_put:
            direction = "BUY_PUT"
            confidence = max(confidence, 85.0)

        risk_level = self._risk_level(indicators.get("atr"), price, confidence)
        entry_low, entry_high, t1, t2, sl = self._levels(direction, price, indicators.get("atr"))

        reasons = [f.reason for f in factors if f.reason and (f.bullish_score > 0 or f.bearish_score > 0)]
        breakdown = {
            k: {"bullish": round(f.bullish_score, 2), "bearish": round(f.bearish_score, 2), "weight": WEIGHTS[wk]}
            for f, k, wk in zip(factors, [f.name for f in factors], weight_keys)
        }

        return Signal(
            symbol=symbol, timeframe=timeframe, direction=direction, confidence=confidence,
            risk_level=risk_level, entry_low=entry_low, entry_high=entry_high,
            target_1=t1, target_2=t2, stop_loss=sl, reasons=reasons, factor_breakdown=breakdown,
        )

    @staticmethod
    def _risk_level(atr: Optional[float], price: Optional[float], confidence: float) -> RiskLevel:
        if atr is None or price is None or price == 0 or (isinstance(atr, float) and math.isnan(atr)):
            return "Medium"
        volatility_pct = (atr / price) * 100
        if volatility_pct > 3.5 or confidence < 50:
            return "High"
        if volatility_pct > 1.5 or confidence < 70:
            return "Medium"
        return "Low"

    @staticmethod
    def _levels(direction: Direction, price: Optional[float], atr: Optional[float]):
        if price is None:
            return 0, 0, 0, 0, 0
        atr = atr if (atr and not math.isnan(atr)) else price * 0.01

        if direction == "BUY_CALL":
            entry_low, entry_high = price - 0.15 * atr, price + 0.15 * atr
            t1, t2 = price + 1.0 * atr, price + 2.0 * atr
            sl = price - 1.0 * atr
        elif direction == "BUY_PUT":
            entry_low, entry_high = price - 0.15 * atr, price + 0.15 * atr
            t1, t2 = price - 1.0 * atr, price - 2.0 * atr
            sl = price + 1.0 * atr
        else:
            entry_low, entry_high, t1, t2, sl = price, price, price, price, price

        r = lambda x: round(x, 2)
        return r(entry_low), r(entry_high), r(t1), r(t2), r(sl)
