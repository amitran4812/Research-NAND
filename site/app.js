/* Device Hub front end: loads data/*.json (written by the scheduled job) and renders pages. */
(function () {
  "use strict";

  var D = { meta: null, news: [], papers: [], market: null, learn: null, insights: null };
  var state = { cat: "all", newsCompany: "", newsQuery: "", paperSource: "all", paperQuery: "", paperWeek: "", aiTab: "news", aiTopic: "all", radarTopic: "" };
  try { state.cat = localStorage.getItem("dh-cat") || "all"; } catch (e) {}
  var DEVICE_ROUTES = ["home", "news", "research", "radar"];
  var app = document.getElementById("app");

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? esc(u) : "#"; }
  function ext(u, label, cls) {
    return '<a' + (cls ? ' class="' + cls + '"' : "") + ' href="' + safeUrl(u) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>";
  }
  function timeAgo(iso) {
    if (!iso) return "";
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
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
    return isNaN(d) ? "" : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function topicName(id) {
    var t = (D.meta && D.meta.topics || []).filter(function (x) { return x.id === id; })[0];
    return t ? t.name : id;
  }
  function shortTopic(id) { return topicName(id).replace(/\s*\(.*\)$/, ""); }
  function topicsOf(hub) { return (D.meta && D.meta.topics || []).filter(function (t) { return t.hub === hub; }); }
  function primaryTopic(it) {
    if (state.cat !== "all" && (it.topics || []).indexOf(state.cat) !== -1) return state.cat;
    return (it.topics || [])[0] || (it.hub === "ai" ? "ai-general" : "vlsi");
  }
  function inCat(it, cat) { return cat === "all" || (it.topics || []).indexOf(cat) !== -1; }
  function tagsHtml(it, max) {
    var h = (it.topics || []).slice(0, max || 3).map(function (t) { return '<span class="tag topic">' + esc(shortTopic(t)) + "</span>"; });
    (it.companies || []).slice(0, 3).forEach(function (c) { h.push('<span class="tag">' + esc(c) + "</span>"); });
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
    return empty("No data yet. The first scheduled run fills this in, or run the <b>Update Device Hub</b> workflow from the repo's Actions tab.");
  }

  // Image or, when there is none (or it fails to load), category cover art.
  function media(img, topic, key, pill) {
    var art = window.DeviceArt(topic, key);
    var inner = img
      ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + safeUrl(img) + '" data-topic="' + esc(topic) + '" data-key="' + esc(key) + '">'
      : art;
    return '<div class="media">' + inner + (pill ? '<span class="pill' + (img && pill === "Figure 1" ? " figpill" : "") + '">' + esc(pill) + "</span>" : "") + "</div>";
  }
  document.addEventListener("error", function (e) {
    var img = e.target;
    if (img && img.tagName === "IMG" && img.hasAttribute("data-topic")) {
      var fig = img.parentNode && img.parentNode.querySelector(".figpill");
      if (fig) fig.textContent = shortTopic(img.getAttribute("data-topic"));
      img.outerHTML = window.DeviceArt(img.getAttribute("data-topic"), img.getAttribute("data-key"));
    }
  }, true);

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
        renderBell();
        route();
      });
  }

  // ------------------------------------------------------------------ chrome
  function renderTicker() {
    var track = document.getElementById("ticker-track");
    var q = (D.market && D.market.quotes) || [];
    if (!q.length) { track.innerHTML = '<span class="ticker-empty">Share prices appear after the first daily update.</span>'; return; }
    var one = q.map(function (x) {
      var has = x.change_pct != null, up = has && x.change_pct >= 0;
      return '<span class="ticker-item"><b>' + esc(x.name) + '</b><span class="sym">' + esc(x.symbol) + "</span>" +
        "<span>" + esc(Number(x.price).toLocaleString(undefined, { maximumFractionDigits: 2 })) + " " + esc(x.currency || "") + "</span>" +
        (has ? '<span class="chg ' + (up ? "up" : "down") + '">' + (up ? "▲" : "▼") + " " + Math.abs(x.change_pct).toFixed(2) + "%</span>" : "") + "</span>";
    }).join("");
    track.innerHTML = one + one;
    track.style.animationDuration = Math.max(40, q.length * 6) + "s";
  }
  function renderFooter() {
    var m = D.meta || {}, bits = [];
    if (m.updated) bits.push("Last updated " + fmtDateTime(m.updated) + (m.edition ? " (" + m.edition + " edition)" : ""));
    if (D.market && D.market.updated) bits.push("prices as of " + fmtDate(D.market.updated));
    document.getElementById("footer-meta").textContent = bits.join(" · ");
  }
  function setActive(name) {
    Array.prototype.forEach.call(document.querySelectorAll("#nav a"), function (a) {
      a.classList.toggle("active", a.getAttribute("data-route") === name);
    });
  }
  function chip(label, value, active, attr, count) {
    return '<button type="button" class="chip' + (active ? " active" : "") + '" data-' + attr + '="' + esc(value) + '">' +
      esc(label) + (count != null ? '<span class="count">' + count + "</span>" : "") + "</button>";
  }
  function setCat(c) {
    state.cat = c || "all";
    try { localStorage.setItem("dh-cat", state.cat); } catch (e) {}
  }
  function renderCatBar(name) {
    var bar = document.getElementById("catbar");
    if (DEVICE_ROUTES.indexOf(name) === -1) { bar.hidden = true; return; }
    var topics = topicsOf("device");
    if (state.cat !== "all" && !topics.some(function (t) { return t.id === state.cat; })) setCat("all");
    var counts = {}, total = 0;
    D.news.concat(D.papers).forEach(function (it) {
      if (it.hub !== "device") return;
      total++;
      (it.topics || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    bar.hidden = false;
    bar.innerHTML = '<div class="wrap catbar-row"><span class="catbar-label">Topics</span><div class="chips" role="tablist">' +
      chip("All", "all", state.cat === "all", "cat", total) +
      topics.map(function (t) { return chip(shortTopic(t.id), t.id, state.cat === t.id, "cat", counts[t.id] || 0); }).join("") + "</div></div>";
    var active = bar.querySelector(".chip.active");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ------------------------------------------------------------------ cards
  function newsCard(n) {
    var text = n.brief || n.description || "";
    var t = primaryTopic(n);
    return '<article class="card hover news-card fade-in">' +
      '<a href="' + safeUrl(n.url) + '" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">' + media(n.image, t, n.id, shortTopic(t)) + "</a>" +
      '<div class="body"><div class="meta"><span class="src">' + esc(n.source) + '</span><span class="dot">' + esc(timeAgo(n.published)) + "</span></div>" +
      "<h3>" + ext(n.url, n.title) + "</h3>" + (text ? "<p>" + esc(text) + "</p>" : "") +
      '<div class="foot">' + tagsHtml({ companies: n.companies }) + ext(n.url, "Read ↗", "read") + "</div></div></article>";
  }
  function compactCard(it, sub) {
    var t = primaryTopic(it);
    return '<article class="card hover row-card compact fade-in">' + media(it.image, t, it.id) +
      '<div><div class="meta"><span class="src">' + esc(sub) + "</span></div><h3>" + ext(it.url, it.title) + "</h3>" +
      (it.tldr ? '<p class="small muted" style="margin:0">' + esc(it.tldr) + "</p>" : "") + "</div></article>";
  }
  function paperCard(p) {
    var authors = (p.authors || []).slice(0, 4).join(", ") + ((p.authors || []).length > 4 ? " et al." : "");
    var links = [ext(p.url, p.source === "arXiv" ? "arXiv page ↗" : "Paper page ↗")];
    if (p.pdf) links.push(ext(p.pdf, "PDF ↗"));
    if (p.doi) links.push(ext("https://doi.org/" + p.doi, "DOI ↗"));
    var t = primaryTopic(p);
    return '<article class="card hover row-card fade-in"><div>' +
      (p.domain ? '<div class="domain">' + esc(p.domain) + "</div>" : "") +
      "<h3>" + ext(p.url, p.title) + "</h3>" +
      '<div class="meta" style="margin-bottom:.55rem">' + (p.venue ? '<span class="src">' + esc(p.venue) + "</span>" : "") +
      '<span class="dot">' + esc(fmtDate(p.published)) + "</span>" + (authors ? '<span class="dot">' + esc(authors) + "</span>" : "") + "</div>" +
      (p.tldr ? '<p class="tldr">' + esc(p.tldr) + "</p>" : "") +
      (p.abstract ? '<details class="abstract"' + (p.tldr ? "" : " open") + "><summary>Abstract</summary><p>" + esc(p.abstract) + "</p></details>" : "") +
      tagsHtml(p, 4) + '<div class="links">' + links.join("") + "</div></div>" +
      media(p.image, t, p.id, p.image ? "Figure 1" : shortTopic(t)) + "</article>";
  }
  function briefingCard(hub) {
    var b = D.insights && D.insights.briefings && D.insights.briefings[hub];
    if (!b) return "";
    var idx = byId();
    return '<div class="card briefing fade-in"><div class="eyebrow">' + (hub === "ai" ? "AI briefing" : "Today's briefing") + " · " + esc(fmtDateTime(b.generated)) + "</div>" +
      '<div class="headline">' + esc(b.headline) + "</div>" +
      "<ol>" + (b.points || []).map(function (p) { return "<li>" + esc(p.text) + refsHtml(p.ids, idx) + "</li>"; }).join("") + "</ol>" +
      ((b.watch || []).length ? '<p class="watch"><b>Worth watching:</b> ' + b.watch.map(esc).join(" · ") + "</p>" : "") + "</div>";
  }
  function bindSearch(id, key, rerender) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", function () { state[key] = el.value; rerender(true); });
  }
  function refocus(id) {
    var el = document.getElementById(id);
    if (el) { el.focus(); var v = el.value; el.value = ""; el.value = v; }
  }
  function head(eyebrow, title, sub, extra) {
    return '<div class="page-head"><div><div class="eyebrow">' + esc(eyebrow) + "</div><h1>" + esc(title) + '</h1><p class="muted">' + sub + "</p></div>" + (extra || "") + "</div>";
  }
  function catSuffix() { return state.cat === "all" ? "" : " · " + topicName(state.cat); }

  // ------------------------------------------------------------------ pages
  function pageHome() {
    var dev = D.news.filter(function (n) { return n.hub === "device" && inCat(n, state.cat); });
    var papers = D.papers.filter(function (p) { return p.hub === "device" && inCat(p, state.cat); });
    var radar = D.insights && D.insights.topics || {};
    var radarIds = topicsOf("device").map(function (t) { return t.id; }).filter(function (id) { return radar[id] && (state.cat === "all" || state.cat === id); });
    var q = (D.market && D.market.quotes) || [];
    var movers = q.filter(function (x) { return x.change_pct != null; }).slice().sort(function (a, b) { return Math.abs(b.change_pct) - Math.abs(a.change_pct); }).slice(0, 7);
    var withImg = dev.filter(function (n) { return n.image; });
    var lead = withImg[0] || dev[0];
    var rest = dev.filter(function (n) { return n !== lead; });

    var h = head(state.cat === "all" ? "Device Hub" : "Topic", state.cat === "all" ? "What's moving in devices today" : topicName(state.cat),
      esc(D.meta.tagline || ""));
    if (lead) {
      var lt = primaryTopic(lead);
      h += '<div class="hero"><article class="card hover lead fade-in">' +
        '<a href="' + safeUrl(lead.url) + '" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">' + media(lead.image, lt, lead.id, shortTopic(lt)) + "</a>" +
        '<div class="body"><div class="meta" style="margin-bottom:.5rem"><span class="src">' + esc(lead.source) + '</span><span class="dot">' + esc(timeAgo(lead.published)) + "</span></div>" +
        "<h3>" + ext(lead.url, lead.title) + "</h3>" + ((lead.brief || lead.description) ? "<p>" + esc(lead.brief || lead.description) + "</p>" : "") + tagsHtml(lead) + "</div></article>" +
        '<div class="hero-side">' + rest.slice(0, 4).map(function (n) { return compactCard(n, n.source + " · " + timeAgo(n.published)); }).join("") + "</div></div>";
    }
    if (state.cat === "all") h += briefingCard("device");
    h += '<div class="grid-2"><div><section><div class="section-title"><h2>Latest news</h2><a href="#/news">All news →</a></div>';
    h += rest.length > 4 ? '<div class="grid-news">' + rest.slice(4, 10).map(newsCard).join("") + "</div>" : (dev.length ? '<p class="muted">More stories appear here as they come in.</p>' : noData());
    h += "</section></div><div>";
    h += '<section><div class="section-title"><h2>New papers</h2><a href="#/research">All papers →</a></div>';
    h += papers.length ? '<div class="list">' + papers.slice(0, 6).map(function (p) { return compactCard(p, (p.domain || p.venue || p.source) + " · " + fmtDate(p.published)); }).join("") + "</div>" : noData();
    h += "</section>";
    if (radarIds.length) {
      h += '<section><div class="section-title"><h2>Research gaps</h2><a href="#/radar">Open →</a></div><div class="list">';
      radarIds.slice(0, 3).forEach(function (id) {
        var g = (radar[id].gaps || [])[0];
        if (g) h += '<a class="card hover gap fade-in" href="#/radar/' + esc(id) + '"><div class="eyebrow">' + esc(shortTopic(id)) + "</div><h3>" + esc(g.title) + '</h3><p class="small muted" style="margin:0">' + esc(g.what_is_missing) + "</p></a>";
      });
      h += "</div></section>";
    }
    if (movers.length) {
      h += '<section><div class="section-title"><h2>Market movers</h2></div><div class="card pad"><table class="market"><tbody>' +
        movers.map(function (x) {
          return "<tr><td><b>" + esc(x.name) + '</b> <span class="muted small">' + esc(x.symbol) + '</span></td><td class="num">' + esc(Number(x.price).toLocaleString()) + ' <span class="muted small">' + esc(x.currency) + '</span></td><td class="num ' + (x.change_pct >= 0 ? "up" : "down") + '">' + (x.change_pct >= 0 ? "+" : "") + x.change_pct.toFixed(2) + "%</td></tr>";
        }).join("") + '</tbody></table><p class="small muted" style="margin:.6rem 0 0">Daily change, refreshed once a day.</p></div></section>';
    }
    h += "</div></div>";
    app.innerHTML = h;
  }

  function newsBlock(hub, cat, searchId) {
    var items = D.news.filter(function (n) { return n.hub === hub && inCat(n, cat); });
    var companies = {};
    items.forEach(function (n) { (n.companies || []).forEach(function (c) { companies[c] = (companies[c] || 0) + 1; }); });
    if (state.newsCompany && !companies[state.newsCompany]) state.newsCompany = "";
    var shown = items.filter(function (n) { return (!state.newsCompany || (n.companies || []).indexOf(state.newsCompany) !== -1) && matches(n, state.newsQuery); });
    var h = '<div class="controls"><input type="search" id="' + searchId + '" placeholder="Search headlines, companies, sources…" value="' + esc(state.newsQuery) + '" aria-label="Search news">';
    var cnames = Object.keys(companies).sort(function (a, b) { return companies[b] - companies[a]; });
    if (cnames.length) {
      h += '<select id="company-filter" aria-label="Filter by company"><option value="">All companies</option>' +
        cnames.map(function (c) { return '<option value="' + esc(c) + '"' + (state.newsCompany === c ? " selected" : "") + ">" + esc(c) + " (" + companies[c] + ")</option>"; }).join("") + "</select>";
    }
    h += "</div>";
    if (!D.news.length) return h + noData();
    return h + (shown.length ? '<div class="grid-news">' + shown.slice(0, 150).map(newsCard).join("") + "</div>" : empty("No stories in this category right now. Try <b>All</b> or another topic."));
  }
  function bindNews(rerender, searchId) {
    bindSearch(searchId, "newsQuery", rerender);
    var sel = document.getElementById("company-filter");
    if (sel) sel.addEventListener("change", function () { state.newsCompany = sel.value; rerender(); });
  }
  function pageNews() {
    function render(keepFocus) {
      app.innerHTML = head("News" + catSuffix(), state.cat === "all" ? "Industry & research news" : topicName(state.cat),
        "What memory, storage, device and VLSI companies are doing. A short AI summary on every story, with the original source one click away.") +
        newsBlock("device", state.cat, "news-search");
      bindNews(render, "news-search");
      if (keepFocus) refocus("news-search");
    }
    render();
  }

  function papersBlock(hub, cat, searchId) {
    var items = D.papers.filter(function (p) { return p.hub === hub && inCat(p, cat); });
    var weeks = [];
    items.forEach(function (p) { if (weeks.indexOf(p.week) === -1) weeks.push(p.week); });
    weeks.sort().reverse();
    if (state.paperWeek && weeks.indexOf(state.paperWeek) === -1) state.paperWeek = "";
    var labels = {};
    (D.meta.weeks || []).forEach(function (w) { labels[w.key] = w.label; });
    var shown = items.filter(function (p) {
      return (state.paperSource === "all" || (state.paperSource === "arxiv" ? p.source === "arXiv" : p.source !== "arXiv")) &&
        (!state.paperWeek || p.week === state.paperWeek) && matches(p, state.paperQuery);
    });
    var h = '<div class="controls"><input type="search" id="' + searchId + '" placeholder="Search titles, abstracts, authors, materials (HZO, IGZO, MoS2…)" value="' + esc(state.paperQuery) + '" aria-label="Search papers">' +
      '<select id="paper-week" aria-label="Week"><option value="">All weeks</option>' + weeks.map(function (w) {
        return '<option value="' + esc(w) + '"' + (state.paperWeek === w ? " selected" : "") + ">" + esc(labels[w] || w) + "</option>";
      }).join("") + "</select>" +
      '<select id="paper-source" aria-label="Source"><option value="all">All sources</option><option value="arxiv"' + (state.paperSource === "arxiv" ? " selected" : "") + '>arXiv preprints</option><option value="journal"' + (state.paperSource === "journal" ? " selected" : "") + ">Journals & conferences</option></select></div>";
    if (!D.papers.length) return h + noData();
    if (!shown.length) return h + empty("No papers in this category for the selected filters.");
    weeks.forEach(function (w, i) {
      var wk = shown.filter(function (p) { return p.week === w; });
      if (!wk.length) return;
      h += '<section class="week-group"><div class="section-title"><h2>' + (i === 0 ? "This week" : i === 1 ? "Last week" : "Earlier") + '<span class="muted">' + esc(labels[w] || w) + '</span></h2><span class="muted small">' + wk.length + " paper" + (wk.length === 1 ? "" : "s") + "</span></div>" +
        '<div class="list">' + wk.map(paperCard).join("") + "</div></section>";
    });
    return h;
  }
  function bindPapers(rerender, searchId) {
    bindSearch(searchId, "paperQuery", rerender);
    var w = document.getElementById("paper-week");
    if (w) w.addEventListener("change", function () { state.paperWeek = w.value; rerender(); });
    var s = document.getElementById("paper-source");
    if (s) s.addEventListener("change", function () { state.paperSource = s.value; rerender(); });
  }
  function pageResearch() {
    function render(keepFocus) {
      app.innerHTML = head("Research" + catSuffix(), state.cat === "all" ? "New papers, week by week" : topicName(state.cat),
        "From arXiv preprints and OpenAlex (IEEE, Nature, Elsevier, ACS and other journals and conferences). " + (D.meta.llm && D.meta.llm.enabled ? "Each paper has a one-line takeaway, the full abstract and a direct link." : "Each paper has its full abstract and a direct link.") + "",
        '<a class="btn ghost" href="#/radar">Research gaps →</a>') + papersBlock("device", state.cat, "paper-search");
      bindPapers(render, "paper-search");
      if (keepFocus) refocus("paper-search");
    }
    render();
  }

  function radarView(id, ins) {
    var idx = byId();
    var h = '<div class="card overview fade-in">' + media(null, id, id) + '<div><div class="eyebrow">' + esc(ins.name || topicName(id)) + " · " + (ins.paper_count || 0) + " recent papers · " + esc(fmtDate(ins.generated)) + "</div>" +
      '<p style="margin:.5rem 0 1rem">' + esc(ins.overview) + '</p><a class="btn" href="#/report/' + esc(id) + '">Open one-page report</a></div></div>';
    if ((ins.trends || []).length) {
      h += '<section><div class="section-title"><h2>What is being done</h2></div><div class="grid-cards">' + ins.trends.map(function (t) {
        return '<div class="card pad fade-in"><h3>' + esc(t.title) + refsHtml(t.ids, idx) + '</h3><p class="small muted" style="margin:0">' + esc(t.detail) + "</p></div>";
      }).join("") + "</div></section>";
    }
    if ((ins.gaps || []).length) {
      h += '<section><div class="section-title"><h2>Research gaps you could work on</h2></div><div class="grid-cards">' + ins.gaps.map(function (g) {
        return '<div class="card gap fade-in"><span class="badge ' + esc(g.difficulty) + '">' + esc(g.difficulty) + "</span><h3>" + esc(g.title) + "</h3><dl>" +
          "<dt>What's missing</dt><dd>" + esc(g.what_is_missing) + "</dd><dt>Why it matters</dt><dd>" + esc(g.why_it_matters) + "</dd>" +
          "<dt>Suggested approach</dt><dd>" + esc(g.suggested_approach) + "</dd></dl>" +
          ((g.ids || []).length ? '<p class="small muted" style="margin:.7rem 0 0">Related:' + refsHtml(g.ids, idx) + "</p>" : "") + "</div>";
      }).join("") + "</div></section>";
    }
    if ((ins.starter_projects || []).length) {
      h += '<section><div class="section-title"><h2>Starter project ideas</h2></div><div class="card pad"><ul style="margin:0;padding-left:1.1rem">' +
        ins.starter_projects.map(function (s) { return '<li style="margin-bottom:.35rem">' + esc(s) + "</li>"; }).join("") + "</ul></div></section>";
    }
    var key = (ins.key_papers || []).map(function (k) { return idx[k]; }).filter(Boolean);
    if (key.length) h += '<section><div class="section-title"><h2>Read these first</h2></div><div class="list">' + key.map(paperCard).join("") + "</div></section>";
    return h;
  }
  function radarTiles(topics, radar, attr) {
    return '<div class="grid-cards">' + topics.map(function (t) {
      var ins = radar[t.id], g = (ins.gaps || [])[0];
      return '<button type="button" class="card hover topic-tile fade-in" data-' + attr + '="' + esc(t.id) + '">' + media(null, t.id, t.id) +
        '<div class="body"><div class="eyebrow">' + (ins.paper_count || 0) + " recent papers</div><h3>" + esc(t.name) + "</h3>" +
        (g ? '<p class="small muted" style="margin:0"><b>Top gap:</b> ' + esc(g.title) + "</p>" : "") + "</div></button>";
    }).join("") + "</div>";
  }
  function noRadar() {
    return empty(D.meta.llm && D.meta.llm.enabled ? "Research-gap notes are generated once a day and will appear after the next run." :
      "Research-gap notes need the Claude API. Add the <code>ANTHROPIC_API_KEY</code> secret to the repository to switch them on.");
  }
  // Keyword trend snapshot computed in the browser: works without the Claude API.
  var STOP = "a an the of in on for to and or with by from at as is are was were be been this that these those we our it its via using use based into than then also can which show shows shown study studies paper results result new novel high low large small two one three both between under over within without such has have had not more most their they them here there however while due effect effects approach method methods model models data performance device devices proposed demonstrate demonstrated report reported present presented work significant significantly different various compared improved improve enable enables enabling achieve achieved".split(" ");
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = 1; });
  function topTerms(items, n) {
    var counts = {};
    items.forEach(function (p) {
      var words = (p.title + " " + (p.abstract || "")).toLowerCase().replace(/[^a-z0-9\-+ ]/g, " ").split(/\s+/).filter(function (w) { return w.length > 2 && !STOPSET[w] && !/^\d+$/.test(w); });
      var seen = {};
      for (var i = 0; i < words.length - 1; i++) {
        var bg = words[i] + " " + words[i + 1];
        if (!seen[bg]) { seen[bg] = 1; counts[bg] = (counts[bg] || 0) + 1; }
      }
    });
    return Object.keys(counts).filter(function (k) { return counts[k] > 1; })
      .sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, n).map(function (k) { return [k, counts[k]]; });
  }
  function trendSnapshot(cat) {
    var weeks = (D.meta.weeks || []).map(function (w) { return w.key; });
    var topics = topicsOf("device").filter(function (t) { return cat === "all" || t.id === cat; });
    var cards = topics.map(function (t) {
      var ps = D.papers.filter(function (p) { return p.hub === "device" && (p.topics || []).indexOf(t.id) !== -1; });
      if (!ps.length) return "";
      var thisW = ps.filter(function (p) { return p.week === weeks[0]; }).length;
      var lastW = ps.filter(function (p) { return p.week === weeks[1]; }).length;
      var venues = {};
      ps.forEach(function (p) { if (p.venue && p.source !== "arXiv") venues[p.venue] = (venues[p.venue] || 0) + 1; });
      var topV = Object.keys(venues).sort(function (a, b) { return venues[b] - venues[a]; }).slice(0, 3);
      var terms = topTerms(ps, 8);
      var cited = ps.filter(function (p) { return p.cited_by; }).sort(function (a, b) { return b.cited_by - a.cited_by; })[0];
      var latest = ps[0];
      return '<div class="card gap fade-in"><div class="eyebrow">' + esc(shortTopic(t.id)) + "</div>" +
        '<h3>' + ps.length + (ps.length === 1 ? " paper" : " papers") + " <span class=\"muted small\" style=\"font-weight:500\">· " + thisW + " this week, " + lastW + " last week</span></h3>" +
        (terms.length ? '<dl><dt>Recurring themes</dt><dd><div class="tags" style="margin-top:.3rem">' + terms.map(function (x) { return '<span class="tag topic">' + esc(x[0]) + " · " + x[1] + "</span>"; }).join("") + "</div></dd></dl>" : "") +
        (topV.length ? "<dl><dt>Where it is published</dt><dd>" + topV.map(esc).join(" · ") + "</dd></dl>" : "") +
        (cited ? "<dl><dt>Most cited so far</dt><dd>" + ext(cited.url, cited.title) + "</dd></dl>" : "") +
        (latest ? "<dl><dt>Newest</dt><dd>" + ext(latest.url, latest.title) + "</dd></dl>" : "") + "</div>";
    }).join("");
    return cards ? '<div class="grid-cards">' + cards + "</div>" : empty("No papers in this topic yet.");
  }
  function pageRadar(topicId) {
    var radar = D.insights && D.insights.topics || {};
    var topics = topicsOf("device").filter(function (t) { return radar[t.id]; });
    if (topicId && radar[topicId]) { setCat(topicId); renderCatBar("radar"); }
    var h = head("Research gaps" + catSuffix(), state.cat !== "all" && radar[state.cat] ? topicName(state.cat) : "Where the open problems are",
      "For each area: what recent papers are doing, where the gaps are, and ideas to start on. Refreshed daily from the latest papers; open a one-page report to print or save.");
    if (!topics.length) {
      var llmOn = D.meta.llm && D.meta.llm.enabled;
      app.innerHTML = h + '<p class="notice">' + (llmOn ? "AI research-gap notes are generated once a day and will appear after the next run." :
        "AI research-gap notes switch on when the <code>ANTHROPIC_API_KEY</code> secret is added.") +
        " Meanwhile, here is a keyword snapshot of what recent papers in each topic are about.</p>" + trendSnapshot(state.cat);
      return;
    }
    if (state.cat !== "all" && radar[state.cat]) { app.innerHTML = h + radarView(state.cat, radar[state.cat]); return; }
    var note = state.cat !== "all" ? '<p class="notice">No research-gap notes for <b>' + esc(topicName(state.cat)) + "</b> yet (it needs at least 3 recent papers, and Industry & market is news-only). Showing all topics.</p>" : "";
    app.innerHTML = h + note + radarTiles(topics, radar, "cat");
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
    if ((ins.starter_projects || []).length) md += "\n## Starter projects\n\n" + ins.starter_projects.map(function (s) { return "- " + s; }).join("\n") + "\n";
    var key = (ins.key_papers || []).map(function (k) { return idx[k]; }).filter(Boolean);
    if (key.length) md += "\n## Read first\n\n" + key.map(function (p) { return "- [" + p.title + "](" + p.url + ")" + (p.venue ? " - " + p.venue : ""); }).join("\n") + "\n";
    return md + "\n_AI-generated from paper abstracts; verify against the original papers._\n";
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
    app.innerHTML = '<div class="report-actions"><a class="btn ghost" href="' + back + '">← Back</a><button class="btn" type="button" id="print-report">Print / save as PDF</button><button class="btn ghost" type="button" id="md-report">Download Markdown</button></div>' +
      '<div class="report fade-in"><div class="eyebrow">Device Hub research brief</div><h1>' + esc(ins.name || topicName(id)) + "</h1>" +
      '<p class="muted small">' + esc(fmtDate(ins.generated)) + " · based on " + (ins.paper_count || 0) + " recent papers · AI-generated from abstracts, so verify against the papers</p>" +
      "<h2>Where the field is</h2><p>" + esc(ins.overview) + "</p>" +
      "<h2>What is being done</h2><ul>" + (ins.trends || []).map(function (t) { return "<li><b>" + esc(t.title) + ".</b> " + esc(t.detail) + refList(t.ids) + "</li>"; }).join("") + "</ul>" +
      "<h2>Research gaps</h2><ol>" + (ins.gaps || []).map(function (g) {
        return "<li><b>" + esc(g.title) + '</b> <span class="badge ' + esc(g.difficulty) + '">' + esc(g.difficulty) + "</span><br>" + esc(g.what_is_missing) + " <i>Why it matters:</i> " + esc(g.why_it_matters) + " <i>Approach:</i> " + esc(g.suggested_approach) + refList(g.ids) + "</li>";
      }).join("") + "</ol>" +
      ((ins.starter_projects || []).length ? "<h2>Starter projects</h2><ul>" + ins.starter_projects.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" : "") +
      (key.length ? "<h2>Read first</h2><ul>" + key.map(function (p) { return "<li>" + ext(p.url, p.title) + (p.venue ? ' <span class="muted small">' + esc(p.venue) + "</span>" : "") + "</li>"; }).join("") + "</ul>" : "") + "</div>";
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
    return '<div class="card overview fade-in">' + media(null, "ai-for-devices", "playbook") + '<div><div class="eyebrow">Using AI in device & VLSI research · ' + esc(fmtDate(pb.generated)) + '</div><p style="margin:.5rem 0 0">' + esc(pb.intro) + "</p></div></div>" +
      '<div class="grid-cards">' + (pb.applications || []).map(function (a) {
        return '<div class="card gap fade-in"><h3>' + esc(a.area) + refsHtml(a.ids, idx) + '</h3><p class="small">' + esc(a.how) + "</p>" +
          ((a.tools || []).length ? '<div class="tags">' + a.tools.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>" : "") +
          ((a.first_steps || []).length ? '<dl><dt>First steps</dt><dd><ol style="margin:.2rem 0 0;padding-left:1.1rem">' + a.first_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol></dd></dl>" : "") + "</div>";
      }).join("") + "</div>" +
      ((pb.skills || []).length ? '<section><div class="section-title"><h2>Skills to learn</h2></div><div class="tags">' + pb.skills.map(function (s) { return '<span class="tag topic" style="font-size:.85rem;padding:.3rem .8rem">' + esc(s) + "</span>"; }).join("") + "</div></section>" : "");
  }
  function pageAI() {
    var tabs = [["news", "AI news"], ["papers", "AI research"], ["playbook", "AI in devices & VLSI"], ["radar", "AI research gaps"]];
    function render(keepFocus) {
      var radar = D.insights && D.insights.topics || {};
      var h = head("AI Hub", "AI, and how it is reshaping devices & VLSI", "Latest AI news and research, and how machine learning and LLMs are being applied to device physics, materials, EDA and chip design.");
      h += briefingCard("ai");
      h += '<div class="controls"><div class="chips">' + tabs.map(function (t) { return chip(t[1], t[0], state.aiTab === t[0], "aitab"); }).join("") + "</div></div>";
      if (state.aiTab === "news" || state.aiTab === "papers") {
        h += '<div class="controls"><div class="chips">' + chip("All", "all", state.aiTopic === "all", "aitopic") +
          topicsOf("ai").map(function (t) { return chip(t.name, t.id, state.aiTopic === t.id, "aitopic"); }).join("") + "</div></div>";
      }
      if (state.aiTab === "news") h += newsBlock("ai", state.aiTopic, "ai-news-search");
      else if (state.aiTab === "papers") h += papersBlock("ai", state.aiTopic, "ai-paper-search");
      else if (state.aiTab === "playbook") h += playbookHtml();
      else {
        var topics = topicsOf("ai").filter(function (t) { return radar[t.id]; });
        if (!topics.length) h += noRadar();
        else {
          var cur = radar[state.radarTopic] && topics.some(function (t) { return t.id === state.radarTopic; }) ? state.radarTopic : topics[0].id;
          h += '<div class="controls"><div class="chips">' + topics.map(function (t) { return chip(t.name, t.id, t.id === cur, "airadar"); }).join("") + "</div></div>" + radarView(cur, radar[cur]);
        }
      }
      app.innerHTML = h;
      [["aitab", "aiTab"], ["aitopic", "aiTopic"], ["airadar", "radarTopic"]].forEach(function (pair) {
        Array.prototype.forEach.call(app.querySelectorAll("[data-" + pair[0] + "]"), function (b) {
          b.addEventListener("click", function () { state[pair[1]] = b.getAttribute("data-" + pair[0]); render(); });
        });
      });
      if (state.aiTab === "news") bindNews(render, "ai-news-search");
      if (state.aiTab === "papers") bindPapers(render, "ai-paper-search");
      if (keepFocus) refocus(state.aiTab === "news" ? "ai-news-search" : "ai-paper-search");
    }
    render();
  }

  function pageLearn() {
    var L = D.learn || {}, items = L.items || [];
    var videos = items.filter(function (i) { return i.kind === "video"; });
    var talks = items.filter(function (i) { return i.kind === "interview"; });
    var reads = items.filter(function (i) { return i.kind === "article"; });
    var h = head("Learn", "Lectures, interviews & deep dives", "Explainers, interviews, keynotes and courses on semiconductors, memory, devices and VLSI.");
    h += '<section><div class="section-title"><h2>Latest videos</h2></div>' + (videos.length ? '<div class="grid-news">' + videos.slice(0, 12).map(function (v) {
      return '<a class="card hover news-card video fade-in" href="' + safeUrl(v.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<div class="media">' + (v.thumbnail ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + safeUrl(v.thumbnail) + '" data-topic="vlsi" data-key="' + esc(v.id) + '">' : window.DeviceArt("vlsi", v.id)) + '<div class="play"><span></span></div></div>' +
        '<div class="body"><div class="meta"><span class="src">' + esc(v.source) + '</span><span class="dot">' + esc(timeAgo(v.published)) + "</span></div><h3>" + esc(v.title) + "</h3></div></a>";
    }).join("") + "</div>" : noData()) + "</section>";
    h += '<div class="grid-2"><section><div class="section-title"><h2>Interviews & keynotes</h2></div>' + (talks.length ? '<div class="list">' + talks.slice(0, 10).map(function (t) { return compactCard({ id: t.id, title: t.title, url: t.url, topics: ["industry"] }, t.source + " · " + timeAgo(t.published)); }).join("") + "</div>" : noData()) + "</section>";
    h += '<section style="margin-top:0"><div class="section-title"><h2>Deep-dive reads</h2></div>' + (reads.length ? '<div class="list">' + reads.slice(0, 10).map(function (r) {
      return compactCard({ id: r.id, title: r.title, url: r.url, image: r.thumbnail, topics: ["process"], tldr: r.description }, r.source + " · " + timeAgo(r.published));
    }).join("") + "</div>" : noData()) + "</section></div>";
    h += '<section><div class="section-title"><h2>Courses & lecture series</h2></div><div class="grid-cards">' + (L.courses || []).map(function (c) {
      return '<a class="card hover pad fade-in" href="' + safeUrl(c.url) + '" target="_blank" rel="noopener noreferrer"><div class="eyebrow">' + esc(c.by) + "</div><h3 style=\"margin:.35rem 0 .6rem\">" + esc(c.title) + "</h3>" +
        '<div class="tags">' + (c.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div></a>";
    }).join("") + "</div></section>";
    app.innerHTML = h;
  }

  function pageEvents() {
    var conf = (D.learn && D.learn.conferences) || [];
    var h = head("Events", "Conferences to watch", "Where new memory, device and VLSI results are announced. Papers and news from these show up in Research and News as they appear.");
    h += conf.length ? '<div class="grid-cards">' + conf.map(function (c) {
      return '<a class="card hover pad fade-in" href="' + safeUrl(c.url) + '" target="_blank" rel="noopener noreferrer"><div class="eyebrow">' + esc(c.month) + "</div><h2 style=\"margin:.3rem 0 .4rem\">" + esc(c.name) + '</h2><p class="small muted" style="margin:0">' + esc(c.focus) + "</p></a>";
    }).join("") + "</div>" : noData();
    app.innerHTML = h;
  }

  // ------------------------------------------------------------------ notifications
  // "New" = first seen by the pipeline after this browser last opened the bell.
  var NEW_KEY = "dh-last-seen";
  function lastSeen() {
    var v = null;
    try { v = localStorage.getItem(NEW_KEY); } catch (e) {}
    return v ? new Date(v).getTime() : Date.now() - 24 * 3600 * 1000; // first visit: last 24 h
  }
  function seenAt(it) { return new Date(it.first_seen || it.published || 0).getTime(); }
  function newItems() {
    var since = lastSeen();
    var n = D.news.filter(function (x) { return seenAt(x) > since; });
    var p = D.papers.filter(function (x) { return seenAt(x) > since; });
    return { news: n, papers: p, since: since };
  }
  function renderBell() {
    var x = newItems(), total = x.news.length + x.papers.length;
    var badge = document.getElementById("bell-badge");
    badge.hidden = total === 0;
    badge.textContent = total > 99 ? "99+" : String(total);
    document.getElementById("bell").setAttribute("aria-label", total ? total + " new updates" : "No new updates");
  }
  function renderBellPanel() {
    var x = newItems(), panel = document.getElementById("bell-panel");
    var thisWeek = (D.meta.weeks || [])[0];
    var newWeekPapers = thisWeek ? x.papers.filter(function (p) { return p.week === thisWeek.key; }).length : 0;
    var byTopic = {};
    x.news.concat(x.papers).forEach(function (it) { (it.topics || []).forEach(function (t) { byTopic[t] = (byTopic[t] || 0) + 1; }); });
    var tops = Object.keys(byTopic).sort(function (a, b) { return byTopic[b] - byTopic[a]; }).slice(0, 6);
    var h = '<div class="bell-head"><b>What\'s new</b>' + (x.news.length + x.papers.length ? '<button type="button" id="bell-read">Mark all as read</button>' : "") + "</div>";
    if (!x.news.length && !x.papers.length) {
      panel.innerHTML = h + '<div class="bell-empty">You\'re up to date. New stories and papers will show here after the next update' + (D.meta.updated ? " (last run " + esc(timeAgo(D.meta.updated)) + ")" : "") + ".</div>";
      return;
    }
    h += '<div class="bell-sum">' +
      (x.news.length ? '<a href="#/news" data-cat="all">' + x.news.length + " new stor" + (x.news.length === 1 ? "y" : "ies") + "</a>" : "") +
      (x.papers.length ? '<a href="#/research" data-cat="all">' + x.papers.length + " new paper" + (x.papers.length === 1 ? "" : "s") + (newWeekPapers ? " · " + newWeekPapers + " this week" : "") + "</a>" : "") +
      tops.map(function (t) {
        var hub = (D.meta.topics.filter(function (m) { return m.id === t; })[0] || {}).hub;
        return '<a href="' + (hub === "ai" ? "#/ai" : "#/news") + '"' + (hub === "ai" ? "" : ' data-cat="' + esc(t) + '"') + ">" + esc(shortTopic(t)) + " +" + byTopic[t] + "</a>";
      }).join("") + "</div>";
    var latest = x.news.map(function (n) { return { it: n, k: "News · " + n.source }; })
      .concat(x.papers.map(function (p) { return { it: p, k: "Paper · " + (p.domain || shortTopic((p.topics || [])[0] || "")) }; }))
      .sort(function (a, b) { return seenAt(b.it) - seenAt(a.it) || String(b.it.published).localeCompare(String(a.it.published)); })
      .slice(0, 12);
    h += latest.map(function (e) {
      return '<a class="bell-item" href="' + safeUrl(e.it.url) + '" target="_blank" rel="noopener noreferrer"><i></i><span><span class="k">' + esc(e.k) + '</span><br><span class="t">' + esc(e.it.title) + "</span></span></a>";
    }).join("");
    panel.innerHTML = h;
    var btn = document.getElementById("bell-read");
    if (btn) btn.addEventListener("click", function () {
      try { localStorage.setItem(NEW_KEY, new Date().toISOString()); } catch (e) {}
      renderBell(); renderBellPanel();
    });
  }
  function toggleBell(open) {
    var panel = document.getElementById("bell-panel"), bell = document.getElementById("bell");
    var show = open == null ? panel.hidden : open;
    if (show) renderBellPanel();
    panel.hidden = !show;
    bell.setAttribute("aria-expanded", show ? "true" : "false");
  }
  document.getElementById("bell").addEventListener("click", function (e) { e.stopPropagation(); toggleBell(); });
  document.addEventListener("click", function (e) {
    var panel = document.getElementById("bell-panel");
    if (panel.hidden) return;
    if (!panel.contains(e.target) || e.target.closest("a")) toggleBell(false);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") toggleBell(false); });

  // ------------------------------------------------------------------ router
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-cat]");
    if (!b) return;
    setCat(b.getAttribute("data-cat"));
    var name = currentRoute().name;
    if (name === "radar" && location.hash !== "#/radar") { location.hash = "#/radar"; return; }
    route(true);
  });
  function currentRoute() {
    var hash = location.hash.replace(/^#\/?/, "") || "home";
    var qm = hash.match(/[?&]cat=([\w-]+)/);
    var parts = hash.split("?")[0].split("/");
    return { name: parts[0] || "home", arg: parts[1], cat: qm && qm[1] };
  }
  function route(keepScroll) {
    var r = currentRoute();
    if (r.cat) setCat(r.cat);
    renderCatBar(r.name);
    var reportHub = r.name === "report" && D.insights && D.insights.topics && D.insights.topics[r.arg] && D.insights.topics[r.arg].hub;
    setActive(r.name === "report" ? (reportHub === "ai" ? "ai" : "radar") : r.name);
    if (r.name === "news") pageNews();
    else if (r.name === "research") pageResearch();
    else if (r.name === "radar") pageRadar(r.arg);
    else if (r.name === "report") pageReport(r.arg);
    else if (r.name === "ai") pageAI();
    else if (r.name === "learn") pageLearn();
    else if (r.name === "events") pageEvents();
    else { setActive("home"); pageHome(); }
    if (keepScroll !== true) window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ theme
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var root = document.documentElement;
    var cur = root.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("dh-theme", next); } catch (e) {}
  });

  window.addEventListener("hashchange", function () { route(); });
  init();
})();
