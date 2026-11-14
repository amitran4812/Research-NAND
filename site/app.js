/* Device Hub front end: loads data/*.json (written by the scheduled job) and renders pages. */
(function () {
  "use strict";

  var D = { meta: null, news: [], papers: [], market: null, learn: null, insights: null, venues: null };
  var state = { cat: "all", newsCompany: "", newsQuery: "", paperSource: "all", paperQuery: "", paperWeek: "", aiTab: "news", aiTopic: "all", pubTab: "conf", pubTier: "all", pubQ: "all", pubOA: false, newsSection: "all", newsRegion: "india", libGroup: "all", libSubject: "", libProvider: "all", libLevel: "all", libQuery: "" };
  // Every visit starts on "All": the topic chosen last time is not restored.
  try { localStorage.removeItem("dh-cat"); } catch (e) {}
  var DEVICE_ROUTES = ["home", "news", "research", "learn", "publish", "events"];
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
  // Everything is shown latest first; items without a date go last.
  function newestFirst(items) {
    function t(it) { var v = new Date(it.published || it.first_seen || 0).getTime(); return isNaN(v) ? 0 : v; }
    return items.slice().sort(function (a, b) { return t(b) - t(a); });
  }
  function init() {
    fetch("data/meta.json?v=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (meta) {
        D.meta = meta || { topics: [], weeks: [], title: "Device Hub" };
        return Promise.all([load("news.json"), load("papers.json"), load("market.json"), load("learn.json"), load("insights.json"), load("venues.json")]);
      })
      .then(function (r) {
        D.news = newestFirst((r[0] && r[0].items) || []);
        D.papers = newestFirst((r[1] && r[1].items) || []);
        D.market = r[2];
        D.learn = r[3];
        if (D.learn && D.learn.items) D.learn.items = newestFirst(D.learn.items);
        D.insights = r[4];
        D.venues = r[5];
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
    var prev = bar.querySelector(".chips"), keep = prev ? prev.scrollLeft : 0;
    var arrow = function (dir, label, path) {
      return '<button type="button" class="cat-arrow ' + dir + '" aria-label="' + label + '"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    };
    bar.innerHTML = '<div class="wrap wide catbar-row"><span class="catbar-label">Topics</span><div class="cat-scroller">' +
      arrow("prev", "Scroll topics left", "M15 5l-7 7 7 7") + '<div class="chips" role="tablist">' +
      chip("All", "all", state.cat === "all", "cat", total) +
      topics.map(function (t) { return chip(shortTopic(t.id), t.id, state.cat === t.id, "cat", counts[t.id] || 0); }).join("") + "</div>" +
      arrow("next", "Scroll topics right", "M9 5l7 7-7 7") + "</div></div>";
    var row = bar.querySelector(".chips"), scroller = bar.querySelector(".cat-scroller");
    row.scrollLeft = keep;
    // keep the chosen topic in view without moving the page
    var active = row.querySelector(".chip.active");
    if (active) {
      var l = active.offsetLeft - row.offsetLeft, r = l + active.offsetWidth;
      if (l < row.scrollLeft + 40) row.scrollLeft = Math.max(0, l - 40);
      else if (r > row.scrollLeft + row.clientWidth - 40) row.scrollLeft = r - row.clientWidth + 40;
    }
    function edges() {
      var max = row.scrollWidth - row.clientWidth - 2;
      scroller.classList.toggle("at-start", row.scrollLeft <= 2);
      scroller.classList.toggle("at-end", row.scrollLeft >= max);
      scroller.classList.toggle("no-scroll", max <= 0);
    }
    bar.querySelector(".cat-arrow.prev").addEventListener("click", function () { row.scrollBy({ left: -row.clientWidth * 0.7, behavior: "smooth" }); });
    bar.querySelector(".cat-arrow.next").addEventListener("click", function () { row.scrollBy({ left: row.clientWidth * 0.7, behavior: "smooth" }); });
    row.addEventListener("scroll", edges, { passive: true });
    // a mouse wheel over the bar scrolls it sideways
    row.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && row.scrollWidth > row.clientWidth) { row.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    edges();
  }
  window.addEventListener("resize", function () {
    var row = document.querySelector("#catbar .chips");
    if (row) row.dispatchEvent(new Event("scroll"));
  });

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
  function head(eyebrow, title, sub, extra, art) {
    if (!art) return '<div class="page-head"><div><div class="eyebrow">' + esc(eyebrow) + "</div><h1>" + esc(title) + '</h1><p class="muted">' + sub + "</p></div>" + (extra || "") + "</div>";
    return '<div class="page-head banner fade-in"><div class="banner-art" aria-hidden="true">' + window.DeviceArt(art, "banner-" + art) + '</div>' +
      '<div class="banner-text"><div class="eyebrow">' + esc(eyebrow) + "</div><h1>" + esc(title) + '</h1><p class="muted">' + sub + "</p>" + (extra ? '<div style="margin-top:1rem">' + extra + "</div>" : "") + "</div></div>";
  }
  function pageArt(fallback) { return state.cat === "all" ? fallback : state.cat; }
  function catSuffix() { return state.cat === "all" ? "" : " · " + topicName(state.cat); }

  // ------------------------------------------------------------------ pages
  function pageHome() {
    var dev = D.news.filter(function (n) { return n.hub === "device" && inCat(n, state.cat); });
    var papers = D.papers.filter(function (p) { return p.hub === "device" && inCat(p, state.cat); });
    var q = (D.market && D.market.quotes) || [];
    var movers = q.filter(function (x) { return x.change_pct != null; }).slice().sort(function (a, b) { return Math.abs(b.change_pct) - Math.abs(a.change_pct); }).slice(0, 7);
    var lead = dev[0]; // newest story leads, with topic art if it has no photo
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
    if (movers.length) {
      h += '<section><div class="section-title"><h2>Market movers</h2></div><div class="card pad"><table class="market"><tbody>' +
        movers.map(function (x) {
          return "<tr><td><b>" + esc(x.name) + '</b> <span class="muted small">' + esc(x.symbol) + '</span></td><td class="num">' + esc(Number(x.price).toLocaleString()) + ' <span class="muted small">' + esc(x.currency) + '</span></td><td class="num ' + (x.change_pct >= 0 ? "up" : "down") + '">' + (x.change_pct >= 0 ? "+" : "") + x.change_pct.toFixed(2) + "%</td></tr>";
        }).join("") + '</tbody></table><p class="small muted" style="margin:.6rem 0 0">Daily change, refreshed once a day.</p></div></section>';
    }
    h += "</div></div>";
    app.innerHTML = h;
  }

  var REGIONS = [["india", "India", "Stories connected to India, from any outlet"], ["international", "International", "Global industry and research news"]];
  function regionOf(n) { return n.region || "international"; }
  var SECTIONS = [["all", "All news"], ["tech", "Technology & R&D"], ["market", "Market & business"], ["general", "Industry & other"]];
  function sectionOf(n) { return n.section || "general"; }
  function sectionChips(items) {
    var c = { all: items.length, tech: 0, market: 0, general: 0 };
    items.forEach(function (n) { c[sectionOf(n)]++; });
    return '<div class="controls section-tabs"><div class="chips">' + SECTIONS.map(function (x) { return chip(x[1], x[0], state.newsSection === x[0], "newssec", c[x[0]]); }).join("") + "</div></div>";
  }
  // Market tab header: how much is happening, who it is about, what is expected next, and today's movers.
  var OUTLOOK = /\b(forecast|outlook|expect|expected|guidance|projected|will|by 20\d\d|20(2[7-9]|3\d)|future|next year|demand)\b/i;
  function marketSummary(items) {
    var week = Date.now() - 7 * 86400000;
    var recent = items.filter(function (n) { return new Date(n.published || 0).getTime() > week; });
    var comp = {};
    recent.forEach(function (n) { (n.companies || []).forEach(function (c) { comp[c] = (comp[c] || 0) + 1; }); });
    var top = Object.keys(comp).sort(function (a, b) { return comp[b] - comp[a]; }).slice(0, 6);
    var outlook = items.filter(function (n) { return OUTLOOK.test(n.title); }).slice(0, 5);
    var q = (D.market && D.market.quotes) || [];
    var movers = q.filter(function (x) { return x.change_pct != null; }).slice().sort(function (a, b) { return Math.abs(b.change_pct) - Math.abs(a.change_pct); }).slice(0, 5);
    var h = '<div class="mkt-summary fade-in">';
    h += '<div class="card pad mkt-stat"><div class="eyebrow">This week</div><div class="big">' + recent.length + '</div><p class="small muted">market & business stories</p>' +
      (top.length ? '<div class="tags">' + top.map(function (c) { return '<button type="button" class="tag topic co" data-company="' + esc(c) + '">' + esc(c) + " · " + comp[c] + "</button>"; }).join("") + "</div>" : "") + "</div>";
    h += '<div class="card pad mkt-outlook"><div class="eyebrow">What\'s expected next</div>' + (outlook.length ? "<ul>" + outlook.map(function (n) {
      return "<li>" + ext(n.url, n.title) + ' <span class="muted small">' + esc(n.source) + " · " + esc(timeAgo(n.published)) + "</span></li>";
    }).join("") + "</ul>" : '<p class="small muted">No forecast or outlook stories right now.</p>') + "</div>";
    if (movers.length) h += '<div class="card pad mkt-movers"><div class="eyebrow">Today\'s share movers</div><table class="market"><tbody>' + movers.map(function (x) {
      return "<tr><td><b>" + esc(x.name) + '</b></td><td class="num ' + (x.change_pct >= 0 ? "up" : "down") + '">' + (x.change_pct >= 0 ? "+" : "") + x.change_pct.toFixed(2) + "%</td></tr>";
    }).join("") + "</tbody></table></div>";
    return h + "</div>";
  }
  function newsBlock(hub, cat, searchId, withSections) {
    var items = D.news.filter(function (n) { return n.hub === hub && inCat(n, cat); });
    var pre = "";
    if (withSections) {
      var rc = { india: 0, international: 0 };
      items.forEach(function (n) { rc[regionOf(n)]++; });
      pre = '<div class="region-tabs fade-in" role="tablist">' + REGIONS.map(function (r) {
        return '<button type="button" class="region' + (state.newsRegion === r[0] ? " active" : "") + '" data-newsreg="' + r[0] + '"><b>' + esc(r[1]) + '</b><span>' + esc(r[2]) + '</span><i>' + rc[r[0]] + "</i></button>";
      }).join("") + "</div>";
      items = items.filter(function (n) { return regionOf(n) === state.newsRegion; });
      pre += sectionChips(items);
      if (state.newsSection !== "all") items = items.filter(function (n) { return sectionOf(n) === state.newsSection; });
      if (state.newsSection === "market" && items.length) pre += marketSummary(items);
    }
    var companies = {};
    items.forEach(function (n) { (n.companies || []).forEach(function (c) { companies[c] = (companies[c] || 0) + 1; }); });
    if (state.newsCompany && !companies[state.newsCompany]) state.newsCompany = "";
    var shown = items.filter(function (n) { return (!state.newsCompany || (n.companies || []).indexOf(state.newsCompany) !== -1) && matches(n, state.newsQuery); });
    var h = pre + '<div class="controls"><input type="search" id="' + searchId + '" placeholder="Search headlines, companies, sources…" value="' + esc(state.newsQuery) + '" aria-label="Search news">';
    var cnames = Object.keys(companies).sort(function (a, b) { return companies[b] - companies[a]; });
    if (cnames.length) {
      h += '<select id="company-filter" aria-label="Filter by company"><option value="">All companies</option>' +
        cnames.map(function (c) { return '<option value="' + esc(c) + '"' + (state.newsCompany === c ? " selected" : "") + ">" + esc(c) + " (" + companies[c] + ")</option>"; }).join("") + "</select>";
    }
    h += "</div>";
    if (!D.news.length) return h + noData();
    return h + (shown.length ? '<div class="grid-news">' + shown.slice(0, 150).map(newsCard).join("") + "</div>" : empty(state.newsRegion === "india" && withSections ? "No India stories here yet. New ones arrive with each update; meanwhile try <b>International</b> or another topic." : "No stories here right now. Try <b>All</b> or another topic."));
  }
  function bindNews(rerender, searchId) {
    bindSearch(searchId, "newsQuery", rerender);
    var sel = document.getElementById("company-filter");
    if (sel) sel.addEventListener("change", function () { state.newsCompany = sel.value; rerender(); });
    Array.prototype.forEach.call(app.querySelectorAll("[data-newsreg]"), function (b) {
      b.addEventListener("click", function () { state.newsRegion = b.getAttribute("data-newsreg"); state.newsCompany = ""; rerender(); });
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-newssec]"), function (b) {
      b.addEventListener("click", function () { state.newsSection = b.getAttribute("data-newssec"); state.newsCompany = ""; rerender(); });
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-company]"), function (b) {
      b.addEventListener("click", function () { state.newsCompany = b.getAttribute("data-company"); rerender(); });
    });
  }
  function pageNews() {
    function render(keepFocus) {
      app.innerHTML = head("News" + catSuffix(), state.cat === "all" ? "Industry & research news" : topicName(state.cat),
        "What memory, storage, device and VLSI companies are doing" + (D.meta.llm && D.meta.llm.enabled ? ", with a short AI summary on every story" : "") + ". The original source is always one click away.", "", pageArt("industry")) +
        newsBlock("device", state.cat, "news-search", true);
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
        "From arXiv preprints and OpenAlex (IEEE, Nature, Elsevier, ACS and other journals and conferences). " + (D.meta.llm && D.meta.llm.enabled ? "Each paper has a one-line takeaway, the full abstract and a direct link." : "Each paper has its full abstract and a direct link.") + "", "", pageArt("materials")) + papersBlock("device", state.cat, "paper-search");
      bindPapers(render, "paper-search");
      if (keepFocus) refocus("paper-search");
    }
    render();
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
    var tabs = [["news", "AI news"], ["papers", "AI research"], ["playbook", "AI in devices & VLSI"]];
    function render(keepFocus) {
      var h = head("AI Hub", "AI, and how it is reshaping devices & VLSI", "Latest AI news and research, and how machine learning and LLMs are being applied to device physics, materials, EDA and chip design.", "", "ai");
      h += briefingCard("ai");
      h += '<div class="controls"><div class="chips">' + tabs.map(function (t) { return chip(t[1], t[0], state.aiTab === t[0], "aitab"); }).join("") + "</div></div>";
      if (state.aiTab === "news" || state.aiTab === "papers") {
        h += '<div class="controls"><div class="chips">' + chip("All", "all", state.aiTopic === "all", "aitopic") +
          topicsOf("ai").map(function (t) { return chip(t.name, t.id, state.aiTopic === t.id, "aitopic"); }).join("") + "</div></div>";
      }
      if (state.aiTab === "news") h += newsBlock("ai", state.aiTopic, "ai-news-search");
      else if (state.aiTab === "papers") h += papersBlock("ai", state.aiTopic, "ai-paper-search");
      else h += playbookHtml();
      app.innerHTML = h;
      [["aitab", "aiTab"], ["aitopic", "aiTopic"]].forEach(function (pair) {
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

  function courseCard(c, topic) {
    return '<a class="card hover news-card course fade-in" href="' + safeUrl(c.url) + '" target="_blank" rel="noopener noreferrer">' + media(null, topic, c.title, c.format || "Free") +
      '<div class="body"><h3>' + esc(c.title) + '</h3><p class="small muted" style="margin:0">' + esc(c.by) + "</p>" +
      '<div class="foot">' + tagsHtml({ topics: c.topics }, 2) + '<span class="read">Open ↗</span></div></div></a>';
  }
  function videoCard(v) {
    var t = primaryTopic(v);
    return '<a class="card hover news-card video fade-in" href="' + safeUrl(v.url) + '" target="_blank" rel="noopener noreferrer">' +
      '<div class="media">' + (v.thumbnail ? '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + safeUrl(v.thumbnail) + '" data-topic="' + esc(t) + '" data-key="' + esc(v.id) + '">' : window.DeviceArt(t, v.id)) + '<div class="play"><span></span></div></div>' +
      '<div class="body"><div class="meta"><span class="src">' + esc(v.source) + '</span><span class="dot">' + esc(timeAgo(v.published)) + "</span></div><h3>" + esc(v.title) + "</h3></div></a>";
  }
  // ------------------------------------------------------------------ free video course library (devices / circuits)
  var LIB_GROUPS = [
    ["all", "All", "Every free video course in the library"],
    ["devices", "Devices", "Device physics, modeling, power devices, nanoelectronics"],
    ["circuits", "Circuits", "Analog, digital and VLSI circuit design"]
  ];
  var LEVELS = ["Beginner", "Intermediate", "Advanced"];
  function libMatches(c, q) {
    if (!q) return true;
    var hay = [c.title, c.by, c.institute, c.provider, c.subject, c.level].join(" ").toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function libCard(c) {
    var t = (c.topics || [])[0] || (c.group === "circuits" ? "vlsi" : "logic-devices");
    return '<a class="card hover news-card course lib-card fade-in" href="' + safeUrl(c.url) + '" target="_blank" rel="noopener noreferrer">' + media(null, t, c.title, c.provider) +
      '<div class="body"><div class="meta"><span class="badge oa">Free</span><span class="badge lvl lvl-' + esc(String(c.level).toLowerCase()) + '">' + esc(c.level) + "</span></div>" +
      "<h3>" + esc(c.title) + '</h3><p class="small muted" style="margin:0">' + esc(c.by) + (c.institute ? " · <b>" + esc(c.institute) + "</b>" : "") + "</p>" +
      '<div class="foot"><span class="tag">' + esc(c.subject) + '</span><span class="read">Watch free ↗</span></div></div></a>';
  }
  function libraryBlock(lib) {
    var all = lib.courses || [], subjects = lib.subjects || {};
    var inGroup = all.filter(function (c) { return state.libGroup === "all" || c.group === state.libGroup; });
    var subjList = state.libGroup === "all" ? (subjects.devices || []).concat(subjects.circuits || []) : (subjects[state.libGroup] || []);
    if (state.libSubject && subjList.indexOf(state.libSubject) === -1) state.libSubject = "";
    var providers = [];
    all.forEach(function (c) { if (providers.indexOf(c.provider) === -1) providers.push(c.provider); });
    var shown = inGroup.filter(function (c) {
      return (!state.libSubject || c.subject === state.libSubject) && (state.libProvider === "all" || c.provider === state.libProvider) &&
        (state.libLevel === "all" || c.level === state.libLevel) && libMatches(c, state.libQuery);
    });
    var gc = { all: all.length, devices: 0, circuits: 0 };
    all.forEach(function (c) { gc[c.group] = (gc[c.group] || 0) + 1; });
    var h = '<section id="library"><div class="section-title"><h2>Free video courses</h2><span class="muted small">' + all.length + " courses · NPTEL, MIT OpenCourseWare, nanoHUB</span></div>" +
      '<div class="region-tabs lib-tabs fade-in" role="tablist">' + LIB_GROUPS.map(function (g) {
        return '<button type="button" class="region' + (state.libGroup === g[0] ? " active" : "") + '" data-libgroup="' + g[0] + '"><b>' + esc(g[1]) + "</b><span>" + esc(g[2]) + "</span><i>" + (gc[g[0]] || 0) + "</i></button>";
      }).join("") + "</div>";
    var sc = {};
    inGroup.forEach(function (c) { sc[c.subject] = (sc[c.subject] || 0) + 1; });
    h += '<div class="controls lib-controls"><input type="search" id="lib-search" placeholder="Search course, professor or institute (e.g. MOSFET, Karmalkar, IIT Madras)" value="' + esc(state.libQuery) + '" aria-label="Search video courses">' +
      '<select id="lib-provider" aria-label="Provider"><option value="all">All providers</option>' + providers.map(function (p) {
        return '<option value="' + esc(p) + '"' + (state.libProvider === p ? " selected" : "") + ">" + esc(p) + "</option>";
      }).join("") + "</select>" +
      '<select id="lib-level" aria-label="Level"><option value="all">All levels</option>' + LEVELS.map(function (l) {
        return '<option value="' + l + '"' + (state.libLevel === l ? " selected" : "") + ">" + l + "</option>";
      }).join("") + "</select></div>" +
      '<div class="controls"><div class="chips">' + chip("All subjects", "", !state.libSubject, "libsubj", inGroup.length) +
      subjList.map(function (s) { return chip(s, s, state.libSubject === s, "libsubj", sc[s] || 0); }).join("") + "</div></div>";
    if (!all.length) return h + empty("The course library appears after the next update.") + "</section>";
    if (!shown.length) return h + empty('No courses match these filters. <button type="button" class="linkish" data-libclear>Clear filters</button>') + "</section>";
    subjList.forEach(function (s) {
      var cs = shown.filter(function (c) { return c.subject === s; });
      if (!cs.length) return;
      h += '<div class="learn-group"><h3 class="learn-topic lib-subject">' + esc(s) + ' <small class="muted">' + cs.length + " course" + (cs.length === 1 ? "" : "s") + "</small></h3>" +
        '<div class="grid-cards">' + cs.map(libCard).join("") + "</div></div>";
    });
    return h + "</section>";
  }
  function bindLibrary(rerender) {
    bindSearch("lib-search", "libQuery", rerender);
    function sel(id, key) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", function () { state[key] = el.value; rerender(); });
    }
    sel("lib-provider", "libProvider"); sel("lib-level", "libLevel");
    Array.prototype.forEach.call(app.querySelectorAll("[data-libgroup]"), function (b) {
      b.addEventListener("click", function () { state.libGroup = b.getAttribute("data-libgroup"); state.libSubject = ""; rerender(); });
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-libsubj]"), function (b) {
      b.addEventListener("click", function () { state.libSubject = b.getAttribute("data-libsubj"); rerender(); });
    });
    var clr = app.querySelector("[data-libclear]");
    if (clr) clr.addEventListener("click", function () { state.libSubject = ""; state.libProvider = "all"; state.libLevel = "all"; state.libQuery = ""; rerender(); });
  }

  function pageLearn() {
    function render(keepFocus) {
      app.innerHTML = learnHtml();
      bindLibrary(render);
      if (keepFocus) refocus("lib-search");
    }
    render();
  }
  function learnHtml() {
    var L = D.learn || {}, cat = state.cat;
    var all = L.items || [];
    var items = all.filter(function (i) { return inCat(i, cat); });
    var courses = (L.courses || []).filter(function (c) { return inCat(c, cat); });
    var videos = items.filter(function (i) { return i.kind === "video"; });
    var talks = items.filter(function (i) { return i.kind === "interview"; });
    var reads = items.filter(function (i) { return i.kind === "article"; });
    var h = head("Learn" + catSuffix(), cat === "all" ? "Lectures, courses & deep dives" : topicName(cat),
      "Free video courses from IIT and IISc professors on NPTEL, MIT OpenCourseWare and Purdue's nanoHUB, sorted into Devices and Circuits. Filter by subject, provider and level, or search for a professor.", "", pageArt("sram"));

    h += libraryBlock(L.library || {});

    // more free lectures & resources, in one section per topic
    h += '<section><div class="section-title"><h2>More free lectures & resources by topic</h2><span class="muted small">' + courses.length + " free to open</span></div>";
    if (cat !== "all") {
      h += courses.length ? '<div class="grid-cards">' + courses.map(function (c) { return courseCard(c, cat); }).join("") + "</div>" : empty("No lectures listed for this topic yet. Try <b>All</b>.");
    } else {
      topicsOf("device").forEach(function (t) {
        var cs = courses.filter(function (c) { return (c.topics || [])[0] === t.id; });
        if (!cs.length) return;
        h += '<div class="learn-group"><h3 class="learn-topic"><button type="button" data-cat="' + esc(t.id) + '">' + esc(t.name) + ' <span>→</span></button></h3><div class="grid-cards">' + cs.map(function (c) { return courseCard(c, t.id); }).join("") + "</div></div>";
      });
    }
    h += "</section>";

    var vids = videos.length ? videos : [];
    h += '<section><div class="section-title"><h2>Latest videos' + (cat === "all" ? "" : " on " + esc(shortTopic(cat))) + "</h2></div>" +
      (vids.length ? '<div class="grid-news">' + vids.slice(0, 12).map(videoCard).join("") + "</div>" :
        empty(all.length ? "No recent videos on this topic. The lectures above are a good place to start." : "No videos yet. They appear after the next update.")) + "</section>";
    h += '<div class="grid-2"><section><div class="section-title"><h2>Interviews & keynotes</h2></div>' + (talks.length ? '<div class="list">' + talks.slice(0, 10).map(function (t) { return compactCard({ id: t.id, title: t.title, url: t.url, topics: t.topics && t.topics.length ? t.topics : ["industry"] }, t.source + " · " + timeAgo(t.published)); }).join("") + "</div>" : empty("No interviews on this topic right now.")) + "</section>";
    h += '<section style="margin-top:0"><div class="section-title"><h2>Deep-dive reads</h2></div>' + (reads.length ? '<div class="list">' + reads.slice(0, 10).map(function (r) {
      return compactCard({ id: r.id, title: r.title, url: r.url, image: r.thumbnail, topics: r.topics && r.topics.length ? r.topics : ["process"], tldr: r.description }, r.source + " · " + timeAgo(r.published));
    }).join("") + "</div>" : empty("No deep-dive articles on this topic right now.")) + "</section></div>";
    return h;
  }

  // ------------------------------------------------------------------ where to publish
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Next time a month comes round on or after `from` (same month counts).
  function nextMonth(month, from) {
    var y = from.getFullYear();
    if (month - 1 < from.getMonth()) y++;
    return new Date(y, month - 1, 1);
  }
  function monthsUntil(d, now) { return (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth(); }
  function whenText(n) { return n <= 0 ? "this month" : n === 1 ? "next month" : "in " + n + " months"; }
  function confSchedule(c, now) {
    var dl = nextMonth(c.deadline, now);
    var ev = nextMonth(c.month, new Date(dl.getFullYear(), dl.getMonth() + 1, 1));
    return { deadline: dl, event: ev, until: monthsUntil(dl, now) };
  }
  function normVenue(s) { return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim(); }
  function venuePaperCount(j) {
    var keys = [normVenue(j.name)];
    return D.papers.filter(function (p) {
      var v = normVenue(p.venue);
      return v && keys.some(function (k) { return v === k || v.indexOf(k + " ") === 0; });
    }).length;
  }
  function scimago(name) { return "https://www.scimagojr.com/journalsearch.php?q=" + encodeURIComponent(name); }
  var TIER = { flagship: "Flagship", major: "Major", specialist: "Specialist" };

  function confCard(c, s) {
    var soon = s.until <= 2;
    return '<article class="card conf fade-in' + (soon ? " soon" : "") + '">' +
      '<div class="conf-date"><span class="m">' + MONTHS[s.deadline.getMonth()] + '</span><span class="y">' + s.deadline.getFullYear() + '</span><span class="w">' + esc(whenText(s.until)) + "</span></div>" +
      '<div class="conf-body"><div class="meta"><span class="badge tier-' + esc(c.tier) + '">' + esc(TIER[c.tier] || c.tier) + "</span>" + (soon ? '<span class="badge ambitious">Deadline soon</span>' : "") + "</div>" +
      "<h3>" + ext(c.url, c.name) + '</h3><p class="small muted full">' + esc(c.full) + "</p>" +
      (c["for"] ? '<p class="small">' + esc(c["for"]) + "</p>" : "") +
      '<dl class="conf-facts"><div><dt>Paper deadline</dt><dd>' + esc((c.deadline_note ? c.deadline_note + " " : "") + MONTHS[c.deadline - 1]) + " " + s.deadline.getFullYear() + "</dd></div>" +
      "<div><dt>Conference</dt><dd>" + MONTHS[s.event.getMonth()] + " " + s.event.getFullYear() + (c.where ? " · " + esc(c.where) : "") + "</dd></div></dl>" +
      '<div class="foot">' + tagsHtml({ topics: c.topics }, 3) + ext(c.url, "Call for papers ↗", "read") + "</div></div></article>";
  }
  function journalCard(j) {
    var n = venuePaperCount(j);
    return '<article class="card journal fade-in"><div class="jq q' + esc(String(j.quartile).slice(1)) + '" title="Approximate Scimago quartile">' + esc(j.quartile) + "</div>" +
      '<div class="j-body"><div class="meta"><span class="src">' + esc(j.publisher) + '</span><span class="dot">' + esc(j.type) + "</span>" + (j.open_access ? '<span class="badge oa">Open access</span>' : "") + "</div>" +
      "<h3>" + ext(j.url, j.name) + (j.abbr ? ' <span class="abbr">' + esc(j.abbr) + "</span>" : "") + "</h3>" +
      (j["for"] ? '<p class="small">' + esc(j["for"]) + "</p>" : "") +
      (n ? '<p class="small hit">' + n + " recent paper" + (n === 1 ? "" : "s") + " from here on Device Hub</p>" : "") +
      '<div class="foot">' + tagsHtml({ topics: j.topics }, 3) + '<span class="links" style="margin:0">' + ext(scimago(j.name), "Check rank ↗") + ext(j.url, "Journal ↗") + "</span></div></div></article>";
  }

  function pagePublish() {
    var V = D.venues || {}, now = new Date();
    var conf = (V.conferences || []).filter(function (c) { return inCat(c, state.cat); });
    var jour = (V.journals || []).filter(function (j) { return inCat(j, state.cat); });
    function render() {
      var h = head("Where to publish" + catSuffix(), state.cat === "all" ? "Conferences & journals for your next paper" : topicName(state.cat),
        "Upcoming paper deadlines for the main device, memory and VLSI conferences, and journals with their quartile rank. Pick a topic above to see only the venues that fit it.", "", pageArt("process"));
      h += '<div class="controls"><div class="chips">' + chip("Conferences", "conf", state.pubTab === "conf", "pubtab", conf.length) + chip("Journals & transactions", "jour", state.pubTab === "jour", "pubtab", jour.length) + "</div></div>";
      if (state.pubTab === "conf") {
        var tiers = ["all", "flagship", "major", "specialist"];
        h += '<div class="controls"><div class="chips">' + tiers.map(function (t) { return chip(t === "all" ? "All tiers" : TIER[t], t, state.pubTier === t, "pubtier"); }).join("") + "</div></div>";
        var list = conf.filter(function (c) { return state.pubTier === "all" || c.tier === state.pubTier; })
          .map(function (c) { return { c: c, s: confSchedule(c, now) }; })
          .sort(function (a, b) { return a.s.deadline - b.s.deadline || a.c.name.localeCompare(b.c.name); });
        h += '<p class="notice">Ordered by the next paper deadline. Dates are the <b>usual</b> months for each meeting and shift a little every year, so open the call for papers before you plan around one.</p>';
        h += list.length ? '<div class="pub-grid">' + list.map(function (x) { return confCard(x.c, x.s); }).join("") + "</div>" : empty("No conferences listed for this topic yet.");
      } else {
        var qs = ["all", "Q1", "Q2", "Q3"];
        h += '<div class="controls"><div class="chips">' + qs.map(function (q) { return chip(q === "all" ? "All ranks" : q === "Q3" ? "Q3 & below" : q, q, state.pubQ === q, "pubq"); }).join("") +
          chip("Open access only", "oa", state.pubOA, "puboa") + "</div></div>";
        var js = jour.filter(function (j) {
          if (state.pubOA && !j.open_access) return false;
          if (state.pubQ === "all") return true;
          return state.pubQ === "Q3" ? j.quartile === "Q3" || j.quartile === "Q4" : j.quartile === state.pubQ;
        }).sort(function (a, b) { return a.quartile.localeCompare(b.quartile) || (a.type === "Letters" ? -1 : 0) - (b.type === "Letters" ? -1 : 0) || a.name.localeCompare(b.name); });
        h += '<p class="notice">Q1 is the top quarter of journals in a subject. Ranks shown are approximate best-category <a href="https://www.scimagojr.com/" target="_blank" rel="noopener noreferrer">Scimago</a> quartiles and change yearly, so use <b>Check rank</b> to confirm. <b>Letters</b> journals take short papers and review fastest.</p>';
        h += js.length ? '<div class="pub-grid">' + js.map(journalCard).join("") + "</div>" : empty("No journals match these filters.");
      }
      app.innerHTML = h;
      [["pubtab", "pubTab"], ["pubtier", "pubTier"], ["pubq", "pubQ"]].forEach(function (pair) {
        Array.prototype.forEach.call(app.querySelectorAll("[data-" + pair[0] + "]"), function (b) {
          b.addEventListener("click", function () { state[pair[1]] = b.getAttribute("data-" + pair[0]); render(); });
        });
      });
      var oa = app.querySelector("[data-puboa]");
      if (oa) oa.addEventListener("click", function () { state.pubOA = !state.pubOA; render(); });
    }
    if (!V.conferences && !V.journals) { app.innerHTML = head("Where to publish", "Conferences & journals", "", "", "process") + noData(); return; }
    render();
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
      .sort(function (a, b) { return String(b.it.published || "").localeCompare(String(a.it.published || "")); })
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
    route(true);
  });
  function currentRoute() {
    var hash = location.hash.replace(/^#\/?/, "") || "home";
    var qm = hash.match(/[?&]cat=([\w-]+)/);
    var sm = hash.match(/[?&]sec=(tech|market|general|all)/);
    if (sm) state.newsSection = sm[1];
    var rm = hash.match(/[?&]region=(india|international)/);
    if (rm) state.newsRegion = rm[1];
    var gm = hash.match(/[?&]group=(devices|circuits|all)/);
    if (gm) state.libGroup = gm[1];
    var parts = hash.split("?")[0].split("/");
    return { name: parts[0] || "home", arg: parts[1], cat: qm && qm[1] };
  }
  function route(keepScroll) {
    var r = currentRoute();
    if (r.cat) setCat(r.cat);
    renderCatBar(r.name);
    if (r.name === "radar" || r.name === "report") { location.replace("#/research"); return; } // old Research gaps links
    setActive(r.name);
    if (r.name === "news") pageNews();
    else if (r.name === "research") pageResearch();
    else if (r.name === "ai") pageAI();
    else if (r.name === "learn") pageLearn();
    else if (r.name === "publish" || r.name === "events") { setActive("publish"); pagePublish(); }
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
