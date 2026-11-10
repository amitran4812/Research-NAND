"""Learn section: latest videos/articles from curated channels + interview/keynote news."""
from __future__ import annotations

import datetime as dt
import logging

import feedparser

from .common import clean_text, http_get, iso, make_id, norm_title, parse_iso, utcnow
from .news import fetch_google_news

log = logging.getLogger("devicehub.learn")


def parse_learn_feed(content: bytes | str, feed: dict) -> list[dict]:
    parsed = feedparser.parse(content)
    out = []
    for e in parsed.entries[:15]:
        title = clean_text(e.get("title"))
        link = e.get("link")
        if not title or not link:
            continue
        t = e.get("published_parsed") or e.get("updated_parsed")
        thumb = None
        if e.get("media_thumbnail"):
            thumb = e["media_thumbnail"][0].get("url")
        desc = e.get("media_description") or e.get("summary") or ""
        out.append({
            "id": make_id(norm_title(title)),
            "title": title,
            "url": link,
            "source": feed["name"],
            "kind": feed.get("kind", "article"),
            "thumbnail": thumb,
            "description": clean_text(desc, 280),
            "published": iso(dt.datetime(*t[:6], tzinfo=dt.timezone.utc)) if t else None,
        })
    return out


def collect(cfg: dict, previous: dict | None = None) -> dict:
    items: list[dict] = []
    for feed in cfg.get("learn_feeds", []):
        resp = http_get(feed["url"])
        got = parse_learn_feed(resp.content, feed) if resp is not None else []
        log.info("Learn feed %-25s -> %d", feed["name"], len(got))
        items.extend(got)
    for q in cfg.get("learn_queries", []):
        for it in fetch_google_news(q, "device", days=14)[:12]:
            items.append({"id": it["id"], "title": it["title"], "url": it["url"], "source": it["source"],
                          "kind": "interview", "thumbnail": None, "description": "",
                          "published": it["published"]})
    # keep older items that dropped off the feeds, for up to 60 days
    seen = {it["id"] for it in items}
    for it in (previous or {}).get("items", []):
        if it["id"] not in seen:
            items.append(it)
    cutoff = utcnow() - dt.timedelta(days=60)
    items = [it for it in items if (parse_iso(it.get("published")) or utcnow()) >= cutoff]
    items.sort(key=lambda it: it.get("published") or "", reverse=True)
    return {
        "updated": iso(utcnow()),
        "items": items,
        "courses": cfg.get("courses", []),
        "conferences": cfg.get("conferences", []),
    }
