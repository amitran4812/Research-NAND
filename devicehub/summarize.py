"""Claude-powered summaries: news briefs, paper TL;DRs, daily briefings,
research-gap radar per topic, and the AI-in-devices/VLSI playbook.

Needs ANTHROPIC_API_KEY (a GitHub Actions secret). Without it every function
returns None and the site falls back to feed descriptions and abstracts.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

log = logging.getLogger("devicehub.llm")

DEFAULT_MODEL = "claude-opus-5-5"

try:
    import anthropic
except ImportError:  # pragma: no cover - only when the dependency is missing
    anthropic = None


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props), "additionalProperties": False}


_STR = {"type": "string"}
_IDS = {"type": "array", "items": {"type": "string"}}


class Summarizer:
    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("DEVICEHUB_MODEL") or DEFAULT_MODEL
        self.client = None
        if anthropic is None:
            log.warning("anthropic package not installed; AI summaries disabled")
        elif not os.environ.get("ANTHROPIC_API_KEY"):
            log.warning("ANTHROPIC_API_KEY not set; AI summaries disabled")
        else:
            self.client = anthropic.Anthropic()
        self.calls = 0

    @property
    def enabled(self) -> bool:
        return self.client is not None

    # ------------------------------------------------------------------ core call
    def _ask(self, system: str, user: str, schema: dict, effort: str = "low", max_tokens: int = 16000) -> Any | None:
        if not self.client:
            return None
        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError as exc:
            log.warning("Claude rate limited: %s", exc)
            return None
        except anthropic.APIStatusError as exc:
            log.warning("Claude API error %s: %s", exc.status_code, exc.message)
            return None
        except anthropic.APIConnectionError as exc:
            log.warning("Claude connection error: %s", exc)
            return None
        self.calls += 1
        if resp.stop_reason == "refusal":
            log.warning("Claude declined a request (%s)", getattr(resp.stop_details, "category", None))
            return None
        if resp.stop_reason == "max_tokens":
            log.warning("Claude output hit max_tokens; skipping this batch")
            return None
        text = next((b.text for b in resp.content if b.type == "text"), None)
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            log.warning("Claude returned invalid JSON")
            return None

    # ------------------------------------------------------------------ news briefs
    def news_briefs(self, items: list[dict], batch: int = 30) -> dict[str, str]:
        out: dict[str, str] = {}
        schema = _obj({"items": {"type": "array", "items": _obj({"id": _STR, "brief": _STR})}})
        system = (
            "You write news briefs for Device Hub, a portal for researchers working on nanoscale "
            "semiconductor devices, DRAM, NAND flash, storage, emerging memory, VLSI and AI. "
            "For each item write a brief of one or two sentences (at most 45 words): what happened and "
            "why it matters to a device or VLSI researcher. Use only the information given; when only a "
            "headline is available, restate it clearly with neutral context and do not invent numbers, "
            "dates, quotes or claims. Plain text, no markdown."
        )
        for i in range(0, len(items), batch):
            chunk = items[i:i + batch]
            payload = [{"id": it["id"], "title": it["title"], "source": it.get("source"),
                        "text": it.get("description", "")[:600]} for it in chunk]
            res = self._ask(system, "News items (JSON):\n" + json.dumps(payload, ensure_ascii=False), schema)
            for r in (res or {}).get("items", []):
                if r.get("id") and r.get("brief"):
                    out[r["id"]] = r["brief"].strip()
        return out

    # ------------------------------------------------------------------ paper TL;DRs
    def paper_tldrs(self, papers: list[dict], batch: int = 25) -> dict[str, dict]:
        out: dict[str, dict] = {}
        schema = _obj({"items": {"type": "array", "items": _obj({"id": _STR, "tldr": _STR, "domain": _STR})}})
        system = (
            "You help device and VLSI researchers triage new papers. For each paper return: "
            "'tldr' - one plain sentence (max 30 words) on what the paper does and its key result, based only "
            "on the abstract; 'domain' - a short label (2-5 words) naming the sub-field, e.g. "
            "'3D NAND reliability', 'HZO FeFET endurance', 'CFET process integration', 'IGZO 2T0C DRAM', "
            "'LLM for Verilog generation'."
        )
        for i in range(0, len(papers), batch):
            chunk = papers[i:i + batch]
            payload = [{"id": p["id"], "title": p["title"], "abstract": p.get("abstract", "")[:1500]} for p in chunk]
            res = self._ask(system, "Papers (JSON):\n" + json.dumps(payload, ensure_ascii=False), schema)
            for r in (res or {}).get("items", []):
                if r.get("id"):
                    out[r["id"]] = {"tldr": r.get("tldr", "").strip(), "domain": r.get("domain", "").strip()}
        return out

    # ------------------------------------------------------------------ daily briefing
    def briefing(self, hub: str, news: list[dict], papers: list[dict]) -> dict | None:
        schema = _obj({
            "headline": _STR,
            "points": {"type": "array", "items": _obj({"text": _STR, "ids": _IDS})},
            "watch": {"type": "array", "items": _STR},
        })
        focus = ("DRAM, NAND flash and storage first, then emerging memory (FeFET, MRAM, ReRAM), advanced logic "
                 "devices (CFET, GAA), device materials and VLSI design" if hub == "device" else
                 "AI research and industry, with emphasis on AI applied to semiconductor devices, materials, "
                 "EDA/VLSI design and AI hardware")
        system = (
            "You are the editor of Device Hub. Write today's briefing for a nanoscale device researcher. "
            f"Focus: {focus}. 'headline' is one sentence capturing the most important development. "
            "'points' are 5-8 concise bullets (max 40 words each) synthesising the news and new research, "
            "each citing the ids of the items it draws on. 'watch' lists 2-4 short things worth following "
            "next. Use only the supplied items; no invented facts. Plain text, no markdown."
        )
        payload = {
            "news": [{"id": n["id"], "title": n["title"], "source": n.get("source"),
                      "brief": n.get("brief") or n.get("description", "")[:300]} for n in news[:70]],
            "papers": [{"id": p["id"], "title": p["title"], "tldr": p.get("tldr") or p.get("abstract", "")[:300]}
                       for p in papers[:30]],
        }
        return self._ask(system, json.dumps(payload, ensure_ascii=False), schema, effort="medium")

    # ------------------------------------------------------------------ research radar
    def topic_insight(self, topic: dict, papers: list[dict], news: list[dict]) -> dict | None:
        schema = _obj({
            "overview": _STR,
            "trends": {"type": "array", "items": _obj({"title": _STR, "detail": _STR, "ids": _IDS})},
            "gaps": {"type": "array", "items": _obj({
                "title": _STR, "what_is_missing": _STR, "why_it_matters": _STR,
                "suggested_approach": _STR,
                "difficulty": {"type": "string", "enum": ["starter", "moderate", "ambitious"]},
                "ids": _IDS,
            })},
            "starter_projects": {"type": "array", "items": _STR},
            "key_papers": _IDS,
        })
        system = (
            "You are a senior researcher in semiconductor devices advising a PhD-level researcher. "
            f"Topic: {topic['name']}. From the recent papers and news supplied, write a research radar: "
            "'overview' - one paragraph (max 120 words) on what the field is doing right now; "
            "'trends' - 3-5 concrete directions with the paper ids that show them; "
            "'gaps' - 3-5 open research gaps a researcher could realistically work on: what is missing in "
            "the supplied work, why it matters (industry relevance, e.g. scaling, reliability, cost, "
            "power), and a suggested approach (simulation/TCAD, fabrication, characterization, modelling, "
            "circuit co-design), with difficulty and related ids; 'starter_projects' - 2-4 one-line "
            "project ideas; 'key_papers' - up to 5 ids to read first. Ground every claim in the supplied "
            "items and say when evidence is thin. Plain text, no markdown."
        )
        payload = {
            "papers": [{"id": p["id"], "title": p["title"], "venue": p.get("venue"),
                        "abstract": p.get("abstract", "")[:1200]} for p in papers[:40]],
            "news": [{"id": n["id"], "title": n["title"], "brief": n.get("brief", "")} for n in news[:20]],
        }
        return self._ask(system, json.dumps(payload, ensure_ascii=False), schema, effort="medium")

    # ------------------------------------------------------------------ AI playbook
    def ai_playbook(self, papers: list[dict], news: list[dict]) -> dict | None:
        schema = _obj({
            "intro": _STR,
            "applications": {"type": "array", "items": _obj({
                "area": _STR, "how": _STR, "tools": {"type": "array", "items": _STR},
                "first_steps": {"type": "array", "items": _STR}, "ids": _IDS,
            })},
            "skills": {"type": "array", "items": _STR},
        })
        system = (
            "You advise a nanoscale device / VLSI researcher on using AI in their own work. Using the recent "
            "papers and news supplied (cite their ids), write: 'intro' (max 80 words); 'applications' - 5-7 "
            "practical areas such as ML surrogate models for TCAD, materials screening, compact-model "
            "fitting, process/yield optimisation, defect inspection, LLM-assisted RTL/Verilog, placement "
            "and timing prediction, in-memory computing hardware; for each: how it works, typical tools or "
            "libraries, and 3 concrete first steps; 'skills' - 4-6 skills to learn. Plain text, no markdown."
        )
        payload = {
            "papers": [{"id": p["id"], "title": p["title"], "abstract": p.get("abstract", "")[:900]} for p in papers[:40]],
            "news": [{"id": n["id"], "title": n["title"], "brief": n.get("brief", "")} for n in news[:20]],
        }
        return self._ask(system, json.dumps(payload, ensure_ascii=False), schema, effort="medium")
