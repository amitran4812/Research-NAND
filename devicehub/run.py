"""Device Hub pipeline: fetch -> merge with archive -> summarise -> write site/data/*.json

Usage:
    python -m devicehub.run                 # everything (what the scheduled job runs)
    python -m devicehub.run --only news     # just one stage (news, papers, market, learn, insights)
    python -m devicehub.run --no-llm        # skip Claude calls
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys

import yaml

from . import learn, market, news, papers
from .common import ROOT, Tagger, iso, load_config, parse_iso, read_json, utcnow, week_label, write_json
from .summarize import Summarizer

log = logging.getLogger("devicehub")

STAGES = ("news", "papers", "market", "learn", "insights")
MAX_NEW_BRIEFS = 160
MAX_NEW_TLDRS = 200


def _older_than(ts: str | None, hours: float) -> bool:
    d = parse_iso(ts)
    return d is None or utcnow() - d > dt.timedelta(hours=hours)


def run_news(cfg, tagger, llm: Summarizer) -> list[dict]:
    store = read_json("news.json", {"items": []})
    fresh = news.collect(cfg, tagger)
    if not fresh and store["items"]:
        log.warning("No news fetched; keeping previous data")
    items = news.merge(store["items"], fresh, cfg["site"].get("news_days_to_keep", 10))
    log.info("Looked up preview images for %d stories", news.add_page_images(items))
    todo = [it for it in items if not it.get("brief")][:MAX_NEW_BRIEFS]
    if todo and llm.enabled:
        briefs = llm.news_briefs(todo)
        for it in items:
            if it["id"] in briefs:
                it["brief"] = briefs[it["id"]]
        log.info("Wrote %d news briefs", len(briefs))
    for it in items:
        it["section"] = news.classify_section(it, cfg)
        it["region"] = news.classify_region(it, cfg)
    write_json("news.json", {"updated": iso(utcnow()), "items": items})
    return items


def run_papers(cfg, tagger, llm: Summarizer) -> list[dict]:
    store = read_json("papers.json", {"items": []})
    fresh = papers.collect(cfg, tagger)
    if not fresh and store["items"]:
        log.warning("No papers fetched; keeping previous data")
    items = papers.merge(store["items"], fresh, cfg["site"].get("weeks_to_keep", 8))
    n_fig = papers.add_figures(items)
    log.info("Looked up figures for %d arXiv papers", n_fig)
    todo = [p for p in items if not p.get("tldr") and p.get("abstract")][:MAX_NEW_TLDRS]
    if todo and llm.enabled:
        tl = llm.paper_tldrs(todo)
        for p in items:
            if p["id"] in tl:
                p["tldr"] = tl[p["id"]]["tldr"]
                p["domain"] = tl[p["id"]]["domain"]
        log.info("Wrote %d paper TL;DRs", len(tl))
    write_json("papers.json", {"updated": iso(utcnow()), "items": items})
    return items


def run_market(cfg, force: bool) -> None:
    prev = read_json("market.json", {})
    # Prices are refreshed once a day (the first run of each UTC day).
    if not force and prev.get("updated") and parse_iso(prev["updated"]).date() == utcnow().date():
        log.info("Market data already fetched today; skipping")
        return
    data = market.collect(cfg, prev)
    if data["quotes"]:
        write_json("market.json", data)


def run_learn(cfg) -> None:
    write_json("learn.json", learn.collect(cfg, read_json("learn.json", {})))


def run_insights(cfg, llm: Summarizer, news_items, paper_items, force: bool) -> None:
    if not llm.enabled:
        log.info("Insights skipped (no ANTHROPIC_API_KEY)")
        return
    store = read_json("insights.json", {"briefings": {}, "topics": {}, "playbook": None})
    now = iso(utcnow())
    recent_cut = utcnow() - dt.timedelta(hours=36)

    # Briefings: refreshed on every run (morning + night).
    for hub in ("device", "ai"):
        hub_news = [n for n in news_items if n["hub"] == hub and (parse_iso(n.get("published")) or utcnow()) >= recent_cut]
        if len(hub_news) < 5:
            hub_news = [n for n in news_items if n["hub"] == hub][:40]
        hub_papers = [p for p in paper_items if p["hub"] == hub][:30]
        if not hub_news and not hub_papers:
            continue
        b = llm.briefing(hub, hub_news, hub_papers)
        if b:
            b["generated"] = now
            store["briefings"][hub] = b

    # Research radar per topic + AI playbook: once a day.
    for topic in cfg["topics"]:
        if not topic.get("search"):
            continue  # news-only category: no research radar
        prev = store["topics"].get(topic["id"]) or {}
        if not force and not _older_than(prev.get("generated"), 20):
            continue
        tp = [p for p in paper_items if topic["id"] in p.get("topics", [])]
        tn = [n for n in news_items if topic["id"] in n.get("topics", [])]
        if len(tp) < 3:
            log.info("Radar %s: only %d papers, skipped", topic["id"], len(tp))
            continue
        ins = llm.topic_insight(topic, tp, tn)
        if ins:
            ins.update({"generated": now, "paper_count": len(tp), "name": topic["name"], "hub": topic["hub"]})
            store["topics"][topic["id"]] = ins
            log.info("Radar %s: done (%d papers)", topic["id"], len(tp))

    if force or _older_than((store.get("playbook") or {}).get("generated"), 20):
        ai_ids = {"ai-for-devices", "ai-for-vlsi", "ai-hardware"}
        pp = [p for p in paper_items if ai_ids & set(p.get("topics", []))]
        nn = [n for n in news_items if n["hub"] == "ai"]
        if pp or nn:
            pb = llm.ai_playbook(pp, nn)
            if pb:
                pb["generated"] = now
                store["playbook"] = pb

    store["updated"] = now
    write_json("insights.json", store)


def write_venues() -> None:
    """Copy the hand-curated venues.yaml (conferences, journals) for the Publish page."""
    path = ROOT / "venues.yaml"
    if not path.exists():
        return
    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    write_json("venues.json", {"conferences": data.get("conferences", []), "journals": data.get("journals", [])})


def write_meta(cfg, llm: Summarizer, paper_items: list[dict] | None) -> None:
    paper_items = paper_items if paper_items is not None else read_json("papers.json", {"items": []})["items"]
    weeks: dict[str, int] = {}
    for p in paper_items:
        weeks[p["week"]] = weeks.get(p["week"], 0) + 1
    hour = utcnow().hour
    write_json("meta.json", {
        "title": cfg["site"]["title"],
        "tagline": cfg["site"].get("tagline", ""),
        "updated": iso(utcnow()),
        "edition": "morning" if hour < 12 else "evening",
        "llm": {"enabled": llm.enabled, "model": llm.model if llm.enabled else None},
        "topics": [{"id": t["id"], "name": t["name"], "hub": t["hub"]} for t in cfg["topics"]],
        "weeks": [{"key": k, "label": week_label(k), "count": weeks[k]} for k in sorted(weeks, reverse=True)],
    })


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="comma-separated stages: " + ",".join(STAGES))
    ap.add_argument("--no-llm", action="store_true", help="skip all Claude calls")
    ap.add_argument("--force-market", action="store_true", help="refetch prices even if done today")
    ap.add_argument("--force-insights", action="store_true", help="regenerate research radar now")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", stream=sys.stdout)

    stages = set(args.only.split(",")) if args.only else set(STAGES)
    unknown = stages - set(STAGES)
    if unknown:
        ap.error(f"unknown stage(s): {', '.join(sorted(unknown))}")

    cfg = load_config()
    tagger = Tagger(cfg)
    llm = Summarizer()
    if args.no_llm:
        llm.client = None

    news_items = run_news(cfg, tagger, llm) if "news" in stages else read_json("news.json", {"items": []})["items"]
    paper_items = run_papers(cfg, tagger, llm) if "papers" in stages else read_json("papers.json", {"items": []})["items"]
    if "market" in stages:
        run_market(cfg, args.force_market)
    if "learn" in stages:
        run_learn(cfg)
    if "insights" in stages:
        run_insights(cfg, llm, news_items, paper_items, args.force_insights)
    write_venues()
    write_meta(cfg, llm, paper_items)
    log.info("Done. news=%d papers=%d claude_calls=%d", len(news_items), len(paper_items), llm.calls)
    return 0


if __name__ == "__main__":
    sys.exit(main())
