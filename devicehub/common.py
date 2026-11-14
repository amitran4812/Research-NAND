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


def _kw_regex(words: Iterable[str]) -> re.Pattern | None:
    alts = sorted({w.lower() for w in words if w}, key=len, reverse=True)
    if not alts:
        return None
    # An optional plural "s" is allowed, so "transistor" also matches "transistors", "CFET" "CFETs".
    return re.compile(r"(?<![a-z0-9])(" + "|".join(_phrase(a) for a in alts) + r")s?(?![a-z0-9])", re.I)


def _phrase(word: str) -> str:
    """Regex for a keyword where a space and a hyphen are interchangeable
    ("machine learning" also matches "machine-learning-based")."""
    return re.sub(r"(?:\\ |\\-|-| )", r"[\\s\\-]", re.escape(word))


def _stem_regex(words: Iterable[str]) -> re.Pattern | None:
    """Matches words that *start* with any of the given stems ("religio" -> religious, religion)."""
    alts = sorted({w.lower() for w in words if w}, key=len, reverse=True)
    if not alts:
        return None
    return re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(a) for a in alts) + r")", re.I)


def _count(rx: re.Pattern | None, text: str) -> int:
    return len(rx.findall(text)) if rx is not None and text else 0


class Tagger:
    """Decides which topics an item is really about, reading its title *and* its
    abstract / description, not just whether a keyword appears somewhere.

    For every topic in config.yaml:
      * keywords + search phrases are "strong" terms;
      * "ambiguous" terms (short acronyms such as HBF, PCM, ALD, or everyday words
        such as yield, retention, fab) only count when the text also contains a
        semiconductor context term (the hub's "context" list or the topic's own);
      * any "exclude" term (topic-level or hub-level, matched as a word stem)
        rules the topic out, e.g. "HBF Park" (a stadium) or a religious-studies
        paper that happens to mention LLMs.
    A title hit counts 3, a hit in the abstract / description counts 1, and a topic
    is kept when its score reaches the caller's threshold.
    """

    TITLE_WEIGHT = 3

    def __init__(self, cfg: dict):
        rel = cfg.get("relevance") or {}
        self.hub_context: dict[str, re.Pattern | None] = {}
        self.hub_exclude: dict[str, re.Pattern | None] = {}
        ambiguous: dict[str, set[str]] = {}
        strong: dict[str, set[str]] = {}
        for t in cfg.get("topics", []):
            hub = t.get("hub", "device")
            amb = {w.lower() for w in t.get("ambiguous", [])}
            ambiguous.setdefault(hub, set()).update(amb)
            strong.setdefault(hub, set()).update(
                w.lower() for w in list(t.get("keywords", [])) + list(t.get("search", [])) if w.lower() not in amb)
        for hub, hc in rel.items():
            if isinstance(hc, dict) and ("context" in hc or "exclude" in hc):
                # A topic's unambiguous keywords (e.g. "hafnium oxide", "3D NAND") also show
                # the item is in the hub's domain; an ambiguous word can never vouch for
                # itself (e.g. "HBF" in "HBF Park").
                ctx = [w for w in list(hc.get("context", [])) + sorted(strong.get(hub, set()))
                       if w.lower() not in ambiguous.get(hub, set())]
                self.hub_context[hub] = _kw_regex(ctx)
                self.hub_exclude[hub] = _stem_regex(hc.get("exclude", []))
        self.topics = []
        for t in cfg.get("topics", []):
            amb = {w.lower() for w in t.get("ambiguous", [])}
            words = [w for w in list(t.get("keywords", [])) + list(t.get("search", [])) if w.lower() not in amb]
            self.topics.append({
                "id": t["id"], "hub": t["hub"],
                "strong": _kw_regex(words),
                "weak": _kw_regex(amb),
                "context": _kw_regex(t.get("context", [])),
                "exclude": _stem_regex(t.get("exclude", [])),
            })
        self.companies = [(c, _kw_regex([c])) for c in cfg.get("companies", [])]

    # ------------------------------------------------------------------ checks
    def excluded(self, text: str, hub: str) -> bool:
        """True when the text is clearly from another field (hub-level negative terms)."""
        return _count(self.hub_exclude.get(hub), text) > 0

    def has_context(self, text: str, hub: str) -> bool:
        """True when the text mentions the hub's domain (semiconductors / AI) at all."""
        rx = self.hub_context.get(hub)
        return rx is None or _count(rx, text) > 0

    def scores(self, title: str, body: str = "", hub: str | None = None) -> dict[str, int]:
        """Relevance score per topic for an item with this title and body text."""
        text = f"{title} {body}"
        out: dict[str, int] = {}
        hub_bad = {h: self.excluded(text, h) for h in self.hub_exclude}
        hub_ctx = {h: self.has_context(text, h) for h in set(t["hub"] for t in self.topics)}
        for t in self.topics:
            if hub is not None and t["hub"] != hub:
                continue
            if hub_bad.get(t["hub"]) or _count(t["exclude"], text):
                continue
            score = self.TITLE_WEIGHT * _count(t["strong"], title) + _count(t["strong"], body)
            if t["weak"] is not None and (hub_ctx[t["hub"]] or _count(t["context"], text)):
                score += self.TITLE_WEIGHT * _count(t["weak"], title) + _count(t["weak"], body)
            if score:
                out[t["id"]] = score
        return out

    def relevant_topics(self, title: str, body: str = "", hub: str | None = None, min_score: int = 1) -> list[str]:
        return [tid for tid, sc in self.scores(title, body, hub).items() if sc >= min_score]

    def topics_for(self, text: str, hub: str | None = None) -> list[str]:
        """Topics for a single piece of text (treated as a title)."""
        return self.relevant_topics(text, "", hub)

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
