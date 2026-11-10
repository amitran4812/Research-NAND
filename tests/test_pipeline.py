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

        news = self.load("news.json")["items"]
        titles = [n["title"] for n in news]
        # Publisher-feed copy wins over the Google News duplicate, and has a real link.
        sk = [n for n in news if "321-layer" in n["title"]]
        self.assertEqual(len(sk), 1)
        self.assertEqual(sk[0]["url"], "https://blocksandfiles.com/321")
        self.assertEqual(sk[0]["image"], "https://blocksandfiles.com/img/321.jpg")
        self.assertIn("nand", sk[0]["topics"])
        self.assertIn("SK hynix", sk[0]["companies"])
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


class TaggerTest(unittest.TestCase):
    def test_whole_word_matching(self):
        from devicehub.common import Tagger, load_config
        t = Tagger(load_config())
        self.assertNotIn("emerging-memory", t.topics_for("Pcmag reviews the newest laptop"))
        self.assertIn("logic-devices", t.topics_for("imec shows CFET with backside power"))
        self.assertIn("ai-for-vlsi", t.topics_for("LLM writes Verilog for chip design", hub="ai"))



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

    def test_refusal_returns_none(self):
        from types import SimpleNamespace

        from devicehub.summarize import Summarizer
        s = Summarizer()
        s.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(
            create=lambda **kw: SimpleNamespace(stop_reason="refusal", stop_details=None, content=[]))))
        self.assertEqual(s.news_briefs([{"id": "a", "title": "t"}]), {})


if __name__ == "__main__":
    unittest.main()
