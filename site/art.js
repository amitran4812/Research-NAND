/* Device Hub cover art: a small SVG illustration per category, used when a story
   or paper has no image of its own. Colours come from CSS (--art-*), so the art
   follows the light/dark theme. */
(function () {
  "use strict";

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var x = seed || 1;
    return function () { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; };
  }
  var L = 'class="ln"', F = 'class="fl"', A = 'class="ac"';

  var motifs = {
    // DRAM: capacitor array (cylinders) above access lines
    dram: function (r) {
      var s = "";
      for (var row = 0; row < 3; row++) for (var c = 0; c < 7; c++) {
        var x = 60 + c * 46 + (row % 2) * 23, y = 58 + row * 52;
        s += '<ellipse ' + L + ' cx="' + x + '" cy="' + y + '" rx="13" ry="5"/><path ' + L + ' d="M' + (x - 13) + " " + y + "v30M" + (x + 13) + " " + y + 'v30"/><ellipse ' + (r() > .8 ? A : L) + ' cx="' + x + '" cy="' + (y + 30) + '" rx="13" ry="5"/>';
      }
      return s + '<path ' + L + ' d="M30 205h340M30 195h340" opacity=".6"/>';
    },
    // NAND: word-line stack pierced by vertical channel holes
    nand: function (r) {
      var s = "";
      for (var i = 0; i < 12; i++) s += '<path ' + L + ' d="M40 ' + (40 + i * 13) + 'h320" opacity="' + (0.35 + 0.05 * (i % 3)) + '"/>';
      var pick = Math.floor(r() * 6);
      for (var c = 0; c < 6; c++) {
        var x = 75 + c * 50 + (r() * 6 - 3);
        s += '<rect ' + (c === pick ? A : F) + ' x="' + (x - 7) + '" y="30" width="14" height="165" rx="7"/>';
      }
      return s;
    },
    // Emerging memory: magnetic tunnel junction / switching hysteresis
    "emerging-memory": function (r) {
      var s = '<rect ' + F + ' x="120" y="60" width="160" height="22" rx="4"/><rect ' + A + ' x="120" y="92" width="160" height="10" rx="3"/><rect ' + F + ' x="120" y="112" width="160" height="22" rx="4"/>';
      s += '<path ' + L + ' d="M200 40v20M200 134v50M160 71h-12m4-4-4 4 4 4M240 123h12m-4-4 4 4-4 4"/>';
      s += '<path ' + L + ' d="M60 190c40 0 40-40 80-40M340 40c-40 0-40 40-80 40" opacity=".6"/>';
      return s;
    },
    // SRAM: 6T cell — cross-coupled inverters
    sram: function () {
      var s = "";
      for (var c = 0; c < 4; c++) for (var row = 0; row < 2; row++) {
        var x = 55 + c * 80, y = 45 + row * 80;
        s += '<rect ' + L + ' x="' + x + '" y="' + y + '" width="62" height="62" rx="6"/><path ' + L + ' d="M' + (x + 14) + " " + (y + 20) + "l10 10-10 10M" + (x + 48) + " " + (y + 42) + 'l-10-10 10-10"/><circle ' + ((c + row) % 3 === 0 ? A : F) + ' cx="' + (x + 31) + '" cy="' + (y + 31) + '" r="4"/>';
      }
      return s;
    },
    // CFET / GAA: stacked nanosheets wrapped by a gate
    "logic-devices": function () {
      var s = '<rect ' + L + ' x="140" y="35" width="120" height="160" rx="14"/>';
      for (var i = 0; i < 6; i++) {
        var y = 52 + i * 23;
        s += '<rect ' + (i < 3 ? F : A) + ' x="70" y="' + y + '" width="260" height="10" rx="5"/>';
      }
      return s + '<path ' + L + ' d="M60 120h280" stroke-dasharray="4 6" opacity=".5"/>';
    },
    // 2D materials: hexagonal lattice
    materials: function (r) {
      var s = "", w = 26, h = 22.5;
      for (var row = 0; row < 9; row++) for (var c = 0; c < 9; c++) {
        var cx = 70 + c * w * 1.5, cy = 25 + row * h + (c % 2) * h / 2;
        if (cx > 360) continue;
        var pts = [];
        for (var k = 0; k < 6; k++) { var a = Math.PI / 3 * k; pts.push((cx + 13 * Math.cos(a)).toFixed(1) + "," + (cy + 13 * Math.sin(a)).toFixed(1)); }
        s += '<polygon ' + (r() > .93 ? A : L) + ' points="' + pts.join(" ") + '"/>';
      }
      return s;
    },
    // Ferroelectric hysteresis loop
    dielectrics: function () {
      return '<path ' + L + ' d="M50 112h300M200 30v170" opacity=".45"/>' +
        '<path ' + A + ' fill="none" d="M70 185C150 185 170 150 200 112S250 40 330 40"/>' +
        '<path ' + L + ' d="M330 40C250 40 230 75 200 112S150 185 70 185"/>' +
        '<rect ' + F + ' x="60" y="200" width="280" height="8" rx="4" opacity=".6"/>';
    },
    // Interconnects: metal lines and vias
    interconnects: function (r) {
      var s = "";
      for (var i = 0; i < 6; i++) s += '<rect ' + F + ' x="40" y="' + (40 + i * 28) + '" width="320" height="10" rx="2" opacity="' + (i % 2 ? .55 : .85) + '"/>';
      for (var v = 0; v < 9; v++) {
        var x = 60 + Math.floor(r() * 280), y = 50 + Math.floor(r() * 5) * 28;
        s += '<rect ' + A + ' x="' + x + '" y="' + y + '" width="10" height="18"/>';
      }
      return s;
    },
    // Packaging: chiplets on an interposer with bumps
    packaging: function () {
      var s = '<rect ' + L + ' x="45" y="140" width="310" height="22" rx="4"/><rect ' + F + ' x="30" y="172" width="340" height="16" rx="4" opacity=".6"/>';
      [[60, 70, 120], [190, 50, 70], [270, 70, 80]].forEach(function (c, i) {
        s += '<rect ' + (i === 1 ? A : F) + ' x="' + c[0] + '" y="' + c[1] + '" width="' + c[2] + '" height="' + (130 - c[1]) + '" rx="6"/>';
        for (var b = c[0] + 8; b < c[0] + c[2] - 4; b += 12) s += '<circle ' + L + ' cx="' + b + '" cy="134" r="3"/>';
      });
      return s;
    },
    // Process: wafer with die grid
    process: function (r) {
      var s = '<circle ' + L + ' cx="200" cy="115" r="92"/><path ' + L + ' d="M190 207h20"/>';
      for (var x = 120; x <= 270; x += 30) for (var y = 35; y <= 185; y += 30) {
        var dx = x + 15 - 200, dy = y + 15 - 115;
        if (dx * dx + dy * dy < 80 * 80) s += '<rect ' + (r() > .9 ? A : F) + ' x="' + (x + 2) + '" y="' + (y + 2) + '" width="26" height="26" rx="2" opacity=".75"/>';
      }
      return s;
    },
    // Reliability: degradation curve with scattered measurements
    reliability: function (r) {
      var s = '<path ' + L + ' d="M50 30v170h310" opacity=".6"/><path ' + A + ' fill="none" d="M55 50C120 60 170 100 220 140S320 180 355 186"/>';
      for (var i = 0; i < 26; i++) {
        var t = i / 25, x = 55 + t * 300, y = 50 + 136 * (1 - Math.exp(-2.6 * t)) + (r() - .5) * 18;
        s += '<circle ' + F + ' cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.2"/>';
      }
      return s;
    },
    // Modeling / TCAD: simulation mesh and contours
    modeling: function (r) {
      var s = "", pts = [];
      for (var i = 0; i < 26; i++) pts.push([50 + r() * 300, 30 + r() * 170]);
      pts.forEach(function (p, i) {
        var q = pts[(i + 1) % pts.length], u = pts[(i + 7) % pts.length];
        s += '<path ' + L + ' d="M' + p[0].toFixed(0) + " " + p[1].toFixed(0) + "L" + q[0].toFixed(0) + " " + q[1].toFixed(0) + "L" + u[0].toFixed(0) + " " + u[1].toFixed(0) + '" opacity=".35"/>';
      });
      for (var k = 1; k < 5; k++) s += '<ellipse ' + (k === 2 ? A : L) + ' cx="200" cy="115" rx="' + k * 34 + '" ry="' + k * 20 + '" fill="none"/>';
      return s;
    },
    // Power / wide-bandgap: high-voltage pulse
    "power-devices": function () {
      return '<path ' + L + ' d="M40 160h60l20-110 30 150 25-120 25 90 20-60h140" opacity=".75"/>' +
        '<path ' + A + ' fill="none" d="M215 40l-30 70h30l-30 80 70-100h-30l30-50z"/>';
    },
    // VLSI: routed circuit traces with pads
    vlsi: function (r) {
      var s = '<rect ' + L + ' x="150" y="70" width="100" height="90" rx="8"/>';
      for (var i = 0; i < 8; i++) {
        var y = 80 + i * 10, side = i % 2;
        var x2 = side ? 360 - r() * 40 : 40 + r() * 40, mid = side ? 300 - r() * 30 : 100 + r() * 30;
        var yy = y + (r() - .5) * 70;
        s += '<path ' + L + ' d="M' + (side ? 250 : 150) + " " + y + "H" + mid.toFixed(0) + "L" + (mid + (side ? 20 : -20)).toFixed(0) + " " + yy.toFixed(0) + "H" + x2.toFixed(0) + '"/><circle ' + (i === 3 ? A : F) + ' cx="' + x2.toFixed(0) + '" cy="' + yy.toFixed(0) + '" r="4"/>';
      }
      return s;
    },
    // Industry & market: price line and bars
    industry: function (r) {
      var s = "", d = "M50 170", y = 170;
      for (var i = 0; i < 10; i++) {
        var h = 30 + r() * 110;
        s += '<rect ' + F + ' x="' + (55 + i * 30) + '" y="' + (200 - h) + '" width="16" height="' + h + '" rx="2" opacity=".45"/>';
        y = Math.max(40, Math.min(190, y - 12 + (r() - .4) * 30));
        d += "L" + (63 + i * 30) + " " + y.toFixed(0);
      }
      return s + '<path ' + A + ' fill="none" d="' + d + '"/>';
    },
    // AI: neural network
    ai: function (r) {
      var layers = [3, 5, 5, 2], s = "", pos = [];
      layers.forEach(function (n, li) {
        pos.push([]);
        for (var k = 0; k < n; k++) pos[li].push([80 + li * 80, 115 + (k - (n - 1) / 2) * 34]);
      });
      for (var li = 0; li < layers.length - 1; li++) pos[li].forEach(function (a) {
        pos[li + 1].forEach(function (b) { s += '<path ' + L + ' d="M' + a[0] + " " + a[1] + "L" + b[0] + " " + b[1] + '" opacity="' + (0.2 + r() * .4).toFixed(2) + '"/>'; });
      });
      pos.forEach(function (layer, li) { layer.forEach(function (p, k) { s += '<circle ' + ((li + k) % 4 === 1 ? A : F) + ' cx="' + p[0] + '" cy="' + p[1] + '" r="9"/>'; }); });
      return s;
    }
  };

  window.DeviceArt = function (topic, key) {
    var t = topic || "vlsi";
    var fn = motifs[t] || (t.indexOf("ai") === 0 ? motifs.ai : motifs.vlsi);
    var seed = hash((key || "") + t);
    var r = rng(seed);
    var angle = (seed % 50) - 25;
    var gid = "g" + seed.toString(36);
    return '<svg class="art" viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" gradientTransform="rotate(' + angle + ' .5 .5)" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="s1"/><stop offset="1" class="s2"/></linearGradient></defs>' +
      '<rect width="400" height="225" fill="url(#' + gid + ')"/><g class="motif">' + fn(r) + "</g></svg>";
  };
})();
