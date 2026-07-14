"""
Deribit public options helpers.

Fetches live option book summaries, selects a suitable contract for a
BUY_CALL / BUY_PUT directional signal, and builds a USD premium trade plan.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import httpx

DERIBIT_BOOK_SUMMARY_URL = (
    "https://www.deribit.com/api/v2/public/get_book_summary_by_currency"
)

# BTC-28MAR25-95000-C  /  ETH-4APR25-3500-P
_INSTRUMENT_RE = re.compile(
    r"^(?P<base>[A-Z0-9]+)-(?P<day>\d{1,2})(?P<mon>[A-Z]{3})(?P<year>\d{2})"
    r"-(?P<strike>\d+(?:\.\d+)?)-(?P<cp>[CP])$"
)

_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

OptionSide = Literal["call", "put"]

# In-memory cache: currency -> (expires_at_monotonic, rows)
_BOOK_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL_SEC = 30.0


@dataclass
class ParsedInstrument:
    instrument_name: str
    base: str
    strike: float
    option_type: OptionSide
    expiry: datetime
    days_to_expiry: float


def parse_instrument_name(
    name: str, now: Optional[datetime] = None
) -> Optional[ParsedInstrument]:
    match = _INSTRUMENT_RE.match(name.upper())
    if not match:
        return None
    mon = _MONTHS.get(match.group("mon"))
    if mon is None:
        return None
    year = 2000 + int(match.group("year"))
    day = int(match.group("day"))
    try:
        expiry = datetime(year, mon, day, 8, 0, 0, tzinfo=timezone.utc)
    except ValueError:
        return None
    now = now or datetime.now(timezone.utc)
    dte = (expiry - now).total_seconds() / 86400.0
    return ParsedInstrument(
        instrument_name=name,
        base=match.group("base"),
        strike=float(match.group("strike")),
        option_type="call" if match.group("cp") == "C" else "put",
        expiry=expiry,
        days_to_expiry=dte,
    )


def direction_to_option_type(direction: str) -> Optional[OptionSide]:
    if direction == "BUY_CALL":
        return "call"
    if direction == "BUY_PUT":
        return "put"
    return None


def _coin_to_usd(coin_price: Optional[float], index_price: Optional[float]) -> Optional[float]:
    if coin_price is None or index_price is None:
        return None
    return round(float(coin_price) * float(index_price), 4)


def build_premium_plan(
    premium_usd: float,
    bid_usd: Optional[float] = None,
    ask_usd: Optional[float] = None,
) -> dict[str, float]:
    """Long-option premium plan: TP1 x1.5, TP2 x2.0, SL x0.60."""
    if bid_usd is not None and ask_usd is not None and ask_usd >= bid_usd > 0:
        entry_low, entry_high = bid_usd, ask_usd
        entry_mid = (bid_usd + ask_usd) / 2.0
    else:
        entry_mid = premium_usd
        entry_low = round(premium_usd * 0.97, 4)
        entry_high = round(premium_usd * 1.03, 4)

    return {
        "entry_low": round(entry_low, 4),
        "entry_high": round(entry_high, 4),
        "target_1": round(entry_mid * 1.5, 4),
        "target_2": round(entry_mid * 2.0, 4),
        "stop_loss": round(entry_mid * 0.60, 4),
    }


def select_option_contract(
    rows: list[dict[str, Any]],
    *,
    direction: str,
    spot: float,
    atr: Optional[float] = None,
    now: Optional[datetime] = None,
) -> Optional[dict[str, Any]]:
    """
    Pick a Deribit option for the directional signal.

    Prefer DTE 3–14; else nearest DTE >= 2.
    Target ~0.5–1.5 ATR OTM; tie-break by open interest then tightest spread.
    """
    option_type = direction_to_option_type(direction)
    if option_type is None or spot <= 0:
        return None

    now = now or datetime.now(timezone.utc)
    atr = atr if (atr is not None and atr > 0) else spot * 0.01
    target_otm = spot + (1.0 * atr if option_type == "call" else -1.0 * atr)

    candidates: list[tuple[ParsedInstrument, dict[str, Any]]] = []
    for row in rows:
        name = row.get("instrument_name") or ""
        parsed = parse_instrument_name(name, now=now)
        if parsed is None or parsed.option_type != option_type:
            continue
        if parsed.days_to_expiry < 2:
            continue
        if option_type == "call" and parsed.strike < spot:
            continue
        if option_type == "put" and parsed.strike > spot:
            continue
        mark = row.get("mark_price")
        if mark is None or float(mark) <= 0:
            continue
        candidates.append((parsed, row))

    if not candidates:
        return None

    preferred = [(p, r) for p, r in candidates if 3.0 <= p.days_to_expiry <= 14.0]
    pool = preferred or candidates

    def sort_key(item: tuple[ParsedInstrument, dict[str, Any]]):
        parsed, row = item
        strike_dist = abs(parsed.strike - target_otm)
        oi = float(row.get("open_interest") or 0)
        bid = row.get("bid_price")
        ask = row.get("ask_price")
        spread = (
            float(ask) - float(bid)
            if bid is not None and ask is not None and float(ask) >= float(bid)
            else 1e9
        )
        # Prefer ideal DTE band already filtered; among pool minimize strike distance,
        # then maximize OI, then minimize spread.
        return (strike_dist, -oi, spread)

    parsed, row = min(pool, key=sort_key)
    index_price = row.get("underlying_price") or row.get("estimated_delivery_price") or spot
    try:
        index_price = float(index_price)
    except (TypeError, ValueError):
        index_price = float(spot)

    mark_coin = float(row["mark_price"])
    bid_coin = float(row["bid_price"]) if row.get("bid_price") is not None else None
    ask_coin = float(row["ask_price"]) if row.get("ask_price") is not None else None
    premium_usd = _coin_to_usd(mark_coin, index_price)
    if premium_usd is None or premium_usd <= 0:
        return None

    bid_usd = _coin_to_usd(bid_coin, index_price) if bid_coin is not None else None
    ask_usd = _coin_to_usd(ask_coin, index_price) if ask_coin is not None else None
    mark_iv = row.get("mark_iv")
    try:
        mark_iv_f = float(mark_iv) if mark_iv is not None else None
    except (TypeError, ValueError):
        mark_iv_f = None

    return {
        "venue": "deribit",
        "instrument_name": parsed.instrument_name,
        "option_type": parsed.option_type,
        "strike": parsed.strike,
        "expiry": parsed.expiry.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "days_to_expiry": round(parsed.days_to_expiry, 1),
        "premium_coin": round(mark_coin, 6),
        "premium_usd": premium_usd,
        "mark_iv": mark_iv_f,
        "bid_usd": bid_usd,
        "ask_usd": ask_usd,
        "open_interest": float(row.get("open_interest") or 0),
        "index_price": round(index_price, 2),
    }


async def fetch_book_summary(
    currency: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    currency = currency.upper()
    now = time.monotonic()
    if use_cache and currency in _BOOK_CACHE:
        expires_at, rows = _BOOK_CACHE[currency]
        if now < expires_at:
            return rows

    params = {"currency": currency, "kind": "option"}
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=15)
    assert client is not None
    try:
        resp = await client.get(DERIBIT_BOOK_SUMMARY_URL, params=params)
        resp.raise_for_status()
        payload = resp.json()
        rows = payload.get("result") or []
        if not isinstance(rows, list):
            rows = []
    except Exception:
        rows = []
    finally:
        if owns_client:
            await client.aclose()

    if use_cache:
        _BOOK_CACHE[currency] = (now + _CACHE_TTL_SEC, rows)
    return rows


async def attach_option_plan(
    *,
    symbol: str,
    direction: str,
    spot: float,
    atr: Optional[float],
    client: Optional[httpx.AsyncClient] = None,
) -> tuple[Optional[dict[str, Any]], Optional[dict[str, float]], Optional[str]]:
    """
    Returns (option, premium_plan, extra_reason).
    extra_reason is set when CALL/PUT but no contract could be selected.
    """
    if direction not in ("BUY_CALL", "BUY_PUT"):
        return None, None, None

    rows = await fetch_book_summary(symbol, client=client)
    if not rows:
        return None, None, "No suitable Deribit options contract found"

    option = select_option_contract(
        rows, direction=direction, spot=spot, atr=atr
    )
    if option is None:
        return None, None, "No suitable Deribit options contract found"

    premium_plan = build_premium_plan(
        option["premium_usd"],
        bid_usd=option.get("bid_usd"),
        ask_usd=option.get("ask_usd"),
    )
    return option, premium_plan, None


def clear_book_cache() -> None:
    _BOOK_CACHE.clear()
