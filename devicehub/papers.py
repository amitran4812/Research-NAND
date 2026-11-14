"""Research papers from arXiv and OpenAlex, grouped by ISO week.

Google Scholar has no public API and actively blocks automated queries, so the
portal uses open scholarly APIs instead:
  * arXiv API      - preprints (device physics, materials, hardware), full abstracts
  * OpenAlex API   - journal & conference papers (IEEE, Elsevier, Nature, ACS, ...),
                     the same publications Google Scholar indexes, with abstracts
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import re
import time
import urllib.parse

import feedparser

from .common import Tagger, clean_text, http_get, iso, make_id, norm_title, parse_iso, utcnow, week_key

log = logging.getLogger("devicehub.papers")

ARXIV_API = "http://export.arxiv.org/api/query"
OPENALEX_API = "https://api.openalex.org/works"


# --------------------------------------------------------------------------- arXiv
def arxiv_query(phrases: list[str], categories: list[str]) -> str:
    terms = []
    for p in phrases:
        q = f'"{p}"' if " " in p else p
        terms.append(f"ti:{q}")
        terms.append(f"abs:{q}")
    cats = " OR ".join(f"cat:{c}" for c in categories)
    return f"({cats}) AND ({' OR '.join(terms)})"


def parse_arxiv(content: bytes | str, topic_id: str) -> list[dict]:
    parsed = feedparser.parse(content)
    out = []
    for e in parsed.entries:
        arxiv_id = e.get("id", "").rsplit("/abs/", 1)[-1]
        base_id = re.sub(r"v\d+$", "", arxiv_id)
        title = clean_text(e.get("title"))
        if not title or not base_id:
            continue
        pdf = next((l.get("href") for l in e.get("links", []) if l.get("type") == "application/pdf"), None)
        published = e.get("published")
        cats = [t.get("term") for t in e.get("tags", []) if t.get("term")]
        out.append({
            "id": "arxiv:" + base_id,
            "arxiv_id": base_id,
            "title": title,
            "abstract": clean_text(e.get("summary")),
            "authors": [a.get("name") for a in e.get("authors", [])][:8],
            "url": f"https://arxiv.org/abs/{base_id}",
            "pdf": pdf,
            "doi": e.get("arxiv_doi"),
            "venue": "arXiv " + (cats[0] if cats else ""),
            "source": "arXiv",
            "published": iso(parse_iso(published)) if published else None,
            "search_topic": topic_id,
        })
    return out


def fetch_arxiv(topic: dict, categories: list[str], max_results: int) -> list[dict]:
    params = {
        "search_query": arxiv_query(topic["search"], categories),
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "start": 0,
        "max_results": max_results,
    }
    resp = http_get(ARXIV_API, params=params, timeout=60)
    if resp is None:
        return []
    return parse_arxiv(resp.content, topic["id"])


_FIG_RE = re.compile(r'<img[^>]+class="ltx_graphics[^"]*"[^>]*src="([^"]+)"|<img[^>]+src="([^"]+)"[^>]*class="ltx_graphics', re.I)


def arxiv_figure(base_id: str) -> str:
    """URL of the first figure in the arXiv HTML rendering of a paper ('' if none)."""
    resp = http_get(f"https://arxiv.org/html/{base_id}", timeout=30, retries=1)
    if resp is None:
        return ""
    m = _FIG_RE.search(resp.text)
    if not m:
        return ""
    src = m.group(1) or m.group(2)
    base = getattr(resp, "url", "") or f"https://arxiv.org/html/{base_id}"
    if not base.endswith("/"):
        base += "/"
    return urllib.parse.urljoin(base, src)


def add_figures(papers: list[dict], limit: int = 60, pause: float = 1.0) -> int:
    """Attach a figure thumbnail to new arXiv papers. Marks tried papers with image=''."""
    done = 0
    for p in papers:
        if done >= limit:
            break
        if not p.get("arxiv_id") or "image" in p:
            continue
        p["image"] = arxiv_figure(p["arxiv_id"])
        done += 1
        time.sleep(pause)
    return done


# --------------------------------------------------------------------------- OpenAlex
def _abstract_from_index(inv: dict | None) -> str:
    if not inv:
        return ""
    positions = []
    for word, idxs in inv.items():
        for i in idxs:
            positions.append((i, word))
    positions.sort()
    return " ".join(w for _, w in positions)


def parse_openalex(data: dict, topic_id: str) -> list[dict]:
    out = []
    for w in data.get("results", []):
        title = clean_text(w.get("display_name") or w.get("title"))
        if not title:
            continue
        doi = (w.get("doi") or "").replace("https://doi.org/", "") or None
        loc = w.get("primary_location") or {}
        src = loc.get("source") or {}
        best_oa = w.get("best_oa_location") or {}
        landing = loc.get("landing_page_url") or (f"https://doi.org/{doi}" if doi else w.get("id"))
        authors = [a.get("author", {}).get("display_name") for a in w.get("authorships", [])][:8]
        field = ((w.get("primary_topic") or {}).get("field") or {}).get("display_name")
        out.append({
            "id": ("doi:" + doi.lower()) if doi else "openalex:" + w.get("id", "").rsplit("/", 1)[-1],
            "title": title,
            "abstract": clean_text(_abstract_from_index(w.get("abstract_inverted_index"))),
            "authors": [a for a in authors if a],
            "url": landing,
            "pdf": best_oa.get("pdf_url"),
            "doi": doi,
            "venue": src.get("display_name") or "",
            "source": "OpenAlex",
            "published": iso(parse_iso(w.get("publication_date"))),
            "cited_by": w.get("cited_by_count", 0),
            "field": field,
            "search_topic": topic_id,
        })
    return out


def fetch_openalex(topic: dict, since: dt.date, max_results: int) -> list[dict]:
    search = " OR ".join(f'"{p}"' for p in topic["search"])
    params = {
        "search": search,
        "filter": f"from_publication_date:{since.isoformat()},to_publication_date:{utcnow().date().isoformat()},has_abstract:true",
        "sort": "publication_date:desc",
        "per-page": min(max_results, 200),
    }
    if os.environ.get("OPENALEX_EMAIL"):
        params["mailto"] = os.environ["OPENALEX_EMAIL"]
    if os.environ.get("OPENALEX_API_KEY"):
        params["api_key"] = os.environ["OPENALEX_API_KEY"]
    resp = http_get(OPENALEX_API, params=params, timeout=60)
    if resp is None:
        return []
    try:
        return parse_openalex(resp.json(), topic["id"])
    except ValueError:
        return []


# --------------------------------------------------------------------------- relevance
PAPER_MIN_SCORE = 2  # a title mention (3) or at least two mentions in the abstract


def paper_topics(p: dict, tagger: Tagger, cfg: dict) -> list[str] | None:
    """Topics a paper is really about, judged from its title *and* abstract.
    None means the paper is off-topic and should be dropped."""
    rel = cfg.get("relevance") or {}
    hub = p.get("hub") or "device"
    fields = rel.get("openalex_fields")
    if fields and p.get("field") and p["field"] not in fields:
        return None  # OpenAlex files it under e.g. Social Sciences / Arts and Humanities / Medicine
    title, abstract = p["title"], p.get("abstract", "") or ""
    text = f"{title} {abstract}"
    if tagger.excluded(text, hub) or not tagger.has_context(text, hub):
        return None
    topics = tagger.relevant_topics(title, abstract, hub=hub, min_score=PAPER_MIN_SCORE)
    if p.get("llm_topics") is not None:  # Claude's verdict, when the API key is set
        topics = [t for t in topics if t in p["llm_topics"]]
    return topics or None


def refilter(papers: list[dict], tagger: Tagger, cfg: dict) -> list[dict]:
    """Re-check every stored paper with the current rules, so tightening config.yaml
    also cleans the archive (not only new papers)."""
    out = []
    for p in papers:
        topics = paper_topics(p, tagger, cfg)
        if topics is None:
            continue
        p["topics"] = topics
        out.append(p)
    return out


# --------------------------------------------------------------------------- merge
def finalize(papers: list[dict], tagger: Tagger, cfg: dict) -> list[dict]:
    """Tag, filter for relevance, de-duplicate (DOI / arXiv id / title)."""
    hubs = {t["id"]: t["hub"] for t in cfg["topics"]}
    out: dict[str, dict] = {}
    title_index: dict[str, str] = {}
    for p in papers:
        hub = hubs.get(p["search_topic"], "device")
        p["hub"] = hub
        topics = paper_topics(p, tagger, cfg)
        if topics is None:
            # Search engines match loosely; the abstract must really be about the topic.
            continue
        p["topics"] = topics
        text = f"{p['title']} {p['abstract']}"
        p["companies"] = tagger.companies_for(text)
        nt = norm_title(p["title"])
        key = title_index.get(nt) or p["id"]
        if key in out:
            prev = out[key]
            prev["topics"] = sorted(set(prev["topics"]) | set(p["topics"]))
            # prefer the published (OpenAlex) record's venue but keep the arXiv PDF
            if prev["source"] == "arXiv" and p["source"] == "OpenAlex":
                p["pdf"] = p.get("pdf") or prev.get("pdf")
                p["arxiv_id"] = prev.get("arxiv_id")
                p["topics"] = prev["topics"]
                out[key] = p
            continue
        out[key] = p
        title_index[nt] = key
    return list(out.values())


def merge(existing: list[dict], fresh: list[dict], weeks_to_keep: int) -> list[dict]:
    by_id = {p["id"]: p for p in existing}
    titles = {norm_title(p["title"]): p["id"] for p in existing}
    for p in fresh:
        pid = titles.get(norm_title(p["title"]), p["id"])
        old = by_id.get(pid)
        if old:
            for k in ("tldr", "domain", "image", "arxiv_id", "first_seen", "llm_topics", "field"):
                if k in old and (old[k] or k in ("image", "llm_topics")) and not p.get(k):
                    p[k] = old[k]
            p["id"] = pid
        else:
            p["first_seen"] = iso(utcnow())
        by_id[p["id"]] = p
    cutoff = utcnow() - dt.timedelta(weeks=weeks_to_keep)
    out = []
    for p in by_id.values():
        d = parse_iso(p.get("published")) or parse_iso(p.get("first_seen")) or utcnow()
        if d > utcnow() + dt.timedelta(days=2):  # bogus future dates
            d = parse_iso(p.get("first_seen")) or utcnow()
        if d < cutoff:
            continue
        p["week"] = week_key(d)
        out.append(p)
    out.sort(key=lambda p: (p.get("published") or "", p["title"]), reverse=True)
    return out


def collect(cfg: dict, tagger: Tagger) -> list[dict]:
    rcfg = cfg.get("research", {})
    since = (utcnow() - dt.timedelta(days=rcfg.get("lookback_days", 14))).date()
    raw: list[dict] = []
    for topic in cfg["topics"]:
        if not topic.get("search"):
            continue  # news-only category
        cats = rcfg.get("arxiv_categories_ai" if topic["hub"] == "ai" else "arxiv_categories", [])
        ax = fetch_arxiv(topic, cats, rcfg.get("arxiv_max_per_topic", 40))
        time.sleep(3)  # arXiv asks clients to wait 3 s between API calls
        ax = [p for p in ax if not p["published"] or parse_iso(p["published"]).date() >= since]
        oa = fetch_openalex(topic, since, rcfg.get("openalex_max_per_topic", 40))
        log.info("Papers %-18s arXiv=%d OpenAlex=%d", topic["id"], len(ax), len(oa))
        raw.extend(ax)
        raw.extend(oa)
    return finalize(raw, tagger, cfg)
