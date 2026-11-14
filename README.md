# Device Hub

A news and research portal for nanoscale semiconductor devices, with DRAM, NAND flash and storage first, plus emerging memory (FeFET, MRAM, ReRAM), advanced logic devices (CFET, GAA), device materials, VLSI design, and an AI Hub.

**Topics** (one-click bar at the top of Home, News, Research and Publish, with an *All* option): DRAM & HBM · NAND flash & SSD · HBF (high-bandwidth flash) · Emerging memory (FeRAM, MRAM, ReRAM, PCM) · SRAM & embedded memory · Nano & logic transistors (CFET, GAA) · 2D & channel materials · Dielectrics & ferroelectrics · Interconnects & BEOL · Advanced packaging & 3D integration · Process, litho & fabs · Reliability & characterization · TCAD & device modeling · Power & wide-bandgap · VLSI & circuit design · Industry & market. Every visit opens on *All*; a topic can still be linked directly, e.g. `#/news?cat=nand`.

Twice a day a GitHub Actions job fetches the latest news and papers, asks Claude to summarise them, commits the data and publishes a static site to GitHub Pages. No server to run.

## What's on the site

| Page | What it shows |
|---|---|
| **What's new** (bell, top right) | Count of stories and papers added since you last opened it, broken down by topic, with links. "Mark all as read" resets it (stored in your browser). |
| **Ticker** (top bar) | Scrolling share prices for Micron, Samsung, SK hynix, Kioxia, Sandisk, WDC, Seagate, TSMC, Intel, Nvidia, AMD, ASML, AMAT, Lam, KLA, TEL, Synopsys, Cadence and the SOX index. Fetched once a day. |
| **Home** | Today's briefing (Claude-written, every point linked to its source), latest news, new papers, market movers. |
| **News** | Two editions, **India** (stories connected to India from any outlet: India Semiconductor Mission, fabs/OSAT, Indian companies and institutes) and **International**, each split into **Technology & R&D** (new chips, layer counts, nodes, materials, research results), **Market & business** (earnings, prices, demand, deals, outlook; with a summary of this week's story count, most-mentioned companies, "what's expected next" headlines and today's share movers) and **Industry & other**. Link a section directly with `#/news?sec=market`. Company and industry news as image cards. Each item has a short summary, the source name and a link to the original article. Filter by topic or company, or search. Photos come from the publisher's feed; stories without one get a designed illustration for their topic. |
| **Research** | New papers grouped week by week, with a one-line TL;DR, a domain label, the full abstract, the paper's first figure (from arXiv's HTML version, when available) and direct links (paper page, PDF, DOI). Filter by topic, week, or arXiv vs journals, and search (e.g. "HZO", "IGZO", "MoS2"). |
| **AI Hub** | AI briefing, AI news, AI papers by week, "AI in devices & VLSI" playbook (how to apply ML/LLMs to TCAD, materials, compact models, yield, RTL, placement). |
| **Learn** | A library of 34 free video courses (NPTEL from IIT/IISc professors, MIT OpenCourseWare, nanoHUB/Purdue) split into **Devices** (device physics, device modeling, power devices, nanoelectronics & fabrication) and **Circuits** (analog, analog IC design, digital, digital VLSI), with subject, provider and level filters and a search box. Below it, more free lectures and professors' courses grouped by topic (MIT OpenCourseWare, nanoHUB/Purdue, NPTEL, ETH Zürich, Coursera, IEEE EDS, imec), plus latest explainer videos, interviews and deep-dive newsletters. Follows the topic bar. |
| **Publish** | Where to send a paper. *Conferences*: 25 device, memory, packaging and VLSI meetings (IEDM, VLSI Symposium, ISSCC, IMW, IRPS, ECTC, DAC, …) ordered by the next paper deadline, with tier, location and a "deadline soon" flag. *Journals & transactions*: 37 journals (IEEE EDL, T-ED, JSSC, TCAD, Nature Electronics, Advanced Materials, APL, …) with an approximate Scimago quartile (Q1-Q4), type (Letters / Transactions / Journal), open-access flag, a link to check the current rank, and how many recent papers on the site came from each. Both follow the topic bar. |

Light theme is red (#E00400) on white with a solid red header, dark theme is red on black; the toggle is top right and it follows the system setting by default. Cards fade in as you scroll, tilt toward the mouse, numbers count up and the header has a moving circuit glow; all of it switches off when the device asks for reduced motion.

## Where the data comes from

- **News:** publisher RSS feeds (Semiconductor Engineering, EE Times, IEEE Spectrum, Blocks & Files, Tom's Hardware, The Register, Phys.org, TechPowerUp, plus AI feeds) and Google News RSS searches. Every story is checked for relevance (see *How off-topic items are kept out* below).
- **Papers:** the [arXiv API](https://info.arxiv.org/help/api/) for preprints, the [OpenAlex API](https://openalex.org/) for journal and conference papers (IEEE, Elsevier, Nature, ACS, …) and the [Semantic Scholar API](https://www.semanticscholar.org/product/api) as a second index. OpenAlex is searched once per topic phrase, and the newest papers of core device journals (IEEE EDL, TED, JEDS, TDMR, JSSC, TVLSI, Nature Electronics, …, listed in `research.venues`) are pulled by ISSN. The last 60 days are fetched each run and 12 weeks are kept. Every paper card links the paper, its PDF/DOI when known, and a Google Scholar search for the title.
  **Why not Google Scholar?** It has no official API and blocks automated queries (CAPTCHAs, IP bans), so a scheduled scraper would break within days and breach its terms. OpenAlex indexes the same publications with abstracts and is free and open.
- **Prices:** Yahoo Finance's chart endpoint, with Stooq as a fallback for US listings. Delayed quotes, refreshed on the first run of each day.
- **Summaries, briefings, relevance second opinion, playbook:** the Claude API (`claude-opus-5-5` by default). AI-generated text is labelled on the site; always check the linked source.

## How off-topic items are kept out

A keyword in the headline is not enough. Each paper's **abstract** and each story's **description** is read, and an item is kept only when:

1. **It is in the right domain.** Device pages need semiconductor context somewhere in the text (transistor, wafer, DRAM, foundry, a chip company, ...), the AI Hub needs AI context. "HBF Park" (a football stadium), HbF (fetal hemoglobin) and the HBF stock ticker have none, so they are dropped, while "Could HBF be the solution to the memory bottleneck?" stays.
2. **It is not from an unrelated field.** Stems such as *religio*, *jurisprud*, *hemoglobin*, *stadium*, *clinical*, *livestock* rule an item out (`relevance.*.exclude`), and OpenAlex papers must be filed under Engineering, Materials Science, Physics, Computer Science, Chemistry, Energy or Mathematics (Semantic Scholar papers likewise, via `relevance.s2_fields`). Papers from the core journals in `research.venues` skip the domain-word check, and when the publisher hides the abstract they are judged by the title. So a paper on Islamic jurisprudence that happens to use an LLM is not shown as AI research, and a social-science "SRAM" mentoring model is not shown as memory.
3. **It is really about the topic.** A title mention scores 3, a mention in the abstract or description scores 1. Stories need 1; papers need 2, so a single passing mention in an abstract is not enough. Short acronyms and everyday words (HBF, PCM, ALD, yield, retention, graphene, ...) are listed as `ambiguous` and only count next to semiconductor context.
4. **Claude agrees (when the API key is set).** Each new item that passes the rules is sent with its abstract or description, and Claude removes topics that turn out to be coincidental matches. The verdict is stored, so each item is checked once.

The rules are re-applied to the whole archive on every run, so tightening `config.yaml` also cleans items already on the site.

## Setup (one time)

1. **(Optional, can be done later) Add your Claude API key.** Repo → Settings → Secrets and variables → Actions → *New repository secret*: name `ANTHROPIC_API_KEY`, value from <https://console.anthropic.com/>. See *Without the API key* below for what changes.
2. **Turn on GitHub Pages.** Repo → Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
3. **Run it once now.** Repo → Actions → *Update Device Hub* → *Run workflow*. After it finishes, the site is at `https://<your-username>.github.io/Research-NAND/`.

From then on it runs at 00:30 and 12:30 UTC every day (06:00 and 18:00 IST). Change the `cron` lines in `.github/workflows/update.yml` for other times.

### Without the API key

Everything except the AI-written text works with no key and no cost:

| Works without a key | Needs `ANTHROPIC_API_KEY` |
|---|---|
| News from all feeds, topic bar, company filter, search, source links, images | Two-sentence AI summary on each story (without it you see the publisher's own description, or just the headline for Google News items) |
| Papers by week with full abstracts, figures, PDF/DOI links, filters, search | One-line TL;DR and domain label on each paper |
| Relevance filter on titles + abstracts / descriptions | Claude's second opinion on each new item's abstract or description |
| AI Hub news and papers | Daily briefings (Home and AI Hub) and the "AI in devices & VLSI" playbook |
| Share-price ticker, Learn, Publish, What's new bell, light/dark themes | — |

Add the key later and the next scheduled run fills in the AI parts automatically, including summaries for items already on the site.

### Optional settings

| Name | Type | Purpose |
|---|---|---|
| `DEVICEHUB_MODEL` | Actions *variable* | Claude model to use. Default `claude-opus-5-5`. Set `claude-sonnet-5-5` to cut cost roughly in half. |
| `OPENALEX_EMAIL` | Actions *variable* | Contact email sent to OpenAlex (their "polite pool", faster responses). |
| `OPENALEX_API_KEY` | Actions *secret* | OpenAlex API key, if you have one, for higher limits. |
| `S2_API_KEY` | Actions *secret* | Optional Semantic Scholar API key (free on request); without it the shared public rate limit applies. |

### Cost

Each run makes roughly 10-20 Claude calls (briefs for new news items and papers, relevance checks for new items, two briefings), plus one playbook call a day. With the default model expect around US$1.5-4 per day depending on how much news there is; switching to `claude-sonnet-5-5` roughly halves that.

## Customising

Everything the fetchers look for is in [`config.yaml`](config.yaml):

- `topics`: each topic's keywords (for tagging news) and search phrases (sent to arXiv/OpenAlex). `ambiguous` and `exclude` tune the relevance check (below). Add a topic and it gets its own filter chip. `hub: ai` puts it on the AI Hub.
- `relevance`: the domain words each hub needs, the stems of unrelated fields that rule an item out, and the OpenAlex subject fields papers must belong to.
- `companies`: names used to tag news.
- `news_sections`: keywords that sort stories into Technology & R&D or Market & business.
- `news_queries` / `news_feeds`: Google News searches and RSS feeds. Prefix a query with `ai:` for the AI Hub.
- `tickers`: Yahoo Finance symbols for the scrolling bar.
- `learn_feeds`, `learn_queries`, `courses`: the Learn page (each course has `topics` and a `format`).
- `library.yaml`: the free video course library on Learn. Each course has a `group` (devices or circuits), a `subject` from the `subjects` list, a `level`, a `provider` and a direct `url`.
- `india`: keywords and Indian outlets that put a story in the India edition of News.

Conferences and journals for the Publish page live in [`venues.yaml`](venues.yaml): usual deadline and meeting months, tier, quartile, topics and links. Deadlines move a little each year, so the site calls them typical and links each call for papers.

## Running locally

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...        # optional
python -m devicehub.run              # all stages; or --only news,papers / --no-llm
python -m http.server -d site 8000   # open http://localhost:8000
python -m unittest discover -s tests # offline tests
```

## Layout

```
config.yaml              topics, feeds, tickers, courses
venues.yaml              conferences and journals for the Publish page
devicehub/
  news.py                RSS + Google News fetch, tagging, de-duplication
  papers.py              arXiv + OpenAlex + Semantic Scholar fetch, relevance filter, weekly grouping
  market.py              daily share prices
  learn.py               videos, interviews, newsletters
  summarize.py           Claude: briefs, TL;DRs, relevance checks, briefings, AI playbook
  run.py                 pipeline entry point
site/                    static front end (index.html, app.js, art.js, motion.js, styles.css) + data/*.json
.github/workflows/update.yml   schedule, commit data, deploy to Pages
```
