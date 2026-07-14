import sys
import os
from datetime import datetime, timezone

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from market.deribit_options import (
    build_premium_plan,
    parse_instrument_name,
    select_option_contract,
)


def test_parse_instrument_name():
    now = datetime(2025, 3, 21, 12, 0, 0, tzinfo=timezone.utc)
    parsed = parse_instrument_name("BTC-28MAR25-96000-C", now=now)
    assert parsed is not None
    assert parsed.strike == 96000
    assert parsed.option_type == "call"
    # Expiry 28 Mar 08:00 UTC from 21 Mar 12:00 => 6d 20h
    assert round(parsed.days_to_expiry, 2) == round(6 + 20 / 24, 2)
    assert parsed.expiry.day == 28


def test_parse_put():
    parsed = parse_instrument_name("ETH-4APR25-3500-P")
    assert parsed is not None
    assert parsed.option_type == "put"
    assert parsed.strike == 3500


def test_select_prefers_dte_band_and_otm():
    now = datetime(2025, 3, 21, 8, 0, 0, tzinfo=timezone.utc)
    rows = [
        # Too near (< 2 DTE) — skip
        {
            "instrument_name": "BTC-22MAR25-96000-C",
            "mark_price": 0.01,
            "bid_price": 0.009,
            "ask_price": 0.011,
            "open_interest": 100,
            "underlying_price": 95000,
            "mark_iv": 0.5,
        },
        # Ideal DTE (~7d) OTM
        {
            "instrument_name": "BTC-28MAR25-96000-C",
            "mark_price": 0.012,
            "bid_price": 0.011,
            "ask_price": 0.013,
            "open_interest": 50,
            "underlying_price": 95000,
            "mark_iv": 0.55,
        },
        # Ideal DTE, farther OTM, higher OI — farther from 1 ATR target
        {
            "instrument_name": "BTC-28MAR25-100000-C",
            "mark_price": 0.005,
            "bid_price": 0.004,
            "ask_price": 0.006,
            "open_interest": 500,
            "underlying_price": 95000,
            "mark_iv": 0.6,
        },
        # ITM call — skip
        {
            "instrument_name": "BTC-28MAR25-90000-C",
            "mark_price": 0.08,
            "open_interest": 999,
            "underlying_price": 95000,
        },
    ]
    # ATR 1000 => target OTM strike ~ 96000
    selected = select_option_contract(
        rows, direction="BUY_CALL", spot=95000, atr=1000, now=now
    )
    assert selected is not None
    assert selected["instrument_name"] == "BTC-28MAR25-96000-C"
    assert selected["strike"] == 96000
    assert selected["option_type"] == "call"
    assert selected["premium_usd"] == round(0.012 * 95000, 4)
    assert selected["venue"] == "deribit"


def test_select_put_otm():
    now = datetime(2025, 3, 21, 8, 0, 0, tzinfo=timezone.utc)
    rows = [
        {
            "instrument_name": "BTC-28MAR25-94000-P",
            "mark_price": 0.01,
            "bid_price": 0.009,
            "ask_price": 0.011,
            "open_interest": 10,
            "underlying_price": 95000,
        },
        {
            "instrument_name": "BTC-28MAR25-96000-P",  # ITM put — skip
            "mark_price": 0.02,
            "open_interest": 999,
            "underlying_price": 95000,
        },
    ]
    selected = select_option_contract(
        rows, direction="BUY_PUT", spot=95000, atr=1000, now=now
    )
    assert selected is not None
    assert selected["instrument_name"] == "BTC-28MAR25-94000-P"


def test_hold_returns_none():
    assert select_option_contract([], direction="HOLD", spot=100, atr=1) is None


def test_empty_chain_returns_none():
    assert select_option_contract([], direction="BUY_CALL", spot=100, atr=1) is None


def test_premium_plan_from_mark():
    plan = build_premium_plan(100.0)
    assert plan["entry_low"] == 97.0
    assert plan["entry_high"] == 103.0
    assert plan["target_1"] == 150.0
    assert plan["target_2"] == 200.0
    assert plan["stop_loss"] == 60.0


def test_premium_plan_from_bid_ask():
    plan = build_premium_plan(100.0, bid_usd=98.0, ask_usd=102.0)
    assert plan["entry_low"] == 98.0
    assert plan["entry_high"] == 102.0
    assert plan["target_1"] == 150.0
    assert plan["stop_loss"] == 60.0
