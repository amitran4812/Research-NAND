"""News: Google News RSS searches + publisher RSS feeds, filtered to the portal's topics."""
from __future__ import annotations

import datetime as dt
import html
import logging
import re
import urllib.parse

import feedparser

from .common import Tagger, clean_text, http_get, iso, make_id, norm_title, parse_iso, utcnow

log = logging.getLogger("devicehub.news")

GOOGLE_NEWS = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def _entry_time(e) -> dt.datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        t = e.get(key)
        if t:
            return dt.datetime(*t[:6], tzinfo=dt.timezone.utc)
    return None


def parse_feed(content: bytes | str):
    return feedparser.parse(content)


_IMG_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)


def entry_image(e) -> str | None:
    """Best image for a feed entry: media:content / media:thumbnail / enclosure / first <img>."""
    for key in ("media_content", "media_thumbnail"):
        for m in e.get(key) or []:
            url = m.get("url")
            if url and (m.get("medium") in (None, "image") or key == "media_thumbnail"):
                if not re.search(r"\.(mp4|mp3|webm)(\?|$)", url, re.I):
                    return url
    for enc in e.get("enclosures") or []:
        if (enc.get("type") or "").startswith("image/") and enc.get("href"):
            return enc["href"]
    for blob in [e.get("summary")] + [c.get("value") for c in e.get("content") or []]:
        m = _IMG_RE.search(blob or "")
        if m and m.group(1).startswith("http") and not re.search(r"(pixel|tracking|feedburner|1x1|gravatar|emoji)", m.group(1), re.I):
            return m.group(1)
    return None


def _items_from_feed(parsed, *, source_name: str, hub: str, origin: str) -> list[dict]:
    items = []
    for e in parsed.entries:
        title = clean_text(e.get("title"))
        link = e.get("link")
        if not title or not link:
            continue
        publisher = source_name
        publisher_url = None
        src = e.get("source")
        if src and origin == "google":
            publisher = clean_text(src.get("title")) or source_name
            publisher_url = src.get("href")
            # Google News titles end with " - Publisher"; strip it for display.
            if title.endswith(" - " + publisher):
                title = title[: -len(" - " + publisher)]
        desc = clean_text(e.get("summary") or e.get("description"), 600)
        if origin == "google":
            desc = ""  # Google News descriptions only repeat the headline.
        items.append({
            "id": make_id(norm_title(title)),
            "title": title,
            "url": link,
            "source": publisher,
            "source_url": publisher_url,
            "published": iso(_entry_time(e)),
            "description": desc,
            "hub": hub,
            "origin": origin,
            "image": entry_image(e) if origin == "feed" else None,
        })
    return items


def fetch_google_news(query: str, hub: str, days: int = 2) -> list[dict]:
    url = GOOGLE_NEWS.format(q=urllib.parse.quote_plus(f"{query} when:{days}d"))
    resp = http_get(url)
    if resp is None:
        return []
    return _items_from_feed(parse_feed(resp.content), source_name="Google News", hub=hub, origin="google")


def fetch_publisher_feed(feed: dict) -> list[dict]:
    resp = http_get(feed["url"])
    if resp is None:
        return []
    return _items_from_feed(parse_feed(resp.content), source_name=feed["name"], hub=feed["hub"], origin="feed")


def tag_and_filter(items: list[dict], tagger: Tagger) -> list[dict]:
    """Attach topic/company tags. Publisher-feed items must match a topic keyword of
    their hub; Google News results are already query-targeted."""
    kept = []
    for it in items:
        text = f"{it['title']} {it.get('description', '')}"
        it["topics"] = tagger.topics_for(text, hub=it["hub"])
        it["companies"] = tagger.companies_for(text)
        if it["origin"] == "feed" and not it["topics"]:
            # General tech feeds: a company mention alone (e.g. "Nvidia game bundle")
            # is too weak, so require a device/memory/VLSI topic keyword.
            continue
        kept.append(it)
    return kept


_OG_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["\'][^>]*content=["\']([^"\']+)["\']'
    r'|<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\'](?:og:image|twitter:image)["\']', re.I)


def page_image(url: str) -> str:
    """og:image / twitter:image of an article page ('' if none or unreachable)."""
    resp = http_get(url, timeout=12, retries=1, headers={"User-Agent": "Mozilla/5.0 (compatible; DeviceHub/1.0)"})
    if resp is None:
        return ""
    m = _OG_RE.search(resp.text[:200_000])
    if not m:
        return ""
    img = html.unescape(m.group(1) or m.group(2) or "").strip()
    return urllib.parse.urljoin(getattr(resp, "url", None) or url, img) if img else ""


def add_page_images(items: list[dict], limit: int = 50) -> int:
    """Look up a preview image for direct-link stories that came without one.
    Google News links are redirects to the publisher, so they are skipped."""
    done = 0
    for it in items:
        if done >= limit:
            break
        if it.get("image") or it.get("img_checked") or it.get("origin") != "feed":
            continue
        it["image"] = page_image(it["url"]) or None
        it["img_checked"] = True
        done += 1
    return done


def merge(existing: list[dict], fresh: list[dict], keep_days: int) -> list[dict]:
    """Merge new items into the stored list, de-duplicating by normalized title and
    keeping already-generated summaries."""
    by_id = {it["id"]: it for it in existing}
    for it in fresh:
        old = by_id.get(it["id"])
        if old:
            for k in ("brief", "image", "img_checked"):
                if old.get(k) and not it.get(k):
                    it[k] = old[k]
            it["first_seen"] = old.get("first_seen", it.get("published"))
            # keep the earliest published date
            if old.get("published") and (not it.get("published") or old["published"] < it["published"]):
                it["published"] = old["published"]
        else:
            it["first_seen"] = iso(utcnow())
        if not it.get("published"):
            it["published"] = it["first_seen"]
        by_id[it["id"]] = it
    cutoff = utcnow() - dt.timedelta(days=keep_days)
    out = [it for it in by_id.values() if (parse_iso(it.get("published")) or utcnow()) >= cutoff]
    out.sort(key=lambda it: it.get("published") or "", reverse=True)
    return out


def collect(cfg: dict, tagger: Tagger) -> list[dict]:
    fresh: list[dict] = []
    for q in cfg.get("news_queries", []):
        hub = "device"
        if q.startswith("ai:"):
            hub, q = "ai", q[3:].strip()
        got = fetch_google_news(q, hub)
        log.info("Google News %-50s -> %d", q[:50], len(got))
        fresh.extend(got)
    for feed in cfg.get("news_feeds", []):
        got = fetch_publisher_feed(feed)
        log.info("Feed %-30s -> %d", feed["name"], len(got))
        fresh.extend(got)
    cutoff = utcnow() - dt.timedelta(days=cfg["site"].get("news_days_to_keep", 10))
    fresh = [it for it in fresh if not it["published"] or parse_iso(it["published"]) >= cutoff]
    fresh = tag_and_filter(fresh, tagger)
    # de-dup within this batch, preferring publisher feeds (direct links, real descriptions)
    seen: dict[str, dict] = {}
    for it in fresh:
        cur = seen.get(it["id"])
        if cur is None or (cur["origin"] == "google" and it["origin"] == "feed"):
            if cur:  # merge tags
                it["topics"] = sorted(set(it["topics"]) | set(cur["topics"]))
            seen[it["id"]] = it
        else:
            cur["topics"] = sorted(set(cur["topics"]) | set(it["topics"]))
    return list(seen.values())


# --------------------------------------------------------------------------- sections
_SECTION_RX: dict[str, re.Pattern] = {}


def _section_rx(key: str, words: list[str]) -> re.Pattern:
    if key not in _SECTION_RX:
        alts = sorted({w.lower() for w in words if w}, key=len, reverse=True)
        _SECTION_RX[key] = re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(w) for w in alts) + ")", re.I)
    return _SECTION_RX[key]


def classify_section(item: dict, cfg: dict) -> str:
    """'tech' (new technology / R&D), 'market' (business, prices, outlook) or 'general'."""
    sections = cfg.get("news_sections") or {}
    title = item.get("title") or ""
    body = " ".join(filter(None, [item.get("description"), item.get("brief")]))
    scores = {}
    for key, sec in sections.items():
        rx = _section_rx(key, sec.get("keywords", []))
        scores[key] = 2 * len(rx.findall(title)) + len(rx.findall(body))
    tech, market = scores.get("tech", 0), scores.get("market", 0)
    if not tech and not market:
        return "general"
    return "tech" if tech > market else "market"


def classify_region(item: dict, cfg: dict) -> str:
    """'india' for stories connected to India (by content or by an Indian outlet), else 'international'."""
    ind = cfg.get("india") or {}
    src = (item.get("source") or "").lower()
    if any(s.lower() == src or src.startswith(s.lower()) for s in ind.get("sources", [])):
        return "india"
    if "__india" not in _SECTION_RX:  # whole words here, so "Indiana" is not India
        alts = sorted({w.lower().strip() for w in ind.get("keywords", []) if w}, key=len, reverse=True)
        _SECTION_RX["__india"] = re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(w) for w in alts) + r")(?![a-z])", re.I)
    rx = _SECTION_RX["__india"]
    text = " ".join(filter(None, [item.get("title"), item.get("description"), item.get("brief")]))
    return "india" if rx.search(text) else "international"

