"""Shared helpers: config, HTTP, text cleanup, tagging and JSON storage."""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Iterable

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DEVICEHUB_DATA_DIR", ROOT / "site" / "data"))
CONFIG_PATH = Path(os.environ.get("DEVICEHUB_CONFIG", ROOT / "config.yaml"))

log = logging.getLogger("devicehub")

USER_AGENT = "DeviceHub/1.0 (+https://github.com/amitran4812/Research-NAND; research news aggregator)"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    for topic in cfg.get("topics", []):
        topic.setdefault("hub", "device")
    for feed in cfg.get("news_feeds", []):
        feed.setdefault("hub", "device")
    return cfg


# --------------------------------------------------------------------------- time
def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(d: dt.datetime | None) -> str | None:
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            d = dt.datetime.strptime(s[:10], "%Y-%m-%d")
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d


def week_key(d: dt.datetime) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_label(key: str) -> str:
    y, w = key.split("-W")
    monday = dt.date.fromisocalendar(int(y), int(w), 1)
    sunday = monday + dt.timedelta(days=6)
    return f"{monday:%b %d} – {sunday:%b %d, %Y}"


# --------------------------------------------------------------------------- HTTP
_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.8"})
    return _session


def http_get(url: str, *, params: dict | None = None, headers: dict | None = None,
             timeout: int = 30, retries: int = 3) -> requests.Response | None:
    """GET with simple retry/backoff. Returns None on failure (never raises)."""
    delay = 2.0
    for attempt in range(1, retries + 1):
        try:
            resp = session().get(url, params=params, headers=headers, timeout=timeout)
            if resp.status_code == 200:
                return resp
            if resp.status_code in (429, 500, 502, 503, 504):
                log.warning("GET %s -> %s (attempt %d)", url, resp.status_code, attempt)
            else:
                log.warning("GET %s -> %s", url, resp.status_code)
                return None
        except requests.RequestException as exc:
            log.warning("GET %s failed: %s (attempt %d)", url, exc, attempt)
        time.sleep(delay)
        delay *= 2
    return None


# --------------------------------------------------------------------------- text
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def clean_text(s: str | None, limit: int | None = None) -> str:
    if not s:
        return ""
    s = html.unescape(_TAG_RE.sub(" ", s))
    s = _WS_RE.sub(" ", s).strip()
    if limit and len(s) > limit:
        s = s[: limit - 1].rsplit(" ", 1)[0] + "…"
    return s


def norm_title(s: str) -> str:
    s = s.lower()
    s = re.sub(r"\s+-\s+[^-]{2,60}$", "", s)  # drop " - Publisher" suffix (Google News)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def make_id(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


def _kw_regex(words: Iterable[str]) -> re.Pattern:
    alts = sorted({w.lower() for w in words if w}, key=len, reverse=True)
    return re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(a) for a in alts) + r")(?![a-z0-9])", re.I)


class Tagger:
    """Tags text with topic ids and company names using whole-word keyword matching."""

    def __init__(self, cfg: dict):
        self.topics = []
        for t in cfg.get("topics", []):
            words = list(t.get("keywords", [])) + list(t.get("search", []))
            self.topics.append((t["id"], t["hub"], _kw_regex(words)))
        self.companies = [(c, _kw_regex([c])) for c in cfg.get("companies", [])]

    def topics_for(self, text: str, hub: str | None = None) -> list[str]:
        return [tid for tid, h, rx in self.topics if (hub is None or h == hub) and rx.search(text)]

    def companies_for(self, text: str) -> list[str]:
        return [name for name, rx in self.companies if rx.search(text)]


# --------------------------------------------------------------------------- storage
def read_json(name: str, default: Any) -> Any:
    path = DATA_DIR / name
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read %s: %s", path, exc)
        return default


def write_json(name: str, data: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / name
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    tmp.replace(path)
