/* Viewshed Calculator page. The geometry is in ../lib/viewshed.js (tested in tests/viewshed.test.js).
   Ground heights come from Open-Elevation (api.open-elevation.com), a free public service. */
(function () {
  "use strict";
  var KEY = "viewshed";
  var V = DD.viewshed;
  var API = "https://api.open-elevation.com/api/v1/lookup";
  var CHUNK = 100, TIMEOUT_MS = 25000;
  var SVGNS = "http://www.w3.org/2000/svg";
  var map, obsMarker = null, layers = [], picking = false, busy = false, showAll = false;
  var targets = [];          // { lat, lon, h, marker }
  var last = null;           // { input, observer, rows: [...] }

  function readObserver() {
    var o = { lat: TB.num("obsLat"), lon: TB.num("obsLon"), h: TB.num("obsH") };
    if (!isFinite(o.h)) o.h = 0;
    return o;
  }
  function settings() {
    return { k: Number(TB.$("k").value), samples: TB.num("samples"), maxKm: TB.num("maxKm") };
  }
  function saveAll() {
    TB.save(KEY, { observer: readObserver(), settings: settings(),
      targets: targets.map(function (t) { return { lat: t.lat, lon: t.lon, h: t.h }; }) });
  }

  function drawObserver() {
    var o = readObserver();
    if (!isFinite(o.lat) || !isFinite(o.lon)) return;
    if (obsMarker) map.removeLayer(obsMarker);
    obsMarker = L.circleMarker([o.lat, o.lon], { radius: 8, color: "#ffffff", weight: 2, fillColor: "#2f6fd6", fillOpacity: 1 })
      .bindTooltip("Observer").addTo(map);
  }
  function targetMarker(t, colour) {
    if (t.marker) map.removeLayer(t.marker);
    t.marker = L.circleMarker([t.lat, t.lon], { radius: 6, color: "#ffffff", weight: 2, fillColor: colour || "#8a8f98", fillOpacity: 1 })
      .bindTooltip("Target " + (targets.indexOf(t) + 1)).addTo(map);
  }
  function addTarget(lat, lon, h) {
    var t = { lat: lat, lon: lon, h: h };
    V.profilePoints({ lat: 0, lon: 0 }, { lat: lat, lon: lon }, 2); // validates the coordinates
    if (!(h >= 0)) throw new Error("Target height must be zero or more.");
    targets.push(t);
    targetMarker(t);
    saveAll();
    TB.message("msg", "Target " + targets.length + " added. Calculate to check it.", "info");
  }
  function clearLines() { layers.forEach(function (l) { map.removeLayer(l); }); layers = []; }

  function fetchChunk(locations) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ locations: locations }), signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error("it answered HTTP " + r.status);
        return r.json();
      })
      .then(function (j) { return V.parseElevations(j, locations.length); },
        function (e) { throw new Error(e && e.name === "AbortError" ? "it did not answer within " + TIMEOUT_MS / 1000 + " s" : e.message || "the request failed"); })
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  function fetchHeights(points) {
    var out = [], i = 0;
    function next() {
      if (i >= points.length) return Promise.resolve(out);
      var slice = points.slice(i, i + CHUNK).map(function (p) {
        return { latitude: Number(p.lat.toFixed(6)), longitude: Number(p.lon.toFixed(6)) };
      });
      i += CHUNK;
      return fetchChunk(slice).then(function (h) { out = out.concat(h); return next(); });
    }
    return next();
  }

  function summary(observer, rows, k) {
    var items = [
      { k: "Targets", v: String(targets.length) },
      { k: "Horizon over level ground", v: TB.fix(V.horizonM(observer.h, k) / 1000, 2), u: "km",
        title: "For the observer's height above the ground around it, smooth Earth, this refraction setting" }
    ];
    if (rows) {
      var vis = rows.filter(function (r) { return r.result && r.result.visible; }).length;
      var blocked = rows.filter(function (r) { return r.result && !r.result.visible; }).length;
      items.push({ k: "Visible", v: String(vis), cls: vis ? "ok" : null });
      items.push({ k: "Blocked", v: String(blocked), cls: blocked ? "alarm" : null });
      var skipped = rows.length - vis - blocked;
      if (skipped) items.push({ k: "Not checked", v: String(skipped), cls: "warn" });
      if (rows[0] && rows[0].observerGround !== undefined) items.push({ k: "Ground at observer", v: TB.fix(rows[0].observerGround, 0), u: "m" });
    }
    TB.results("results", items);
  }

  function renderTable() {
    var rows = last.rows.map(function (r, i) {
      var res = r.result;
      if (!res) return [String(i + 1), TB.fix(r.distanceKm, 2), TB.fix(r.bearing, 1) + "°", "–", r.reason, "–", "–", "–"];
      return [String(i + 1), TB.fix(r.distanceKm, 2), TB.fix(r.bearing, 1) + "°", TB.fix(r.targetGround, 0) + " m",
        res.visible ? "Visible" : "Blocked " + TB.fix(res.obstructionAtM / 1000, 2) + " km out (ground " + TB.fix(res.obstructionGroundM, 0) + " m)",
        TB.fix(res.minClearanceM, 1) + " m", res.visible ? "–" : TB.fix(res.extraTargetHeightM, 1) + " m",
        TB.fix(r.spacingM, 0) + " m"];
    });
    TB.table("table", ["#", "Distance (km)", "Bearing", "Target ground", "Result", "Least clearance", "Extra target height to be seen", "Sample spacing"], rows);
    var btn = TB.$("showall");
    btn.hidden = rows.length <= 10;
    btn.textContent = showAll ? "Show fewer" : "Show all " + rows.length;
    TB.$("table").className = showAll ? "" : "scroll";
  }

  function svg(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function drawProfile() {
    var box = TB.$("profile");
    TB.clear(box);
    var i = Number(TB.$("profileSel").value), r = last && last.rows[i];
    if (!r || !r.result) return;
    var res = r.result, d = r.distM, g = res.adjustedGroundM, s = res.sightLineM;
    var W = 600, H = 230, L0 = 58, R0 = 12, T0 = 12, B0 = 34;
    var lo = Math.min.apply(null, g.concat(s)), hi = Math.max.apply(null, g.concat(s));
    if (hi - lo < 10) { hi += 5; lo -= 5; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var D = res.distanceM;
    var X = function (x) { return L0 + (W - L0 - R0) * x / D; };
    var Y = function (y) { return T0 + (H - T0 - B0) * (hi - y) / (hi - lo); };
    var fig = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "figure", role: "img",
      "aria-label": "Ground profile to target " + (i + 1) + ": " + (res.visible ? "visible" : "blocked") });
    var pts = d.map(function (x, j) { return X(x).toFixed(1) + "," + Y(g[j]).toFixed(1); });
    pts.push(X(D).toFixed(1) + "," + Y(lo).toFixed(1), X(0).toFixed(1) + "," + Y(lo).toFixed(1));
    fig.appendChild(svg("polygon", { points: pts.join(" "), class: "vs-ground" }));
    fig.appendChild(svg("line", { x1: X(0), y1: Y(s[0]), x2: X(D), y2: Y(s[s.length - 1]), class: "vs-sight " + (res.visible ? "ok" : "bad") }));
    fig.appendChild(svg("circle", { cx: X(0), cy: Y(s[0]), r: 4, class: "vs-end" }));
    fig.appendChild(svg("circle", { cx: X(D), cy: Y(s[s.length - 1]), r: 4, class: "vs-end" }));
    if (!res.visible) {
      var j = d.indexOf(res.obstructionAtM);
      if (j >= 0) fig.appendChild(svg("circle", { cx: X(d[j]), cy: Y(g[j]), r: 6, class: "vs-block" }));
    }
    fig.appendChild(svg("line", { x1: L0, y1: H - B0, x2: W - R0, y2: H - B0, class: "faint", stroke: "currentColor" }));
    fig.appendChild(svg("text", { x: L0 - 6, y: T0 + 10, "text-anchor": "end" }, TB.fix(hi, 0) + " m"));
    fig.appendChild(svg("text", { x: L0 - 6, y: H - B0, "text-anchor": "end" }, TB.fix(lo, 0) + " m"));
    fig.appendChild(svg("text", { x: L0, y: H - B0 + 18, "text-anchor": "start" }, "Observer"));
    fig.appendChild(svg("text", { x: W - R0, y: H - B0 + 18, "text-anchor": "end" }, TB.fix(D / 1000, 2) + " km, target"));
    box.appendChild(fig);
    box.appendChild(TB.el("p", { class: "small muted", text: "Ground heights lowered by the curvature drop for k = " +
      TB.fix(res.k, 2) + ", so the sight line is straight. Vertical scale is exaggerated." }));
  }

  function calculate() {
    if (busy) return;
    TB.message("msg", "");
    var o = readObserver(), st = settings();
    try {
      V.profilePoints({ lat: o.lat, lon: o.lon }, { lat: 0, lon: 0 }, 2);
      if (!(o.h >= 0)) throw new Error("Observer height must be zero or more.");
      if (!(st.samples >= 10 && st.samples <= 200 && Math.floor(st.samples) === st.samples)) throw new Error("Sample points must be a whole number from 10 to 200.");
      if (!(st.maxKm > 0)) throw new Error("The longest line must be more than 0 km.");
      if (!targets.length) throw new Error("Add at least one target.");
    } catch (e) { return TB.message("msg", e.message, "error"); }
    saveAll();
    drawObserver();
    summary(o, null, st.k);
    var rows = targets.map(function (t) {
      var dist = V.distanceM(o, t);
      var row = { target: { lat: t.lat, lon: t.lon, h: t.h }, distanceKm: dist / 1000, bearing: V.bearingDeg(o, t) };
      if (dist < 1) row.reason = "Same place as the observer";
      else if (dist / 1000 > st.maxKm) row.reason = "Farther than the longest line setting";
      else { row.points = V.profilePoints(o, t, st.samples); row.spacingM = dist / st.samples; }
      return row;
    });
    var all = [];
    rows.forEach(function (r) { if (r.points) all = all.concat(r.points); });
    if (!all.length) {
      last = { input: { observer: o, settings: st }, rows: rows };
      renderTable();
      return TB.message("msg", "No target is within the longest line setting.", "error");
    }
    busy = true;
    TB.message("msg", "Asking Open-Elevation for " + all.length + " ground heights…", "info");
    fetchHeights(all).then(function (heights) {
      var at = 0;
      rows.forEach(function (r, i) {
        if (!r.points) return;
        var h = heights.slice(at, at + r.points.length);
        at += r.points.length;
        r.distM = r.points.map(function (p) { return p.distM; });
        r.observerGround = h[0];
        r.targetGround = h[h.length - 1];
        r.result = V.lineOfSight({ distM: r.distM, groundM: h }, o.h, targets[i].h, { k: st.k });
        delete r.points;
      });
      last = { input: { observer: o, settings: st }, service: "Open-Elevation, " + API, rows: rows };
      TB.message("msg", "");
      clearLines();
      rows.forEach(function (r, i) {
        var t = targets[i];
        var colour = !r.result ? "#c08a00" : r.result.visible ? "#1f9d55" : "#d64545";
        targetMarker(t, colour);
        if (r.result) layers.push(L.polyline([[o.lat, o.lon], [t.lat, t.lon]],
          { color: colour, weight: 2, dashArray: r.result.visible ? null : "4 6" }).addTo(map));
      });
      summary(o, rows, st.k);
      showAll = false;
      renderTable();
      var sel = TB.$("profileSel");
      TB.clear(sel);
      rows.forEach(function (r, i) {
        if (r.result) sel.appendChild(TB.el("option", { value: String(i), text: "Target " + (i + 1) + " (" + (r.result.visible ? "visible" : "blocked") + ")" }));
      });
      TB.$("profileRow").hidden = !sel.options.length;
      drawProfile();
    }, function (e) {
      TB.message("msg", "Open-Elevation (api.open-elevation.com) could not supply the ground heights: " + e.message +
        ". The check needs them, so nothing was calculated. The service is free and sometimes busy: try again in a " +
        "minute, or with fewer sample points or targets.", "error");
    }).finally(function () { busy = false; });
  }

  function setPicking(on) {
    picking = on;
    TB.$("pick").textContent = on ? "Stop picking" : "Pick targets on the map";
    map.getContainer().style.cursor = on ? "crosshair" : "";
  }

  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      if (saved.observer) [["obsLat", "lat"], ["obsLon", "lon"], ["obsH", "h"]].forEach(function (p) { if (isFinite(saved.observer[p[1]])) TB.$(p[0]).value = saved.observer[p[1]]; });
      if (saved.settings) {
        if (isFinite(saved.settings.samples)) TB.$("samples").value = saved.settings.samples;
        if (isFinite(saved.settings.maxKm)) TB.$("maxKm").value = saved.settings.maxKm;
        if (saved.settings.k) TB.$("k").value = String(saved.settings.k);
        if (!TB.$("k").value) TB.$("k").selectedIndex = 0;
      }
    }
    var o = readObserver();
    map = L.map("map").setView([isFinite(o.lat) ? o.lat : 0, isFinite(o.lon) ? o.lon : 0], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);
    drawObserver();
    if (saved && Array.isArray(saved.targets)) {
      saved.targets.forEach(function (t) { try { addTarget(t.lat, t.lon, t.h); } catch (e) { /* skip a bad saved target */ } });
      TB.message("msg", "");
    }
    summary(o, null, settings().k);
    ["obsLat", "obsLon", "obsH"].forEach(function (id) { TB.$(id).addEventListener("change", function () { drawObserver(); saveAll(); }); });
    TB.$("add").addEventListener("click", function () {
      try { addTarget(TB.num("tgtLat"), TB.num("tgtLon"), isFinite(TB.num("tgtH")) ? TB.num("tgtH") : 0); }
      catch (e) { TB.message("msg", e.message, "error"); }
    });
    TB.$("pick").addEventListener("click", function () { setPicking(!picking); });
    map.on("click", function (e) {
      if (!picking) return;
      TB.$("tgtLat").value = e.latlng.lat.toFixed(6);
      TB.$("tgtLon").value = L.Util.wrapNum(e.latlng.lng, [-180, 180], true).toFixed(6);
      try { addTarget(TB.num("tgtLat"), TB.num("tgtLon"), isFinite(TB.num("tgtH")) ? TB.num("tgtH") : 0); }
      catch (err) { TB.message("msg", err.message, "error"); }
    });
    TB.$("clearTargets").addEventListener("click", function () {
      targets.forEach(function (t) { if (t.marker) map.removeLayer(t.marker); });
      targets = []; last = null; clearLines(); saveAll();
      TB.clear(TB.$("table")); TB.clear(TB.$("profile")); TB.$("profileRow").hidden = true; TB.$("showall").hidden = true;
      summary(readObserver(), null, settings().k);
    });
    TB.$("profileSel").addEventListener("change", drawProfile);
    TB.$("showall").addEventListener("click", function () { showAll = !showAll; if (last) renderTable(); });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); calculate(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
  });
})();
