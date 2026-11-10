# Device Hub

A news and research portal for nanoscale semiconductor devices, with DRAM, NAND flash and storage first, plus emerging memory (FeFET, MRAM, ReRAM), advanced logic devices (CFET, GAA), device materials, VLSI design, and an AI Hub.

**Topics** (one-click bar at the top of Home, News, Research, Research gaps and Publish, with an *All* option): DRAM & HBM · NAND flash & SSD · HBF (high-bandwidth flash) · Emerging memory (FeRAM, MRAM, ReRAM, PCM) · SRAM & embedded memory · Nano & logic transistors (CFET, GAA) · 2D & channel materials · Dielectrics & ferroelectrics · Interconnects & BEOL · Advanced packaging & 3D integration · Process, litho & fabs · Reliability & characterization · TCAD & device modeling · Power & wide-bandgap · VLSI & circuit design · Industry & market. The chosen topic is remembered between visits and can be linked directly, e.g. `#/news?cat=nand`.

Twice a day a GitHub Actions job fetches the latest news and papers, asks Claude to summarise them, commits the data and publishes a static site to GitHub Pages. No server to run.

## What's on the site

| Page | What it shows |
|---|---|
| **What's new** (bell, top right) | Count of stories and papers added since you last opened it, broken down by topic, with links. "Mark all as read" resets it (stored in your browser). |
| **Ticker** (top bar) | Scrolling share prices for Micron, Samsung, SK hynix, Kioxia, Sandisk, WDC, Seagate, TSMC, Intel, Nvidia, AMD, ASML, AMAT, Lam, KLA, TEL, Synopsys, Cadence and the SOX index. Fetched once a day. |
| **Home** | Today's briefing (Claude-written, every point linked to its source), latest news, new papers, top research gaps, market movers. |
| **News** | Two editions, **India** (stories connected to India from any outlet: India Semiconductor Mission, fabs/OSAT, Indian companies and institutes) and **International**, each split into **Technology & R&D** (new chips, layer counts, nodes, materials, research results), **Market & business** (earnings, prices, demand, deals, outlook; with a summary of this week's story count, most-mentioned companies, "what's expected next" headlines and today's share movers) and **Industry & other**. Link a section directly with `#/news?sec=market`. Company and industry news as image cards. Each item has a short summary, the source name and a link to the original article. Filter by topic or company, or search. Photos come from the publisher's feed; stories without one get a designed illustration for their topic. |
| **Research** | New papers grouped week by week, with a one-line TL;DR, a domain label, the full abstract, the paper's first figure (from arXiv's HTML version, when available) and direct links (paper page, PDF, DOI). Filter by topic, week, or arXiv vs journals, and search (e.g. "HZO", "IGZO", "MoS2"). |
| **Research gaps** | For each topic: what recent papers are doing, 3-5 open research gaps (what's missing, why it matters, suggested approach, difficulty), starter project ideas and papers to read first. **Open one-page report** gives a printable brief you can save as PDF or download as Markdown. |
| **AI Hub** | AI briefing, AI news, AI papers by week, "AI in devices & VLSI" playbook (how to apply ML/LLMs to TCAD, materials, compact models, yield, RTL, placement), and AI research gaps. |
| **Learn** | Free lectures and professors' courses grouped by topic (MIT OpenCourseWare, nanoHUB/Purdue, NPTEL, ETH Zürich, Coursera, IEEE EDS, imec), plus latest explainer videos, interviews and deep-dive newsletters. Follows the topic bar. |
| **Publish** | Where to send a paper. *Conferences*: 25 device, memory, packaging and VLSI meetings (IEDM, VLSI Symposium, ISSCC, IMW, IRPS, ECTC, DAC, …) ordered by the next paper deadline, with tier, location and a "deadline soon" flag. *Journals & transactions*: 37 journals (IEEE EDL, T-ED, JSSC, TCAD, Nature Electronics, Advanced Materials, APL, …) with an approximate Scimago quartile (Q1-Q4), type (Letters / Transactions / Journal), open-access flag, a link to check the current rank, and how many recent papers on the site came from each. Both follow the topic bar. |

Light theme is red (#E00400) on white with a solid red header, dark theme is red on black; the toggle is top right and it follows the system setting by default. Cards fade in as you scroll, tilt toward the mouse, numbers count up and the header has a moving circuit glow; all of it switches off when the device asks for reduced motion.

## Where the data comes from

- **News:** publisher RSS feeds (Semiconductor Engineering, EE Times, IEEE Spectrum, Blocks & Files, Tom's Hardware, The Register, Phys.org, TechPowerUp, plus AI feeds) and Google News RSS searches. Items from general feeds are kept only if they match a topic keyword.
- **Papers:** the [arXiv API](https://info.arxiv.org/help/api/) for preprints and the [OpenAlex API](https://openalex.org/) for journal and conference papers (IEEE, Elsevier, Nature, ACS, …).
  **Why not Google Scholar?** It has no official API and blocks automated queries (CAPTCHAs, IP bans), so a scheduled scraper would break within days and breach its terms. OpenAlex indexes the same publications with abstracts and is free and open.
- **Prices:** Yahoo Finance's chart endpoint, with Stooq as a fallback for US listings. Delayed quotes, refreshed on the first run of each day.
- **Summaries, briefings, research gaps, playbook:** the Claude API (`claude-opus-5-5` by default). AI-generated text is labelled on the site; always check the linked source.

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
| Research gaps page: a keyword snapshot per topic (paper counts this week vs last, recurring themes, main venues, most-cited and newest paper) | AI research-gap notes, trends, starter projects and the one-page report |
| AI Hub news and papers | Daily briefings (Home and AI Hub) and the "AI in devices & VLSI" playbook |
| Share-price ticker, Learn, Publish, What's new bell, light/dark themes | — |

Add the key later and the next scheduled run fills in the AI parts automatically, including summaries for items already on the site.

### Optional settings

| Name | Type | Purpose |
|---|---|---|
| `DEVICEHUB_MODEL` | Actions *variable* | Claude model to use. Default `claude-opus-5-5`. Set `claude-sonnet-5-5` to cut cost roughly in half. |
| `OPENALEX_EMAIL` | Actions *variable* | Contact email sent to OpenAlex (their "polite pool", faster responses). |
| `OPENALEX_API_KEY` | Actions *secret* | OpenAlex API key, if you have one, for higher limits. |

### Cost

Each run makes roughly 10-20 Claude calls (briefs for new news items and papers, two briefings), plus about 19 research-gap calls once a day (one per topic). With the default model expect around US$1.5-4 per day depending on how much news there is; switching to `claude-sonnet-5-5` roughly halves that.

## Customising

Everything the fetchers look for is in [`config.yaml`](config.yaml):

- `topics`: each topic's keywords (for tagging news) and search phrases (sent to arXiv/OpenAlex). Add a topic and it gets its own filter chip and research-gap page. `hub: ai` puts it on the AI Hub.
- `companies`: names used to tag news.
- `news_sections`: keywords that sort stories into Technology & R&D or Market & business.
- `news_queries` / `news_feeds`: Google News searches and RSS feeds. Prefix a query with `ai:` for the AI Hub.
- `tickers`: Yahoo Finance symbols for the scrolling bar.
- `learn_feeds`, `learn_queries`, `courses`: the Learn page (each course has `topics` and a `format`).
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
  papers.py              arXiv + OpenAlex fetch, relevance filter, weekly grouping
  market.py              daily share prices
  learn.py               videos, interviews, newsletters
  summarize.py           Claude: briefs, TL;DRs, briefings, research gaps, AI playbook
  run.py                 pipeline entry point
site/                    static front end (index.html, app.js, art.js, motion.js, styles.css) + data/*.json
.github/workflows/update.yml   schedule, commit data, deploy to Pages
```
