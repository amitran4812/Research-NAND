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
    """Attach topic/company tags and drop stories that are not really about the
    portal's subjects. The headline *and* the description are read: a story must
    mention its hub's domain (semiconductors for the device pages, AI for the AI Hub),
    must not be from an unrelated field (e.g. "HBF Park" football, HbF hemoglobin
    drugs, a ticker-symbol trading page), and must score on at least one topic.
    Google News results with no topic are kept only when the headline is clearly
    about semiconductors / AI, since their query already targeted the subject."""
    kept = []
    for it in items:
        title, body = it["title"], it.get("description", "") or ""
        text = f"{title} {body}"
        hub = it["hub"]
        if tagger.excluded(text, hub) or not tagger.has_context(text, hub):
            continue
        it["topics"] = tagger.relevant_topics(title, body, hub=hub)
        if it.get("llm_topics") is not None:  # Claude's verdict, when the API key is set
            it["topics"] = [t for t in it["topics"] if t in it["llm_topics"]]
            if not it["llm_topics"]:
                continue
        it["companies"] = tagger.companies_for(text)
        if it["origin"] == "feed" and not it["topics"]:
            # General tech feeds: a company mention alone (e.g. "Nvidia game bundle")
            # is too weak, so require a device/memory/VLSI topic.
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
            for k in ("brief", "image", "img_checked", "llm_topics"):
                if (old.get(k) or (k == "llm_topics" and old.get(k) is not None)) and not it.get(k):
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


# --------------------------------------------------------------------------- duplicates
_TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|ocid$|cmpid$|ref$|src$|source$|guccounter$|mc_)", re.I)


def norm_url(url: str) -> str:
    """Canonical form of an article link: no scheme/www, tracking parameters, fragment or trailing slash."""
    try:
        u = urllib.parse.urlsplit(url or "")
    except ValueError:
        return url or ""
    host = u.netloc.lower().removeprefix("www.").removeprefix("m.")
    query = urllib.parse.urlencode(sorted((k, v) for k, v in urllib.parse.parse_qsl(u.query) if not _TRACKING.match(k)))
    return host + u.path.rstrip("/") + ("?" + query if query else "")


_DROP_RE = re.compile(
    r"^\s*(\(pr\)|\[[a-z ]*newswire\]|\[news\]|exclusive:|breaking:)\s*"   # wire / label prefixes
    r"|\s+by investing\.com.*$"                                         # syndication suffixes
    r"|\((?:nyse|nasdaq|nse|bse|krx|tse|otc|lse)[^)]*\)"                # ticker tags
    r"|\s+[|\u2013\u2014-]\s+[^|\u2013\u2014-]{2,40}$",                   # " | Publisher" / " - Publisher"
    re.I)
_STOP = set("a an the of in on for to and or with by from at as is are be its it this that new after over into "
            "amid says said will would could may its their his her than more".split())
_OPPOSITES = [{"long", "short"}, {"up", "down"}, {"rise", "fall"}, {"rises", "falls"}, {"gain", "loss"},
              {"surging", "sliding"}, {"surges", "slides"}, {"jumps", "drops"}, {"buy", "sell"},
              {"higher", "lower"}, {"beats", "misses"}, {"raises", "cuts"}]
_NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")


def _title_key(title: str) -> tuple[set[str], set[str]]:
    t = _DROP_RE.sub(" ", title or "").lower()
    t = t.replace("&", " and ").replace("u.s.", "us").replace("u.k.", "uk")
    t = re.sub(r"[\u2018\u2019\u201c\u201d'\"`]", "", t)  # quotes / apostrophes: "CEO's" == "CEOs"
    nums = set(_NUM_RE.findall(t))
    words = {w[:-1] if len(w) > 3 and w.endswith("s") else w
             for w in re.findall(r"[a-z0-9]+", t) if w not in _STOP}
    return words, nums


def same_story(a: dict, b: dict, entities: list[re.Pattern] | None = None) -> bool:
    """True when two items are the same story: same link, or headlines that say the
    same thing (word overlap >= 60%) with no conflicting numbers, directions or companies."""
    if a.get("url") and norm_url(a["url"]) == norm_url(b.get("url", "")):
        return True
    wa, na = a["_key"]
    wb, nb = b["_key"]
    if not wa or not wb:
        return False
    if len(wa & wb) / len(wa | wb) < 0.6:
        return False
    if na and nb and na != nb:  # "down 4.3%" vs "down 3.2%", "Nov 9" vs "Nov 10"
        return False
    diff = wa ^ wb
    if any(len(pair & diff) == 2 for pair in _OPPOSITES):  # "2x Long" vs "2x Short", "surging" vs "sliding"
        return False
    ta, tb = a["title"], b["title"]
    for rx in entities or []:  # "Qualcomm announces results" vs "Applied Materials announces results"
        if bool(rx.search(ta)) != bool(rx.search(tb)):
            return False
    return True


def _rank(it: dict) -> tuple:
    """Which copy of a story to show: direct publisher link, then photo, then real text, then oldest."""
    return (it.get("origin") != "feed", not it.get("image"), not it.get("description"),
            it.get("first_seen") or it.get("published") or "", it["id"])


def dedupe(items: list[dict], tagger: Tagger | None = None, window_days: float = 4) -> list[dict]:
    """Collapse copies of the same story (same link, or near-identical headlines within a
    few days) into one item. The kept item lists the other outlets under "also"."""
    entities = [rx for _, rx in tagger.companies] if tagger else []
    for it in items:
        it["_key"] = _title_key(it["title"])
        it["_t"] = parse_iso(it.get("published")) or utcnow()
    clusters: list[list[dict]] = []
    window = dt.timedelta(days=window_days)
    for it in sorted(items, key=lambda x: x["_t"]):
        for cl in reversed(clusters[-400:]):
            if it["_t"] - cl[0]["_t"] > window:
                continue
            if any(same_story(it, other, entities) for other in cl):
                cl.append(it)
                break
        else:
            clusters.append([it])
    out = []
    for cl in clusters:
        cl.sort(key=_rank)
        keep = cl[0]
        if len(cl) > 1:
            keep["topics"] = sorted({t for x in cl for t in x.get("topics", [])})
            keep["companies"] = sorted({c for x in cl for c in x.get("companies", [])})
            seen = {keep.get("source")}
            also = []
            for x in cl[1:] + [{"source": a.get("source"), "url": a.get("url")} for a in keep.get("also", [])]:
                if x.get("source") and x["source"] not in seen:
                    seen.add(x["source"])
                    also.append({"source": x["source"], "url": x.get("url")})
            keep["also"] = also[:6]
            if not keep.get("brief"):
                keep["brief"] = next((x["brief"] for x in cl if x.get("brief")), None) or keep.get("brief")
                if keep["brief"] is None:
                    keep.pop("brief")
        out.append(keep)
    for it in items:
        it.pop("_key", None)
        it.pop("_t", None)
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

