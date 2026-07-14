"""
ATHENA AI Engine - FastAPI service

Responsibilities:
  - Pull public OHLCV candle data (Binance public REST API - no key required)
  - Compute indicators (indicators/technical.py)
  - Generate explainable signals (strategies/signal_engine.py)
  - Expose REST endpoints consumed by the Node backend
  - Stream live signal updates over WebSocket

Run: uvicorn api.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations
import asyncio
import os
from typing import Optional

import httpx
import pandas as pd
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from indicators.technical import TechnicalIndicators
from strategies.signal_engine import SignalEngine
from sentiment.sentiment import SentimentEngine

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
SYMBOLS = {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "SOL": "SOLUSDT"}
TIMEFRAMES = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h"}

app = FastAPI(title="ATHENA AI Engine", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

sentiment_engine = SentimentEngine()
_prev_macd_hist_cache: dict[str, float] = {}
_ws_clients: set[WebSocket] = set()


async def fetch_klines(symbol: str, interval: str, limit: int = 300) -> pd.DataFrame:
    params = {"symbol": SYMBOLS[symbol], "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(BINANCE_KLINES_URL, params=params)
        resp.raise_for_status()
        raw = resp.json()
    df = pd.DataFrame(raw, columns=[
        "open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_asset_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
    ])
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)
    df["timestamp"] = pd.to_datetime(df["open_time"], unit="ms")
    return df[["timestamp", "open", "high", "low", "close", "volume"]]


async def build_signal(symbol: str, timeframe: str, news_score: float = 0.0):
    df = await fetch_klines(symbol, TIMEFRAMES[timeframe])
    ti = TechnicalIndicators(df)
    computed = ti.compute_all()
    latest = ti.latest()

    cache_key = f"{symbol}:{timeframe}"
    prev_hist = _prev_macd_hist_cache.get(cache_key)
    engine = SignalEngine(news_sentiment_score=news_score)
    signal = engine.generate(symbol, timeframe, latest, prev_macd_hist=prev_hist)

    if latest.get("macd_hist") is not None:
        _prev_macd_hist_cache[cache_key] = latest["macd_hist"]

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "direction": signal.direction,
        "confidence": signal.confidence,
        "risk_level": signal.risk_level,
        "entry_range": {"low": signal.entry_low, "high": signal.entry_high},
        "target_1": signal.target_1,
        "target_2": signal.target_2,
        "stop_loss": signal.stop_loss,
        "reasons": signal.reasons,
        "factor_breakdown": signal.factor_breakdown,
        "price": latest.get("close"),
        "insufficient_data": ti.insufficient_data,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/signals/{symbol}")
async def get_signal(symbol: str, timeframe: str = "15m"):
    symbol = symbol.upper()
    if symbol not in SYMBOLS:
        return {"error": f"Unsupported symbol {symbol}"}
    if timeframe not in TIMEFRAMES:
        return {"error": f"Unsupported timeframe {timeframe}"}
    return await build_signal(symbol, timeframe)


@app.get("/market/prices")
async def market_prices():
    out = {}
    for sym in SYMBOLS:
        df = await fetch_klines(sym, "1m", limit=2)
        out[sym] = float(df.iloc[-1]["close"])
    return out


@app.get("/sentiment/fear-greed")
async def fear_greed():
    return await sentiment_engine.fear_greed_index()


@app.post("/sentiment/news")
async def news_sentiment(headlines: list[str]):
    return sentiment_engine.score_headlines(headlines)


@app.websocket("/ws/signals")
async def ws_signals(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        while True:
            # Client can request a symbol/timeframe pair; server pushes back the signal.
            msg = await websocket.receive_json()
            symbol = msg.get("symbol", "BTC").upper()
            timeframe = msg.get("timeframe", "15m")
            if symbol in SYMBOLS and timeframe in TIMEFRAMES:
                signal = await build_signal(symbol, timeframe)
                await websocket.send_json({"type": "signal", "data": signal})
    except WebSocketDisconnect:
        _ws_clients.discard(websocket)


async def broadcast_loop():
    """Background loop: recompute BTC/ETH/SOL 5m signals every 30s and push to all clients."""
    while True:
        await asyncio.sleep(30)
        if not _ws_clients:
            continue
        for sym in SYMBOLS:
            try:
                signal = await build_signal(sym, "5m")
            except Exception:
                continue
            dead = set()
            for ws in _ws_clients:
                try:
                    await ws.send_json({"type": "signal", "data": signal})
                except Exception:
                    dead.add(ws)
            _ws_clients.difference_update(dead)


@app.on_event("startup")
async def on_startup():
    asyncio.create_task(broadcast_loop())
