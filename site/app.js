/* Device Hub front end: loads data/*.json (written by the scheduled job) and renders pages. */
(function () {
  "use strict";

  var D = { meta: null, news: [], papers: [], market: null, learn: null, insights: null };
  var state = { newsTopic: "all", newsCompany: "", newsQuery: "", paperTopic: "all", paperSource: "all", paperQuery: "", paperWeek: "", radarTopic: "", aiTab: "news" };
  var app = document.getElementById("app");

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) {
    return /^https?:\/\//i.test(u || "") ? esc(u) : "#";
  }
  function ext(u, label) {
    return '<a href="' + safeUrl(u) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>";
  }
  function timeAgo(iso) {
    if (!iso) return "";
    var d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 7) return Math.round(s / 86400) + " d ago";
    return fmtDate(iso);
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function topicName(id) {
    var t = (D.meta && D.meta.topics || []).filter(function (x) { return x.id === id; })[0];
    return t ? t.name : id;
  }
  function topicsOf(hub) {
    return (D.meta && D.meta.topics || []).filter(function (t) { return t.hub === hub; });
  }
  function tagsHtml(it) {
    var h = (it.topics || []).map(function (t) { return '<span class="tag topic">' + esc(topicName(t)) + "</span>"; });
    (it.companies || []).slice(0, 4).forEach(function (c) { h.push('<span class="tag">' + esc(c) + "</span>"); });
    return h.length ? '<div class="tags">' + h.join("") + "</div>" : "";
  }
  function matches(it, q) {
    if (!q) return true;
    var hay = [it.title, it.brief, it.description, it.abstract, it.tldr, it.domain, it.venue, it.source, (it.authors || []).join(" "), (it.companies || []).join(" ")].join(" ").toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function byId() {
    var m = {};
    D.news.forEach(function (n) { m[n.id] = n; });
    D.papers.forEach(function (p) { m[p.id] = p; });
    return m;
  }
  function refsHtml(ids, index) {
    var links = (ids || []).map(function (id, i) {
      var it = index[id];
      return it ? '<a href="' + safeUrl(it.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(it.title) + '">[' + (i + 1) + "]</a>" : "";
    }).join("");
    return links ? ' <span class="refs">' + links + "</span>" : "";
  }
  function empty(msg) { return '<div class="empty">' + msg + "</div>"; }
  function noData() {
    return empty("No data yet. The first scheduled run fills this in (or run the <b>Update Device Hub</b> workflow from the repo's Actions tab).");
  }

  // ------------------------------------------------------------------ data
  function load(name) {
    var v = D.meta ? encodeURIComponent(D.meta.updated || "") : Date.now();
    return fetch("data/" + name + "?v=" + v).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function init() {
    fetch("data/meta.json?v=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (meta) {
        D.meta = meta || { topics: [], weeks: [], title: "Device Hub" };
        return Promise.all([load("news.json"), load("papers.json"), load("market.json"), load("learn.json"), load("insights.json")]);
      })
      .then(function (r) {
        D.news = (r[0] && r[0].items) || [];
        D.papers = (r[1] && r[1].items) || [];
        D.market = r[2];
        D.learn = r[3];
        D.insights = r[4];
        renderTicker();
        renderFooter();
        route();
      });
  }

  // ------------------------------------------------------------------ chrome
  function renderTicker() {
    var track = document.getElementById("ticker-track");
    var q = (D.market && D.market.quotes) || [];
    if (!q.length) { track.innerHTML = '<span class="ticker-empty">Share prices appear after the first daily update.</span>'; return; }
    var one = q.map(function (x) {
      var cls = x.change_pct == null ? "" : x.change_pct >= 0 ? "up" : "down";
      var arrow = x.change_pct == null ? "" : x.change_pct >= 0 ? "▲" : "▼";
      var chg = x.change_pct == null ? "" : arrow + " " + Math.abs(x.change_pct).toFixed(2) + "%";
      return '<span class="ticker-item"><b>' + esc(x.name) + '</b><span class="sym">' + esc(x.symbol) + "</span>" +
        "<span>" + esc(Number(x.price).toLocaleString(undefined, { maximumFractionDigits: 2 })) + " " + esc(x.currency || "") + "</span>" +
        '<span class="chg ' + cls + '">' + chg + "</span></span>";
    }).join("");
    track.innerHTML = one + one; // duplicated so the loop looks continuous
    track.style.animationDuration = Math.max(40, q.length * 6) + "s";
  }
  function renderFooter() {
    var m = D.meta || {};
    var bits = [];
    if (m.updated) bits.push("Last updated " + fmtDateTime(m.updated) + (m.edition ? " (" + m.edition + " edition)" : ""));
    if (D.market && D.market.updated) bits.push("prices as of " + fmtDate(D.market.updated));
    document.getElementById("footer-meta").textContent = bits.join(" · ");
  }
  function setActive(name) {
    Array.prototype.forEach.call(document.querySelectorAll("#nav a"), function (a) {
      a.classList.toggle("active", a.getAttribute("data-route") === name);
    });
  }

  // ------------------------------------------------------------------ shared blocks
  function briefingCard(hub) {
    var b = D.insights && D.insights.briefings && D.insights.briefings[hub];
    if (!b) return "";
    var idx = byId();
    return '<div class="card briefing">' +
      '<div class="kicker">' + (hub === "ai" ? "AI briefing" : "Today's briefing") + " · " + esc(fmtDateTime(b.generated)) + "</div>" +
      '<div class="headline">' + esc(b.headline) + "</div>" +
      "<ul>" + (b.points || []).map(function (p) { return "<li>" + esc(p.text) + refsHtml(p.ids, idx) + "</li>"; }).join("") + "</ul>" +
      ((b.watch || []).length ? '<p class="small muted"><b>Worth watching:</b> ' + b.watch.map(esc).join(" · ") + "</p>" : "") +
      "</div>";
  }
  function newsItem(n) {
    var text = n.brief || n.description || "";
    return '<article class="card item">' +
      "<h3>" + ext(n.url, n.title) + "</h3>" +
      '<div class="meta"><span>' + esc(n.source) + "</span><span>" + esc(timeAgo(n.published)) + "</span></div>" +
      (text ? "<p>" + esc(text) + "</p>" : "") +
      tagsHtml(n) +
      '<div class="links">' + ext(n.url, "Read at source ↗") + "</div>" +
      "</article>";
  }
  function paperItem(p) {
    var authors = (p.authors || []).slice(0, 4).join(", ") + ((p.authors || []).length > 4 ? " et al." : "");
    var links = [ext(p.url, p.source === "arXiv" ? "arXiv page ↗" : "Paper page ↗")];
    if (p.pdf) links.push(ext(p.pdf, "PDF ↗"));
    if (p.doi) links.push(ext("https://doi.org/" + p.doi, "DOI"));
    return '<article class="card item">' +
      (p.domain ? '<div class="domain">' + esc(p.domain) + "</div>" : "") +
      "<h3>" + ext(p.url, p.title) + "</h3>" +
      '<div class="meta">' + (authors ? "<span>" + esc(authors) + "</span>" : "") +
      (p.venue ? "<span>" + esc(p.venue) + "</span>" : "") + "<span>" + esc(fmtDate(p.published)) + "</span></div>" +
      (p.tldr ? '<p class="tldr">' + esc(p.tldr) + "</p>" : "") +
      (p.abstract ? '<details class="abstract"' + (p.tldr ? "" : " open") + "><summary>Abstract</summary><p>" + esc(p.abstract) + "</p></details>" : "") +
      tagsHtml(p) +
      '<div class="links">' + links.join("") + "</div>" +
      "</article>";
  }
  function chip(label, value, active, attr, count) {
    return '<button type="button" class="chip' + (active ? " active" : "") + '" data-' + attr + '="' + esc(value) + '">' +
      esc(label) + (count != null ? '<span class="count">' + count + "</span>" : "") + "</button>";
  }
  function bindChips(attr, key, rerender) {
    Array.prototype.forEach.call(app.querySelectorAll("[data-" + attr + "]"), function (b) {
      b.addEventListener("click", function () { state[key] = b.getAttribute("data-" + attr); rerender(); });
    });
  }
  function bindSearch(id, key, rerender) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", function () {
      state[key] = el.value;
      rerender(true);
    });
  }
  function refocus(id) {
    var el = document.getElementById(id);
    if (el) { el.focus(); var v = el.value; el.value = ""; el.value = v; }
  }

  // ------------------------------------------------------------------ pages
  function pageHome() {
    var dev = D.news.filter(function (n) { return n.hub === "device"; });
    var papers = D.papers.filter(function (p) { return p.hub === "device"; });
    var radar = D.insights && D.insights.topics || {};
    var radarIds = topicsOf("device").map(function (t) { return t.id; }).filter(function (id) { return radar[id]; });
    var q = (D.market && D.market.quotes) || [];
    var movers = q.filter(function (x) { return x.change_pct != null; }).slice().sort(function (a, b) { return Math.abs(b.change_pct) - Math.abs(a.change_pct); }).slice(0, 6);

    var h = '<div class="page-head"><div><h1>' + esc(D.meta.title || "Device Hub") + '</h1><p class="muted">' + esc(D.meta.tagline || "") + "</p></div></div>";
    h += '<div class="grid-2"><div>';
    h += briefingCard("device") || "";
    h += '<section><div class="section-title"><h2>Latest news</h2><a href="#/news">All news →</a></div>';
    h += dev.length ? '<div class="list">' + dev.slice(0, 8).map(newsItem).join("") + "</div>" : noData();
    h += "</section></div><div>";
    h += '<section><div class="section-title"><h2>New papers</h2><a href="#/research">All papers →</a></div>';
    h += papers.length ? '<div class="list">' + papers.slice(0, 5).map(function (p) {
      return '<article class="card item">' + (p.domain ? '<div class="domain">' + esc(p.domain) + "</div>" : "") +
        "<h3>" + ext(p.url, p.title) + '</h3><div class="meta"><span>' + esc(p.venue || p.source) + "</span><span>" + esc(fmtDate(p.published)) + "</span></div>" +
        (p.tldr ? "<p>" + esc(p.tldr) + "</p>" : "") + "</article>";
    }).join("") + "</div>" : noData();
    h += "</section>";
    if (radarIds.length) {
      h += '<section><div class="section-title"><h2>Research gaps</h2><a href="#/radar">Open radar →</a></div><div class="list">';
      radarIds.slice(0, 3).forEach(function (id) {
        var g = (radar[id].gaps || [])[0];
        if (g) h += '<a class="card item" href="#/radar/' + esc(id) + '" style="display:block;color:inherit;text-decoration:none"><div class="kicker">' + esc(topicName(id)) + "</div><h3>" + esc(g.title) + '</h3><p class="small muted">' + esc(g.what_is_missing) + "</p></a>";
      });
      h += "</div></section>";
    }
    if (movers.length) {
      h += '<section><div class="section-title"><h2>Market movers</h2></div><div class="card"><table class="market"><tbody>' +
        movers.map(function (x) {
          return "<tr><td>" + esc(x.name) + '</td><td class="num">' + esc(Number(x.price).toLocaleString()) + " " + esc(x.currency) + '</td><td class="num ' + (x.change_pct >= 0 ? "up" : "down") + '">' + (x.change_pct >= 0 ? "+" : "") + x.change_pct.toFixed(2) + "%</td></tr>";
        }).join("") + '</tbody></table><p class="small muted" style="margin:.5rem 0 0">Daily change, updated once a day.</p></div></section>';
    }
    h += "</div></div>";
    return h;
  }

  function newsList(hub, rerenderFn, searchId) {
    var items = D.news.filter(function (n) { return n.hub === hub; });
    var topics = topicsOf(hub);
    var counts = {};
    items.forEach(function (n) { (n.topics || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var companies = {};
    items.forEach(function (n) { (n.companies || []).forEach(function (c) { companies[c] = (companies[c] || 0) + 1; }); });
    var shown = items.filter(function (n) {
      return (state.newsTopic === "all" || (n.topics || []).indexOf(state.newsTopic) !== -1) &&
        (!state.newsCompany || (n.companies || []).indexOf(state.newsCompany) !== -1) && matches(n, state.newsQuery);
    });
    var h = '<div class="controls"><div class="chips">' + chip("All", "all", state.newsTopic === "all", "ntopic", items.length) +
      topics.map(function (t) { return chip(t.name, t.id, state.newsTopic === t.id, "ntopic", counts[t.id] || 0); }).join("") + "</div></div>";
    h += '<div class="controls"><input type="search" id="' + searchId + '" placeholder="Search headlines, companies, sources…" value="' + esc(state.newsQuery) + '" aria-label="Search news">';
    var cnames = Object.keys(companies).sort(function (a, b) { return companies[b] - companies[a]; });
    if (cnames.length) {
      h += '<select id="company-filter" aria-label="Filter by company"><option value="">All companies</option>' +
        cnames.map(function (c) { return '<option value="' + esc(c) + '"' + (state.newsCompany === c ? " selected" : "") + ">" + esc(c) + " (" + companies[c] + ")</option>"; }).join("") + "</select>";
    }
    h += "</div>";
    h += items.length ? (shown.length ? '<div class="list">' + shown.slice(0, 150).map(newsItem).join("") + "</div>" : empty("Nothing matches these filters.")) : noData();
    return h;
  }
  function bindNews(rerender, searchId) {
    bindChips("ntopic", "newsTopic", rerender);
    bindSearch(searchId, "newsQuery", rerender);
    var sel = document.getElementById("company-filter");
    if (sel) sel.addEventListener("change", function () { state.newsCompany = sel.value; rerender(); });
  }

  function pageNews() {
    function render(keepFocus) {
      app.innerHTML = '<div class="page-head"><div><h1>News</h1><p class="muted">What memory, storage, device and VLSI companies are doing. Short AI summary, original source one click away.</p></div></div>' +
        newsList("device", render, "news-search");
      bindNews(render, "news-search");
      if (keepFocus) refocus("news-search");
    }
    render();
  }

  function papersBlock(hub, searchId) {
    var items = D.papers.filter(function (p) { return p.hub === hub; });
    var weeks = [];
    items.forEach(function (p) { if (weeks.indexOf(p.week) === -1) weeks.push(p.week); });
    weeks.sort().reverse();
    var labels = {};
    (D.meta.weeks || []).forEach(function (w) { labels[w.key] = w.label; });
    var topics = topicsOf(hub);
    var shown = items.filter(function (p) {
      return (state.paperTopic === "all" || (p.topics || []).indexOf(state.paperTopic) !== -1) &&
        (state.paperSource === "all" || (state.paperSource === "arxiv" ? p.source === "arXiv" : p.source !== "arXiv")) &&
        (!state.paperWeek || p.week === state.paperWeek) && matches(p, state.paperQuery);
    });
    var h = '<div class="controls"><div class="chips">' + chip("All topics", "all", state.paperTopic === "all", "ptopic") +
      topics.map(function (t) { return chip(t.name, t.id, state.paperTopic === t.id, "ptopic"); }).join("") + "</div></div>";
    h += '<div class="controls"><input type="search" id="' + searchId + '" placeholder="Search titles, abstracts, authors, materials (e.g. HZO, IGZO, MoS2)…" value="' + esc(state.paperQuery) + '" aria-label="Search papers">' +
      '<select id="paper-week" aria-label="Week"><option value="">All weeks</option>' + weeks.map(function (w) {
        return '<option value="' + esc(w) + '"' + (state.paperWeek === w ? " selected" : "") + ">" + esc(labels[w] || w) + "</option>";
      }).join("") + "</select>" +
      '<select id="paper-source" aria-label="Source"><option value="all">All sources</option><option value="arxiv"' + (state.paperSource === "arxiv" ? " selected" : "") + '>arXiv preprints</option><option value="journal"' + (state.paperSource === "journal" ? " selected" : "") + ">Journals & conferences</option></select></div>";
    if (!items.length) return h + noData();
    if (!shown.length) return h + empty("No papers match these filters.");
    weeks.forEach(function (w) {
      var wk = shown.filter(function (p) { return p.week === w; });
      if (!wk.length) return;
      h += '<section class="week-group"><div class="section-title"><h2>' + (w === weeks[0] ? "This week" : "Week") + ' <span class="muted">' + esc(labels[w] || w) + "</span></h2><span class=\"muted small\">" + wk.length + " papers</span></div>" +
        '<div class="list">' + wk.map(paperItem).join("") + "</div></section>";
    });
    return h;
  }
  function bindPapers(rerender, searchId) {
    bindChips("ptopic", "paperTopic", rerender);
    bindSearch(searchId, "paperQuery", rerender);
    var w = document.getElementById("paper-week");
    if (w) w.addEventListener("change", function () { state.paperWeek = w.value; rerender(); });
    var s = document.getElementById("paper-source");
    if (s) s.addEventListener("change", function () { state.paperSource = s.value; rerender(); });
  }

  function pageResearch() {
    function render(keepFocus) {
      app.innerHTML = '<div class="page-head"><div><h1>Research</h1><p class="muted">New papers on DRAM, NAND, emerging memory, CFET/GAA logic devices, device materials and VLSI, grouped by week. From arXiv and OpenAlex (journals and conferences).</p></div>' +
        '<a class="btn ghost" href="#/radar">Research gaps →</a></div>' + papersBlock("device", "paper-search");
      bindPapers(render, "paper-search");
      if (keepFocus) refocus("paper-search");
    }
    render();
  }

  function radarView(id, ins) {
    var idx = byId();
    var h = '<div class="card" style="margin-bottom:1rem"><div class="kicker">' + esc(ins.name || topicName(id)) + " · based on " + (ins.paper_count || 0) + " recent papers · " + esc(fmtDate(ins.generated)) + "</div>" +
      "<p>" + esc(ins.overview) + "</p>" +
      '<div class="report-actions" style="margin:0"><a class="btn" href="#/report/' + esc(id) + '">Open one-page report</a></div></div>';
    if ((ins.trends || []).length) {
      h += '<section><div class="section-title"><h2>What is being done</h2></div><div class="list">' + ins.trends.map(function (t) {
        return '<div class="card item"><h3>' + esc(t.title) + refsHtml(t.ids, idx) + "</h3><p>" + esc(t.detail) + "</p></div>";
      }).join("") + "</div></section>";
    }
    if ((ins.gaps || []).length) {
      h += '<section><div class="section-title"><h2>Research gaps you could work on</h2></div><div class="grid-cards">' + ins.gaps.map(function (g) {
        return '<div class="card gap"><span class="badge ' + esc(g.difficulty) + '">' + esc(g.difficulty) + "</span><h3 style=\"margin-top:.4rem\">" + esc(g.title) + "</h3><dl>" +
          "<dt>What's missing</dt><dd>" + esc(g.what_is_missing) + "</dd>" +
          "<dt>Why it matters</dt><dd>" + esc(g.why_it_matters) + "</dd>" +
          "<dt>Suggested approach</dt><dd>" + esc(g.suggested_approach) + "</dd></dl>" +
          ((g.ids || []).length ? '<p class="small muted" style="margin:.5rem 0 0">Related:' + refsHtml(g.ids, idx) + "</p>" : "") + "</div>";
      }).join("") + "</div></section>";
    }
    if ((ins.starter_projects || []).length) {
      h += '<section><div class="section-title"><h2>Starter project ideas</h2></div><div class="card"><ul style="margin:0;padding-left:1.1rem">' +
        ins.starter_projects.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul></div></section>";
    }
    var key = (ins.key_papers || []).map(function (k) { return idx[k]; }).filter(Boolean);
    if (key.length) {
      h += '<section><div class="section-title"><h2>Read these first</h2></div><div class="list">' + key.map(paperItem).join("") + "</div></section>";
    }
    return h;
  }

  function pageRadar(hub, topicId) {
    var radar = D.insights && D.insights.topics || {};
    var topics = topicsOf(hub).filter(function (t) { return radar[t.id]; });
    var title = hub === "ai" ? "" : '<div class="page-head"><div><h1>Research gaps</h1><p class="muted">For each area: what recent papers are doing, where the open gaps are, and ideas to start on. Refreshed daily from the latest papers. Open a one-page report to print or save.</p></div></div>';
    if (!topics.length) {
      return title + empty(D.meta.llm && D.meta.llm.enabled ? "The research radar is generated once a day and will appear after the next run." :
        "Research-gap notes need the Claude API. Add the <code>ANTHROPIC_API_KEY</code> secret to the repository to switch them on.");
    }
    var cur = topicId && radar[topicId] ? topicId : (state.radarTopic && radar[state.radarTopic] && topics.some(function (t) { return t.id === state.radarTopic; }) ? state.radarTopic : topics[0].id);
    state.radarTopic = cur;
    return title + '<div class="controls"><div class="chips">' + topics.map(function (t) { return chip(t.name, t.id, t.id === cur, "rtopic"); }).join("") + "</div></div>" + radarView(cur, radar[cur]);
  }

  function reportMarkdown(id, ins) {
    var idx = byId();
    function refs(ids) {
      return (ids || []).map(function (k) { return idx[k]; }).filter(Boolean).map(function (p) { return "[" + p.title + "](" + p.url + ")"; }).join("; ");
    }
    var md = "# Research brief: " + (ins.name || topicName(id)) + "\n\n_Device Hub · " + fmtDate(ins.generated) + " · based on " + (ins.paper_count || 0) + " recent papers_\n\n";
    md += "## Where the field is\n\n" + ins.overview + "\n\n## What is being done\n\n";
    (ins.trends || []).forEach(function (t) { md += "- **" + t.title + "** - " + t.detail + (refs(t.ids) ? " (" + refs(t.ids) + ")" : "") + "\n"; });
    md += "\n## Research gaps\n\n";
    (ins.gaps || []).forEach(function (g, i) {
      md += (i + 1) + ". **" + g.title + "** (" + g.difficulty + ")\n   - Missing: " + g.what_is_missing + "\n   - Why it matters: " + g.why_it_matters + "\n   - Approach: " + g.suggested_approach + "\n" + (refs(g.ids) ? "   - Related: " + refs(g.ids) + "\n" : "");
    });
    if ((ins.starter_projects || []).length) {
      md += "\n## Starter projects\n\n" + ins.starter_projects.map(function (s) { return "- " + s; }).join("\n") + "\n";
    }
    var key = (ins.key_papers || []).map(function (k) { return idx[k]; }).filter(Boolean);
    if (key.length) md += "\n## Read first\n\n" + key.map(function (p) { return "- [" + p.title + "](" + p.url + ")" + (p.venue ? " - " + p.venue : ""); }).join("\n") + "\n";
    md += "\n_AI-generated from paper abstracts; verify against the original papers._\n";
    return md;
  }

  function pageReport(id) {
    var ins = D.insights && D.insights.topics && D.insights.topics[id];
    if (!ins) { app.innerHTML = empty("No report for this topic yet."); return; }
    var idx = byId();
    function refList(ids) {
      var items = (ids || []).map(function (k) { return idx[k]; }).filter(Boolean);
      return items.length ? ' <span class="small muted">(' + items.map(function (p) { return ext(p.url, p.title.length > 60 ? p.title.slice(0, 57) + "…" : p.title); }).join("; ") + ")</span>" : "";
    }
    var key = (ins.key_papers || []).map(function (k) { return idx[k]; }).filter(Boolean);
    var back = ins.hub === "ai" ? "#/ai" : "#/radar/" + esc(id);
    app.innerHTML = '<div class="report">' +
      '<div class="report-actions"><a class="btn ghost" href="' + back + '">← Back</a><button class="btn" type="button" id="print-report">Print / save as PDF</button><button class="btn ghost" type="button" id="md-report">Download Markdown</button></div>' +
      '<div class="kicker">Device Hub research brief</div><h1>' + esc(ins.name || topicName(id)) + "</h1>" +
      '<p class="muted small">' + esc(fmtDate(ins.generated)) + " · based on " + (ins.paper_count || 0) + " recent papers · AI-generated from abstracts, so verify against the papers</p>" +
      "<h2>Where the field is</h2><p>" + esc(ins.overview) + "</p>" +
      "<h2>What is being done</h2><ul>" + (ins.trends || []).map(function (t) { return "<li><b>" + esc(t.title) + ".</b> " + esc(t.detail) + refList(t.ids) + "</li>"; }).join("") + "</ul>" +
      "<h2>Research gaps</h2><ol>" + (ins.gaps || []).map(function (g) {
        return "<li><b>" + esc(g.title) + "</b> <span class=\"badge " + esc(g.difficulty) + "\">" + esc(g.difficulty) + "</span><br>" + esc(g.what_is_missing) + " <i>Why it matters:</i> " + esc(g.why_it_matters) + " <i>Approach:</i> " + esc(g.suggested_approach) + refList(g.ids) + "</li>";
      }).join("") + "</ol>" +
      ((ins.starter_projects || []).length ? "<h2>Starter projects</h2><ul>" + ins.starter_projects.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" : "") +
      (key.length ? "<h2>Read first</h2><ul>" + key.map(function (p) { return "<li>" + ext(p.url, p.title) + (p.venue ? ' <span class="muted small">' + esc(p.venue) + "</span>" : "") + "</li>"; }).join("") + "</ul>" : "") +
      "</div>";
    document.getElementById("print-report").addEventListener("click", function () { window.print(); });
    document.getElementById("md-report").addEventListener("click", function () {
      var blob = new Blob([reportMarkdown(id, ins)], { type: "text/markdown" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "device-hub-" + id + "-" + (ins.generated || "").slice(0, 10) + ".md";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }

  function playbookHtml() {
    var pb = D.insights && D.insights.playbook;
    if (!pb) return empty("The AI-in-devices playbook is generated daily once the Claude API key is set.");
    var idx = byId();
    return '<div class="card" style="margin-bottom:1rem"><div class="kicker">Using AI in device & VLSI research · ' + esc(fmtDate(pb.generated)) + "</div><p>" + esc(pb.intro) + "</p></div>" +
      '<div class="grid-cards">' + (pb.applications || []).map(function (a) {
        return '<div class="card gap"><h3>' + esc(a.area) + refsHtml(a.ids, idx) + "</h3><p>" + esc(a.how) + "</p>" +
          ((a.tools || []).length ? '<div class="tags" style="margin-bottom:.5rem">' + a.tools.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>" : "") +
          ((a.first_steps || []).length ? "<dl><dt>First steps</dt><dd><ol style=\"margin:.2rem 0 0;padding-left:1.1rem\">" + a.first_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol></dd></dl>" : "") + "</div>";
      }).join("") + "</div>" +
      ((pb.skills || []).length ? '<section><div class="section-title"><h2>Skills to learn</h2></div><div class="tags">' + pb.skills.map(function (s) { return '<span class="tag topic" style="font-size:.85rem;padding:.25rem .7rem">' + esc(s) + "</span>"; }).join("") + "</div></section>" : "");
  }

  function pageAI() {
    var tabs = [["news", "AI news"], ["papers", "AI research"], ["playbook", "AI in devices & VLSI"], ["radar", "AI research gaps"]];
    function render(keepFocus) {
      var h = '<div class="page-head"><div><h1>AI Hub</h1><p class="muted">Latest AI news and research, and how AI is being applied to device physics, materials, EDA and VLSI design.</p></div></div>';
      h += briefingCard("ai");
      h += '<div class="controls" style="margin-top:1.2rem"><div class="chips">' + tabs.map(function (t) { return chip(t[1], t[0], state.aiTab === t[0], "aitab"); }).join("") + "</div></div>";
      if (state.aiTab === "news") h += newsList("ai", render, "ai-news-search");
      else if (state.aiTab === "papers") h += papersBlock("ai", "ai-paper-search");
      else if (state.aiTab === "playbook") h += playbookHtml();
      else h += pageRadar("ai");
      app.innerHTML = h;
      bindChips("aitab", "aiTab", function () { state.newsTopic = "all"; state.paperTopic = "all"; state.paperWeek = ""; render(); });
      if (state.aiTab === "news") bindNews(render, "ai-news-search");
      if (state.aiTab === "papers") bindPapers(render, "ai-paper-search");
      if (state.aiTab === "radar") bindChips("rtopic", "radarTopic", render);
      if (keepFocus) refocus(state.aiTab === "news" ? "ai-news-search" : "ai-paper-search");
    }
    render();
  }

  function pageLearn() {
    var L = D.learn || {};
    var items = L.items || [];
    var videos = items.filter(function (i) { return i.kind === "video"; });
    var talks = items.filter(function (i) { return i.kind === "interview"; });
    var reads = items.filter(function (i) { return i.kind === "article"; });
    var h = '<div class="page-head"><div><h1>Learn</h1><p class="muted">Explainers, interviews, keynotes and courses on semiconductors, memory, devices and VLSI.</p></div></div>';
    h += '<section><div class="section-title"><h2>Latest videos</h2></div>' + (videos.length ? '<div class="grid-cards">' + videos.slice(0, 12).map(function (v) {
      return '<a class="card video" href="' + safeUrl(v.url) + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none">' +
        (v.thumbnail ? '<img loading="lazy" src="' + safeUrl(v.thumbnail) + '" alt="">' : "") +
        '<div class="body"><h3>' + esc(v.title) + '</h3><div class="meta"><span>' + esc(v.source) + "</span><span>" + esc(timeAgo(v.published)) + "</span></div></div></a>";
    }).join("") + "</div>" : noData()) + "</section>";
    h += '<div class="grid-2"><section><div class="section-title"><h2>Interviews & keynotes</h2></div>' + (talks.length ? '<div class="list">' + talks.slice(0, 12).map(newsItem).join("") + "</div>" : noData()) + "</section>";
    h += '<section style="margin-top:0"><div class="section-title"><h2>Deep-dive reads</h2></div>' + (reads.length ? '<div class="list">' + reads.slice(0, 10).map(function (r) {
      return '<article class="card item"><h3>' + ext(r.url, r.title) + '</h3><div class="meta"><span>' + esc(r.source) + "</span><span>" + esc(timeAgo(r.published)) + "</span></div>" + (r.description ? '<p class="small">' + esc(r.description) + "</p>" : "") + "</article>";
    }).join("") + "</div>" : noData()) + "</section></div>";
    h += '<section><div class="section-title"><h2>Courses & lecture series</h2></div><div class="grid-cards">' + (L.courses || []).map(function (c) {
      return '<a class="card item" href="' + safeUrl(c.url) + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none"><h3>' + esc(c.title) + '</h3><div class="meta"><span>' + esc(c.by) + "</span></div>" +
        '<div class="tags">' + (c.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div></a>";
    }).join("") + "</div></section>";
    app.innerHTML = h;
  }

  function pageEvents() {
    var conf = (D.learn && D.learn.conferences) || [];
    var h = '<div class="page-head"><div><h1>Events</h1><p class="muted">The conferences where new memory, device and VLSI results are announced. Papers and news from these show up in Research and News when they appear.</p></div></div>';
    h += conf.length ? '<div class="grid-cards">' + conf.map(function (c) {
      return '<a class="card item" href="' + safeUrl(c.url) + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none"><div class="kicker">' + esc(c.month) + "</div><h3>" + esc(c.name) + '</h3><p class="small muted">' + esc(c.focus) + "</p></a>";
    }).join("") + "</div>" : noData();
    app.innerHTML = h;
  }

  // ------------------------------------------------------------------ router
  function route() {
    var parts = (location.hash.replace(/^#\/?/, "") || "home").split("/");
    var name = parts[0];
    setActive(name === "report" ? (D.insights && D.insights.topics && D.insights.topics[parts[1]] && D.insights.topics[parts[1]].hub === "ai" ? "ai" : "radar") : name);
    if (name === "news") { state.newsTopic = state.newsTopic && topicsOf("device").some(function (t) { return t.id === state.newsTopic; }) ? state.newsTopic : "all"; pageNews(); }
    else if (name === "research") { state.paperTopic = topicsOf("device").some(function (t) { return t.id === state.paperTopic; }) ? state.paperTopic : "all"; pageResearch(); }
    else if (name === "radar") {
      var render = function () { app.innerHTML = pageRadar("device", parts[1]); parts[1] = null; bindChips("rtopic", "radarTopic", render); };
      render();
    }
    else if (name === "report") pageReport(parts[1]);
    else if (name === "ai") { state.newsTopic = "all"; state.paperTopic = "all"; pageAI(); }
    else if (name === "learn") pageLearn();
    else if (name === "events") pageEvents();
    else { setActive("home"); app.innerHTML = pageHome(); }
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ theme
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var root = document.documentElement;
    var cur = root.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("dh-theme", next); } catch (e) {}
  });

  window.addEventListener("hashchange", route);
  init();
})();
