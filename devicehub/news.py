"""News: Google News RSS searches + publisher RSS feeds, filtered to the portal's topics."""
from __future__ import annotations

import datetime as dt
import logging
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


def merge(existing: list[dict], fresh: list[dict], keep_days: int) -> list[dict]:
    """Merge new items into the stored list, de-duplicating by normalized title and
    keeping already-generated summaries."""
    by_id = {it["id"]: it for it in existing}
    for it in fresh:
        old = by_id.get(it["id"])
        if old:
            for k in ("brief",):
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
