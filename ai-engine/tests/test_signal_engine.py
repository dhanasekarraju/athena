import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strategies.signal_engine import SignalEngine


def test_buy_call_on_strong_bullish_indicators():
    engine = SignalEngine(news_sentiment_score=0.3)
    indicators = {
        "close": 100, "vwap": 98,
        "rsi": 28,
        "macd": 0.5, "macd_signal": 0.2, "macd_hist": 0.3,
        "ema_9": 101, "ema_21": 99, "ema_50": 97, "ema_200": 90,
        "volume_ratio": 1.8, "volume_above_avg": True,
        "bb_pct_b": 0.02,
        "support": 95, "resistance": 110,
        "atr": 2.0,
    }
    signal = engine.generate("BTC", "15m", indicators, prev_macd_hist=-0.1)
    assert signal.direction == "BUY_CALL"
    assert signal.confidence > 0
    assert signal.target_1 > signal.entry_high
    assert signal.stop_loss < signal.entry_low


def test_buy_put_on_strong_bearish_indicators():
    engine = SignalEngine(news_sentiment_score=-0.3)
    indicators = {
        "close": 100, "vwap": 102,
        "rsi": 72,
        "macd": -0.5, "macd_signal": -0.2, "macd_hist": -0.3,
        "ema_9": 99, "ema_21": 101, "ema_50": 103, "ema_200": 110,
        "volume_ratio": 1.8, "volume_above_avg": True,
        "bb_pct_b": 0.98,
        "support": 90, "resistance": 105,
        "atr": 2.0,
    }
    signal = engine.generate("BTC", "15m", indicators, prev_macd_hist=0.1)
    assert signal.direction == "BUY_PUT"
    assert signal.target_1 < signal.entry_low
    assert signal.stop_loss > signal.entry_high


def test_hold_on_neutral_indicators():
    engine = SignalEngine(news_sentiment_score=0.0)
    indicators = {
        "close": 100, "vwap": 100,
        "rsi": 50,
        "macd": 0.0, "macd_signal": 0.0, "macd_hist": 0.0,
        "ema_9": 100, "ema_21": 100, "ema_50": 100, "ema_200": 100,
        "volume_ratio": 0.9, "volume_above_avg": False,
        "bb_pct_b": 0.5,
        "support": 95, "resistance": 105,
        "atr": 1.0,
    }
    signal = engine.generate("BTC", "15m", indicators, prev_macd_hist=0.0)
    assert signal.direction == "HOLD"
