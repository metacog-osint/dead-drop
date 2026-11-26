/* Radio Horizon Calculator page. The maths is in ../lib/radio-horizon.js (tested in tests/radio-horizon.test.js). */
(function () {
  "use strict";
  var KEY = "radio-horizon";
  var RH = DD.radioHorizon;
  var SVGNS = "http://www.w3.org/2000/svg";
  var last = null;
  var MODELS = [["radio", "Radio, k = 4/3"], ["optical", "Light by day, k = 7/6"], ["geometric", "Geometric, k = 1"]];

  function optNum(id) { var v = TB.num(id); return isFinite(v) ? v : null; }
  function kValue() {
    var v = TB.$("k").value;
    return v === "other" ? TB.num("kOther") : RH.K[v];
  }
  function km(x, n) { return TB.fix(x, n === undefined ? 2 : n); }

  function svg(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** Side view: the bulge of the effective Earth under the straight chord, the two masts, the sight line and,
   *  when a frequency is given, the first Fresnel zone and its 60 % line. Heights are exaggerated. */
  function drawProfile(L) {
    var box = TB.$("profile");
    TB.clear(box);
    if (!L.path) return;
    var p = L.path, inp = L.input, D = inp.distKm, k = L.k, f = inp.freqGHz, N = 120;
    var xs = [], ground = [], line = [], up = [], dn = [], up6 = [], dn6 = [];
    for (var i = 0; i <= N; i++) {
      var x = D * i / N, b = RH.bulgeM(x, D - x, k), y = inp.h1 + (inp.h2 - inp.h1) * x / D;
      xs.push(x); ground.push(b); line.push(y);
      if (f) { var r = RH.fresnelRadiusM(x, D - x, f); up.push(y + r); dn.push(y - r); up6.push(y + 0.6 * r); dn6.push(y - 0.6 * r); }
    }
    var all = ground.concat(line, up, dn, [0]);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (hi - lo < 1) hi = lo + 1;
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var W = 600, H = 240, L0 = 52, R0 = 12, T0 = 12, B0 = 34;
    var X = function (x) { return L0 + (W - L0 - R0) * x / D; };
    var Y = function (y) { return T0 + (H - T0 - B0) * (hi - y) / (hi - lo); };
    var poly = function (ys) { return xs.map(function (x, j) { return X(x).toFixed(1) + "," + Y(ys[j]).toFixed(1); }); };
    var fig = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "figure", role: "img",
      "aria-label": "Side view of the path from A to B: " + (p.visible ? "in line of sight" : "blocked by the Earth's curve") });
    var g = poly(ground);
    g.push(X(D).toFixed(1) + "," + Y(lo).toFixed(1), X(0).toFixed(1) + "," + Y(lo).toFixed(1));
    fig.appendChild(svg("polygon", { points: g.join(" "), class: "rh-ground" }));
    if (f) {
      fig.appendChild(svg("polygon", { points: poly(up).concat(poly(dn).reverse()).join(" "), class: "rh-zone" }));
      fig.appendChild(svg("polyline", { points: poly(dn6).join(" "), class: "rh-zone60" }));
      fig.appendChild(svg("polyline", { points: poly(up6).join(" "), class: "rh-zone60" }));
    }
    fig.appendChild(svg("line", { x1: X(0), y1: Y(0), x2: X(0), y2: Y(inp.h1), class: "rh-mast" }));
    fig.appendChild(svg("line", { x1: X(D), y1: Y(0), x2: X(D), y2: Y(inp.h2), class: "rh-mast" }));
    fig.appendChild(svg("line", { x1: X(0), y1: Y(inp.h1), x2: X(D), y2: Y(inp.h2), class: "rh-sight " + (p.visible ? "ok" : "bad") }));
    if (L.point) fig.appendChild(svg("line", { x1: X(L.point.xKm), y1: Y(lo), x2: X(L.point.xKm), y2: Y(hi), class: "rh-point" }));
    fig.appendChild(svg("line", { x1: L0, y1: H - B0, x2: W - R0, y2: H - B0, class: "faint", stroke: "currentColor" }));
    fig.appendChild(svg("text", { x: L0 - 6, y: T0 + 10, "text-anchor": "end" }, TB.fix(hi, 0) + " m"));
    fig.appendChild(svg("text", { x: L0 - 6, y: H - B0, "text-anchor": "end" }, TB.fix(lo, 0) + " m"));
    fig.appendChild(svg("text", { x: L0, y: H - B0 + 18, "text-anchor": "start" }, "A"));
    fig.appendChild(svg("text", { x: W - R0, y: H - B0 + 18, "text-anchor": "end" }, "B, " + km(D) + " km"));
    box.appendChild(fig);
    box.appendChild(TB.el("p", { class: "small muted", text: "Side view with the straight chord between the feet of A and B " +
      "drawn level: the grey hump is the Earth bulge for k = " + TB.fix(k, 3) + "; the line joins the two tops" +
      (f ? "; the shaded band is the first Fresnel zone and the dashed lines mark 60 % of it" : "") +
      ". Heights are exaggerated against distance." }));
  }

  function render() {
    var L = last, inp = L.input, k = L.k, C = RH.ruleCoefficient(k);
    var items = [
      { k: "Horizon of A", v: km(RH.horizonKm(inp.h1, k)), u: "km", title: "√(2 k R h); " + TB.fix(C, 2) + " √h" },
      { k: "Rule of thumb for this k", v: "d = " + TB.fix(C, 2) + " √h", u: "km, h in m" }
    ];
    if (inp.h2 !== null) {
      items.splice(1, 0, { k: "Horizon of B", v: km(RH.horizonKm(inp.h2, k)), u: "km" },
        { k: "Longest line of sight A to B", v: km(RH.maxLosKm(inp.h1, inp.h2, k)), u: "km", cls: "ok",
          title: "The two horizons added" });
    }
    TB.results("results", items);

    var p = L.path;
    TB.$("linkHead").hidden = !p;
    if (p) {
      var li = [
        { k: "In line of sight at " + km(inp.distKm) + " km", v: p.visible ? "Yes" : "No: the Earth's curve is in the way",
          cls: p.visible ? "ok" : "alarm" },
        { k: p.visible ? "Least clearance above the surface" : "Line passes below the surface by",
          v: TB.fix(Math.abs(p.minClearanceM), 2), u: "m", title: "At " + km(p.minClearanceAtKm) + " km from A" },
        { k: "Where", v: km(p.minClearanceAtKm), u: "km from A" },
        { k: "Earth bulge at mid-path", v: TB.fix(p.midBulgeM, 2), u: "m" }
      ];
      if (!p.visible) {
        li.push({ k: "Height B needs to see A", v: TB.fix(p.heightNeededAtBM, 2), u: "m", title: "With A at its height" });
        li.push({ k: "Height A needs to see B", v: TB.fix(p.heightNeededAtAM, 2), u: "m", title: "With B at its height" });
      }
      if (p.frequencyGHz) {
        li.push({ k: "60 % of the first Fresnel zone clear", v: p.fresnel60Clear ? "Yes" : "No",
          cls: p.fresnel60Clear ? "ok" : "warn", title: "Over the smooth surface, all along the path" });
        li.push({ k: p.fresnel60Clear ? "Least margin over 0.6 r1" : "Short of 0.6 r1 by", v: TB.fix(Math.abs(p.fresnelMarginM), 2),
          u: "m", title: "At " + km(p.fresnelMarginAtKm) + " km from A" });
        if (!p.fresnel60Clear) li.push({ k: "Height at B for 60 % clearance", v: TB.fix(p.heightForFresnelAtBM, 1), u: "m" });
      }
      TB.results("link", li);
    } else TB.clear(TB.$("link"));

    var q = L.point;
    TB.$("pointHead").hidden = !q;
    if (q) {
      TB.$("pointHead").textContent = "At " + km(q.xKm) + " km from A, " + km(inp.distKm - q.xKm) + " km from B";
      var pi = [
        { k: "Earth bulge", v: TB.fix(q.bulgeM, 2), u: "m", title: "d1 d2 / (2 k R)" },
        { k: "Sight line above the surface", v: TB.fix(q.sightLineM, 2), u: "m", cls: q.sightLineM >= 0 ? null : "alarm" }
      ];
      if (q.fresnelM !== undefined) {
        pi.push({ k: "First Fresnel zone radius r1", v: TB.fix(q.fresnelM, 2), u: "m" });
        pi.push({ k: "60 % of r1", v: TB.fix(q.fresnel60M, 2), u: "m" });
        if (q.clearanceRatio !== null) pi.push({ k: "Clearance in units of r1", v: TB.fix(q.clearanceRatio, 2),
          cls: q.clearanceRatio >= 0.6 ? "ok" : "warn", title: "0.6 or more is the usual planning target" });
      }
      TB.results("pointRes", pi);
    } else TB.clear(TB.$("pointRes"));

    var rows = MODELS.map(function (m) {
      var kk = RH.K[m[0]];
      var r = [m[1], km(RH.horizonKm(inp.h1, kk))];
      if (inp.h2 !== null) r.push(km(RH.horizonKm(inp.h2, kk)), km(RH.maxLosKm(inp.h1, inp.h2, kk)));
      return r;
    });
    TB.table("table", inp.h2 !== null ? ["Model", "Horizon of A (km)", "Horizon of B (km)", "A to B (km)"] :
      ["Model", "Horizon of A (km)"], rows);
    drawProfile(L);
  }

  function run() {
    TB.message("msg", "");
    var input = { h1: TB.num("h1"), h2: optNum("h2"), model: TB.$("k").value, kOther: optNum("kOther"),
      distKm: optNum("dist"), freqGHz: optNum("freq"), pointKm: optNum("point") };
    try {
      var k = kValue();
      if (!isFinite(input.h1)) throw new Error("Enter the height of A.");
      RH.horizonKm(input.h1, k);
      if (input.h2 !== null) RH.horizonKm(input.h2, k);
      if (input.freqGHz !== null && !(input.freqGHz > 0)) throw new Error("Frequency must be above 0 GHz, or empty.");
      var path = null, point = null;
      if (input.distKm !== null) {
        if (input.h2 === null) throw new Error("Enter the height of B for the link check, or empty the distance.");
        path = RH.path(input.h1, input.h2, input.distKm, k, input.freqGHz === null ? undefined : input.freqGHz);
        var x = input.pointKm === null ? input.distKm / 2 : input.pointKm;
        point = RH.atPoint(input.h1, input.h2, input.distKm, x, k, input.freqGHz === null ? undefined : input.freqGHz);
      }
      last = { input: input, k: k, path: path, point: point };
      TB.save(KEY, input);
      render();
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }

  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      ["h1", "h2", "kOther"].forEach(function (id) { if (saved[id] === null || isFinite(saved[id])) TB.$(id).value = saved[id] === null ? "" : saved[id]; });
      if (saved.distKm === null || isFinite(saved.distKm)) TB.$("dist").value = saved.distKm === null ? "" : saved.distKm;
      if (saved.freqGHz === null || isFinite(saved.freqGHz)) TB.$("freq").value = saved.freqGHz === null ? "" : saved.freqGHz;
      if (saved.pointKm === null || isFinite(saved.pointKm)) TB.$("point").value = saved.pointKm === null ? "" : saved.pointKm;
      if (["radio", "optical", "geometric", "other"].indexOf(saved.model) >= 0) TB.$("k").value = saved.model;
    }
    var sel = TB.$("k");
    TB.$("kOtherRow").hidden = sel.value !== "other";
    sel.addEventListener("change", function () { TB.$("kOtherRow").hidden = sel.value !== "other"; run(); });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
