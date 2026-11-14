"""Offline tests: every HTTP call is served from tests/fixtures."""
from __future__ import annotations

import datetime as dt
import email.utils
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

FIX = Path(__file__).parent / "fixtures"


def _fixture(name: str) -> str:
    now = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3)
    return (FIX / name).read_text().replace("__RECENT__", now.strftime("%Y-%m-%dT%H:%M:%SZ")) \
        .replace("__RECENT_DATE__", now.strftime("%Y-%m-%d")) \
        .replace("__RFC822__", email.utils.format_datetime(now))


class FakeResp:
    def __init__(self, text: str):
        self.text = text
        self.content = text.encode()
        self.status_code = 200

    def json(self):
        return json.loads(self.text)


class FakeHtml(FakeResp):
    def __init__(self, text, url):
        super().__init__(text)
        self.url = url


def fake_get(url, params=None, **_):
    if "arxiv.org/html/" in url:
        return FakeHtml('<figure><img src="x1.png" class="ltx_graphics ltx_img" alt=""></figure>', url + "v2/")
    if "arxiv.org" in url:
        return FakeResp(_fixture("arxiv.xml"))
    if "openalex.org" in url:
        return FakeResp(_fixture("openalex.json"))
    if "news.google.com" in url:
        return FakeResp(_fixture("gnews.xml"))
    if "finance.yahoo.com" in url:
        return FakeResp(_fixture("yahoo.json"))
    if "youtube.com" in url or "feed" in url or "rss" in url or url.endswith(".xml") or "atom" in url:
        return FakeResp(_fixture("feed.xml"))
    return None


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DEVICEHUB_DATA_DIR"] = self.tmp.name
        os.environ.pop("ANTHROPIC_API_KEY", None)
        import importlib

        import devicehub.common as common
        importlib.reload(common)
        for mod in ("news", "papers", "market", "learn", "run"):
            importlib.reload(importlib.import_module(f"devicehub.{mod}"))
        self.data = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, *args):
        from devicehub import learn, market, news, papers, run
        with mock.patch.object(news, "http_get", fake_get), \
             mock.patch.object(papers, "http_get", fake_get), \
             mock.patch.object(market, "http_get", fake_get), \
             mock.patch.object(learn, "http_get", fake_get), \
             mock.patch("devicehub.papers.time.sleep"):
            return run.main(list(args))

    def load(self, name):
        return json.loads((self.data / name).read_text())

    def test_full_run_without_llm(self):
        self.assertEqual(self._run(), 0)
        for f in ("news.json", "papers.json", "market.json", "learn.json", "meta.json", "venues.json"):
            self.assertTrue((self.data / f).exists(), f)
        venues = json.loads((self.data / "venues.json").read_text())
        self.assertTrue(venues["conferences"] and venues["journals"])
        topic_ids = {t["id"] for t in json.loads((self.data / "meta.json").read_text())["topics"]}
        for v in venues["conferences"] + venues["journals"]:
            self.assertTrue(set(v["topics"]) <= topic_ids, v["name"])
            self.assertTrue(v["url"].startswith("https://"), v["name"])
        for c in venues["conferences"]:
            self.assertIn(c["deadline"], range(1, 13), c["name"])
            self.assertIn(c["month"], range(1, 13), c["name"])
        for j in venues["journals"]:
            self.assertIn(j["quartile"], ("Q1", "Q2", "Q3", "Q4"), j["name"])

        lib = self.load("learn.json")["library"]
        self.assertTrue(lib["courses"])
        for c in lib["courses"]:
            self.assertIn(c["group"], ("devices", "circuits"), c["title"])
            self.assertIn(c["subject"], lib["subjects"][c["group"]], c["title"])
            self.assertIn(c["level"], ("Beginner", "Intermediate", "Advanced"), c["title"])
            self.assertTrue(c["url"].startswith("https://"), c["title"])
            self.assertTrue(set(c["topics"]) <= topic_ids, c["title"])

        news = self.load("news.json")["items"]
        titles = [n["title"] for n in news]
        # Publisher-feed copy wins over the Google News duplicate, and has a real link.
        sk = [n for n in news if "321-layer" in n["title"]]
        self.assertEqual(len(sk), 1)
        self.assertEqual(sk[0]["url"], "https://blocksandfiles.com/321")
        self.assertEqual(sk[0]["image"], "https://blocksandfiles.com/img/321.jpg")
        self.assertIn("nand", sk[0]["topics"])
        self.assertIn("SK hynix", sk[0]["companies"])
        self.assertTrue(all(n["section"] in ("tech", "market", "general") for n in news))
        self.assertEqual(sk[0]["section"], "tech")
        self.assertTrue(all(n["region"] in ("india", "international") for n in news))
        # Irrelevant general-tech story is filtered out.
        self.assertFalse(any("mouse" in t.lower() for t in titles))
        # Google News " - Publisher" suffix is stripped.
        self.assertIn("Micron ships HBM4 samples", titles)

        papers = self.load("papers.json")["items"]
        ptitles = [p["title"] for p in papers]
        self.assertFalse(any("graphite" in t for t in ptitles), "off-topic paper should be filtered")
        nand = [p for p in papers if "retention" in p["title"].lower()]
        self.assertEqual(len(nand), 1, "arXiv + OpenAlex copies of one paper are merged")
        arx = [p for p in papers if p.get("arxiv_id")]
        self.assertTrue(arx)
        for p in arx:
            self.assertTrue(p["image"].startswith("https://arxiv.org/html/"), p["image"])
            self.assertTrue(p["image"].endswith("/x1.png"))
        fefet = [p for p in papers if "HZO" in p["title"]][0]
        self.assertEqual(fefet["abstract"], "We report FeFET endurance in 3D NAND arrays.")
        self.assertIn("emerging-memory", fefet["topics"])
        self.assertRegex(fefet["week"], r"^\d{4}-W\d{2}$")

        market = self.load("market.json")
        mu = [q for q in market["quotes"] if q["symbol"] == "MU"][0]
        self.assertEqual(mu["price"], 110.0)
        self.assertEqual(mu["change_pct"], 10.0)

        meta = self.load("meta.json")
        self.assertEqual(meta["title"], "Device Hub")
        self.assertFalse(meta["llm"]["enabled"])
        self.assertTrue(meta["weeks"])

    def test_second_run_keeps_history_and_skips_market(self):
        self._run()
        first = self.load("market.json")["updated"]
        self._run()
        self.assertEqual(self.load("market.json")["updated"], first, "prices fetched once a day")
        news = self.load("news.json")["items"]
        self.assertEqual(len({n["id"] for n in news}), len(news))


class ImageTest(unittest.TestCase):
    def test_og_image_parsing(self):
        from devicehub import news
        page = '<html><head><meta content="/img/a.jpg" property="og:image"></head></html>'
        with mock.patch.object(news, "http_get", lambda url, **kw: FakeHtml(page, "https://ex.com/story")):
            self.assertEqual(news.page_image("https://ex.com/story"), "https://ex.com/img/a.jpg")
            items = [{"url": "https://ex.com/story", "origin": "feed"}, {"url": "https://news.google.com/x", "origin": "google"}]
            self.assertEqual(news.add_page_images(items), 1)
            self.assertEqual(items[0]["image"], "https://ex.com/img/a.jpg")
            self.assertNotIn("image", items[1])


class SectionTest(unittest.TestCase):
    def test_classify(self):
        from devicehub.common import load_config
        from devicehub.news import classify_section
        cfg = load_config()
        self.assertEqual(classify_section({"title": "SK hynix unveils 321-layer NAND with new architecture"}, cfg), "tech")
        self.assertEqual(classify_section({"title": "Micron revenue jumps as DRAM prices rise; analysts raise outlook"}, cfg), "market")
        self.assertEqual(classify_section({"title": "Kioxia leveraged product debuts in Hong Kong"}, cfg), "market")
        self.assertEqual(classify_section({"title": "5 cheaper ways to play games"}, cfg), "general")

    def test_region(self):
        from devicehub.common import load_config
        from devicehub.news import classify_region
        cfg = load_config()
        self.assertEqual(classify_region({"title": "Tata Electronics starts trial runs at Dholera fab", "source": "Reuters"}, cfg), "india")
        self.assertEqual(classify_region({"title": "Micron expands HBM output", "source": "The Economic Times"}, cfg), "india")
        self.assertEqual(classify_region({"title": "Micron expands HBM output", "source": "Reuters"}, cfg), "international")
        self.assertEqual(classify_region({"title": "Analysts weigh Indiana plant", "source": "Reuters"}, cfg), "international")


class TaggerTest(unittest.TestCase):
    def test_whole_word_matching(self):
        from devicehub.common import Tagger, load_config
        t = Tagger(load_config())
        self.assertNotIn("emerging-memory", t.topics_for("Pcmag reviews the newest laptop"))
        self.assertIn("logic-devices", t.topics_for("imec shows CFET with backside power"))
        self.assertIn("ai-for-vlsi", t.topics_for("LLM writes Verilog for chip design", hub="ai"))
        # plurals and hyphen/space variants
        self.assertIn("logic-devices", t.topics_for("Low-power 2D CFETs on a single-crystal dielectric"))
        self.assertIn("ai-for-devices", t.topics_for("Machine-learning-based reconstruction of SEM images", hub="ai"))


class RelevanceTest(unittest.TestCase):
    """Items are judged by their abstract / description, not a bare keyword hit."""

    def setUp(self):
        from devicehub.common import Tagger, load_config
        self.cfg = load_config()
        self.t = Tagger(self.cfg)

    def news(self, title, desc="", hub="device", origin="google"):
        from devicehub import news
        it = {"id": "x", "title": title, "description": desc, "hub": hub, "origin": origin}
        return news.tag_and_filter([it], self.t)

    def paper(self, title, abstract, topic, field=None):
        from devicehub import papers
        hub = {t["id"]: t["hub"] for t in self.cfg["topics"]}[topic]
        p = {"id": "p", "title": title, "abstract": abstract, "hub": hub, "search_topic": topic, "field": field}
        return papers.paper_topics(p, self.t, self.cfg)

    def test_hbf_means_high_bandwidth_flash(self):
        self.assertEqual(self.news("Police Investigate Violent Disorder Near HBF Park After Perth Glory Match"), [])
        self.assertEqual(self.news("Fulcrum Therapeutics Agrees to Sell Early-Stage HbF Assets"), [])
        self.assertEqual(self.news("(HBF) Trading Signals (HBF:CA)"), [])
        kept = self.news("Could HBF be the solution to the memory bottleneck?")
        self.assertEqual(len(kept), 1)
        self.assertIn("hbf", kept[0]["topics"])
        self.assertIn("hbf", self.news("SanDisk and SK hynix standardise High Bandwidth Flash")[0]["topics"])

    def test_feed_story_needs_a_real_topic(self):
        self.assertEqual(self.news("Security researcher jailbreaks car to update the clock", "A car's head unit.", origin="feed"), [])
        kept = self.news("SK hynix begins mass production of 321-layer NAND", "The 3D NAND uses charge trap cells.", origin="feed")
        self.assertIn("nand", kept[0]["topics"])

    def test_religious_paper_is_not_an_ai_paper(self):
        self.assertIsNone(self.paper(
            "Al-Ghasali: A Computational Framework for Simulating Islamic Jurisprudential Rulings via Finite State Automata and Large Language Models",
            "This paper presents Al Ghasali, a framework to formalize Islamic jurisprudential (Fiqh) rulings with LLMs.", "ai-general"))
        self.assertIn("ai-for-vlsi", self.paper(
            "LLM agents for RTL generation", "We use a large language model to write Verilog for chip design.", "ai-for-vlsi"))

    def test_acronym_clash_in_abstract(self):
        # "SRAM" here is a social-science mentoring model, not static RAM.
        self.assertIsNone(self.paper(
            "Community-led models and socio-religio-academic mentoring in countering violent extremism",
            "This article explores the Socio-Religio-Academic Mentoring (SRAM) model applied in the UK.", "sram"))
        self.assertIsNone(self.paper("SRAM-like scheduling", "A study of school timetables.", "sram", field="Social Sciences"))
        self.assertIn("sram", self.paper("A 6T SRAM bitcell at 2 nm", "We report a 6T SRAM bitcell with nanosheet transistors.", "sram"))

    def test_materials_need_device_context(self):
        self.assertIsNone(self.paper("Graphene oxide membranes for water filtration",
                                     "Graphene oxide sheets filter salt from seawater.", "materials"))
        self.assertIn("materials", self.paper("Graphene contacts for MoS2 transistors",
                                              "Graphene edge contacts lower the contact resistance of MoS2 field-effect transistors.", "materials"))

    def test_one_passing_mention_is_not_enough_for_a_paper(self):
        self.assertIsNone(self.paper("Supply chains in retail", "We also mention DRAM once.", "dram"))



class SummarizerTest(unittest.TestCase):
    def test_structured_output_is_parsed_and_wired(self):
        from types import SimpleNamespace

        from devicehub.summarize import Summarizer
        s = Summarizer()
        calls = []

        def create(**kw):
            calls.append(kw)
            body = {"items": [{"id": "x1", "brief": "Short brief."}]}
            return SimpleNamespace(stop_reason="end_turn", stop_details=None,
                                   content=[SimpleNamespace(type="text", text=json.dumps(body))])

        s.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
        out = s.news_briefs([{"id": "x1", "title": "Micron ships HBM4", "description": ""}])
        self.assertEqual(out, {"x1": "Short brief."})
        kw = calls[0]
        self.assertEqual(kw["model"], "claude-opus-5-5")
        self.assertEqual(kw["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(kw["fallbacks"], "default")

    def test_relevance_check_only_narrows_candidates(self):
        from types import SimpleNamespace

        from devicehub.summarize import Summarizer
        s = Summarizer()
        body = {"items": [{"id": "a", "topics": []}, {"id": "b", "topics": ["hbf", "dram"]}]}
        s.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: SimpleNamespace(
            stop_reason="end_turn", stop_details=None, content=[SimpleNamespace(type="text", text=json.dumps(body))]))))
        items = [{"id": "a", "title": "HBF Park match", "topics": ["hbf"]},
                 {"id": "b", "title": "High bandwidth flash", "topics": ["hbf"]}]
        out = s.relevance(items, [{"id": "hbf", "name": "HBF"}], "news")
        self.assertEqual(out, {"a": [], "b": ["hbf"]})  # "dram" was not a candidate

    def test_refusal_returns_none(self):
        from types import SimpleNamespace

        from devicehub.summarize import Summarizer
        s = Summarizer()
        s.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(
            create=lambda **kw: SimpleNamespace(stop_reason="refusal", stop_details=None, content=[]))))
        self.assertEqual(s.news_briefs([{"id": "a", "title": "t"}]), {})


if __name__ == "__main__":
    unittest.main()
