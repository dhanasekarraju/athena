"""
ATHENA AI Engine - Technical Indicators
Computes RSI, MACD, EMA(9/21/50/200), Bollinger Bands, ATR, VWAP,
volume analysis, support/resistance and candlestick pattern flags
from OHLCV candle data.

Input: pandas.DataFrame with columns [open, high, low, close, volume, timestamp]
sorted ascending by time.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
import ta


class TechnicalIndicators:
    def __init__(self, df: pd.DataFrame):
        if df.empty or len(df) < 210:
            # Some indicators (EMA200) need enough history; we still compute
            # what's possible but flag insufficient_data.
            self.insufficient_data = len(df) < 210
        else:
            self.insufficient_data = False
        self.df = df.copy().reset_index(drop=True)

    def compute_all(self) -> pd.DataFrame:
        df = self.df

        # --- RSI (14) ---
        df["rsi"] = ta.momentum.RSIIndicator(close=df["close"], window=14).rsi()

        # --- MACD (12,26,9) ---
        macd = ta.trend.MACD(close=df["close"], window_slow=26, window_fast=12, window_sign=9)
        df["macd"] = macd.macd()
        df["macd_signal"] = macd.macd_signal()
        df["macd_hist"] = macd.macd_diff()

        # --- EMAs ---
        df["ema_9"] = ta.trend.EMAIndicator(close=df["close"], window=9).ema_indicator()
        df["ema_21"] = ta.trend.EMAIndicator(close=df["close"], window=21).ema_indicator()
        df["ema_50"] = ta.trend.EMAIndicator(close=df["close"], window=50).ema_indicator()
        df["ema_200"] = ta.trend.EMAIndicator(close=df["close"], window=200).ema_indicator()

        # --- Bollinger Bands (20, 2std) ---
        bb = ta.volatility.BollingerBands(close=df["close"], window=20, window_dev=2)
        df["bb_upper"] = bb.bollinger_hband()
        df["bb_lower"] = bb.bollinger_lband()
        df["bb_mid"] = bb.bollinger_mavg()
        df["bb_pct_b"] = bb.bollinger_pband()

        # --- ATR (14) ---
        df["atr"] = ta.volatility.AverageTrueRange(
            high=df["high"], low=df["low"], close=df["close"], window=14
        ).average_true_range()

        # --- VWAP (session-based, resets not applied here; rolling VWAP) ---
        typical_price = (df["high"] + df["low"] + df["close"]) / 3
        cum_vol = df["volume"].cumsum().replace(0, np.nan)
        df["vwap"] = (typical_price * df["volume"]).cumsum() / cum_vol

        # --- Volume analysis ---
        df["volume_sma_20"] = df["volume"].rolling(20).mean()
        df["volume_ratio"] = df["volume"] / df["volume_sma_20"]
        df["volume_above_avg"] = df["volume_ratio"] > 1.0

        # --- Support & Resistance (rolling swing highs/lows, 20-period) ---
        window = 20
        df["resistance"] = df["high"].rolling(window).max()
        df["support"] = df["low"].rolling(window).min()

        # --- Candlestick pattern flags (lightweight, rule-based) ---
        df = self._candlestick_patterns(df)

        self.df = df
        return df

    @staticmethod
    def _candlestick_patterns(df: pd.DataFrame) -> pd.DataFrame:
        body = (df["close"] - df["open"]).abs()
        candle_range = (df["high"] - df["low"]).replace(0, np.nan)
        upper_wick = df["high"] - df[["close", "open"]].max(axis=1)
        lower_wick = df[["close", "open"]].min(axis=1) - df["low"]

        df["pattern_doji"] = (body / candle_range) < 0.1
        df["pattern_hammer"] = (lower_wick > 2 * body) & (upper_wick < body)
        df["pattern_shooting_star"] = (upper_wick > 2 * body) & (lower_wick < body)

        prev_open = df["open"].shift(1)
        prev_close = df["close"].shift(1)
        df["pattern_bullish_engulfing"] = (
            (prev_close < prev_open) &
            (df["close"] > df["open"]) &
            (df["close"] > prev_open) &
            (df["open"] < prev_close)
        )
        df["pattern_bearish_engulfing"] = (
            (prev_close > prev_open) &
            (df["close"] < df["open"]) &
            (df["close"] < prev_open) &
            (df["open"] > prev_close)
        )
        return df

    def latest(self) -> dict:
        """Return the most recent row of indicators as a dict, NaN-safe."""
        if self.df.empty:
            return {}
        row = self.df.iloc[-1].to_dict()
        return {k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in row.items()}
