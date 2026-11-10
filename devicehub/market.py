"""Daily share prices for the ticker bar (Yahoo Finance chart endpoint, Stooq fallback)."""
from __future__ import annotations

import csv
import io
import logging

from .common import http_get, iso, utcnow

log = logging.getLogger("devicehub.market")

YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
STOOQ = "https://stooq.com/q/l/"


def parse_yahoo(data: dict) -> dict | None:
    try:
        res = data["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        return None
    meta = res.get("meta", {})
    closes = [c for c in (res.get("indicators", {}).get("quote", [{}])[0].get("close") or []) if c is not None]
    price = meta.get("regularMarketPrice") or (closes[-1] if closes else None)
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    if len(closes) >= 2:
        prev = closes[-2]
    if price is None:
        return None
    change = ((price - prev) / prev * 100) if prev else None
    return {"price": round(price, 2), "change_pct": round(change, 2) if change is not None else None,
            "currency": meta.get("currency", "")}


def fetch_yahoo(symbol: str) -> dict | None:
    resp = http_get(YAHOO.format(sym=symbol), params={"range": "5d", "interval": "1d"},
                    headers={"User-Agent": "Mozilla/5.0"}, retries=2)
    if resp is None:
        return None
    try:
        return parse_yahoo(resp.json())
    except ValueError:
        return None


def fetch_stooq(symbol: str) -> dict | None:
    """Fallback for US listings only (Stooq uses 'mu.us')."""
    if "." in symbol or symbol.startswith("^"):
        return None
    resp = http_get(STOOQ, params={"s": f"{symbol.lower()}.us", "f": "sd2t2ohlcv", "h": "", "e": "csv"}, retries=2)
    if resp is None:
        return None
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    if not rows or rows[0].get("Close") in (None, "N/D"):
        return None
    close, open_ = float(rows[0]["Close"]), float(rows[0]["Open"])
    return {"price": round(close, 2), "change_pct": round((close - open_) / open_ * 100, 2) if open_ else None,
            "currency": "USD", "note": "intraday change vs open"}


def collect(cfg: dict, previous: dict | None = None) -> dict:
    prev_by_sym = {q["symbol"]: q for q in (previous or {}).get("quotes", [])}
    quotes = []
    for t in cfg.get("tickers", []):
        q = fetch_yahoo(t["symbol"]) or fetch_stooq(t["symbol"])
        if q:
            quotes.append({"symbol": t["symbol"], "name": t["name"], **q, "as_of": iso(utcnow())})
        elif t["symbol"] in prev_by_sym:
            stale = dict(prev_by_sym[t["symbol"]])
            stale["stale"] = True
            quotes.append(stale)
        log.info("Ticker %-10s %s", t["symbol"], "ok" if q else "missing")
    return {"updated": iso(utcnow()), "quotes": quotes}
