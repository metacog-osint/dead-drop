/* Multi-Satellite Tracker page. The maths is in ../lib/multi-satellite.js and ../lib/ground-track.js (tested in
   tests/multi-satellite.test.js and tests/ground-track.test.js); element sets are read by ../lib/tle-analyzer.js and
   satellite.js runs SGP4. Network: map tiles, and CelesTrak lookups the user starts. */
(function () {
  "use strict";
  var KEY = "multi-satellite-tracker";
  var M = DD.multiSatellite, T = DD.tleAnalyzer;
  var TICK_MS = 5000, CACHE_MS = 2 * 3600 * 1000, OLD_DAYS = 7;
  var map = null, sats = [], timer = null, paused = false, showAll = false, busy = false, cache = {}, lastSnap = null;

  function propagator(e) {
    var rec = satellite.twoline2satrec(e.line1, e.line2);
    if (rec.error) throw new Error("SGP4 cannot use the element set for " + (e.name || e.catalogNumber) + " (error code " + rec.error + ").");
    return function (ms) {
      var pv = satellite.propagate(rec, new Date(ms));
      return pv && pv.position ? pv : null;
    };
  }

  function persist() {
    TB.save(KEY, { sets: sats.map(function (s) { return { name: s.e.name, line1: s.e.line1, line2: s.e.line2 }; }),
      back: TB.num("back"), ahead: TB.num("ahead") });
  }

  function removeLayers(s) { (s.layers || []).forEach(function (l) { map.removeLayer(l); }); s.layers = []; }

  /** Adds parsed element sets; returns a sentence saying what happened. */
  function addParsed(list) {
    if (!window.satellite) throw new Error("The orbit library (satellite.js) did not load, so positions cannot be worked out. Check the connection and reload.");
    var ok = [], bad = [];
    list.forEach(function (e) {
      try { ok.push({ e: e, prop: propagator(e) }); } catch (err) { bad.push(err.message); }
    });
    var r = M.merge(sats.map(function (s) { return s.e; }), ok.map(function (o) { return o.e; }));
    var pool = sats.concat(ok);
    var next = r.list.map(function (e) {
      for (var k = 0; k < pool.length; k++) if (pool[k].e === e) return pool[k];
      return null;
    }).filter(function (s) { return s; });
    sats.forEach(function (s) { if (next.indexOf(s) < 0 && map) removeLayers(s); });
    sats = next;
    persist();
    tick();
    var parts = [];
    if (r.added) parts.push(r.added + " added");
    if (r.replaced) parts.push(r.replaced + " replaced by a newer element set");
    if (r.skipped) parts.push(r.skipped + " already tracked with an element set as new or newer");
    return (parts.join(", ") || "Nothing added") + "." + (bad.length ? " " + bad.join(" ") : "");
  }

  function addPasted() {
    TB.message("msg", "");
    try {
      var sets = T.splitSets(TB.$("tle").value);
      if (!sets.length) throw new Error("Paste at least one element set: line 1 starting '1 ' and line 2 starting '2 '.");
      var parsed = [], problems = [];
      sets.forEach(function (s) {
        try {
          var e = T.parse(s.line1, s.line2, s.name);
          if (e.warnings.length) problems.push((e.name || e.catalogNumber) + ": " + e.warnings.join(" "));
          parsed.push(e);
        } catch (err) { problems.push(err.message); }
      });
      var said = addParsed(parsed);
      TB.message("msg", said + (problems.length ? " " + problems.join(" ") : ""), problems.length ? "error" : "info");
      if (parsed.length) TB.$("tle").value = "";
    } catch (err) { TB.message("msg", err.message, "error"); }
  }

  function lookup(catnr) {
    if (busy) return;
    var q = String(catnr || "").trim();
    if (!/^\d{1,9}$/.test(q)) return TB.message("fetchMsg", "A catalog number is digits only, for example 25544.", "error");
    var hit = cache[q];
    if (hit && Date.now() - hit.at < CACHE_MS) return useText(hit.text, "Reused CelesTrak's answer from " + TB.time(hit.at) + ".");
    busy = true;
    TB.message("fetchMsg", "Asking CelesTrak…", "info");
    fetch("https://celestrak.org/NORAD/elements/gp.php?CATNR=" + encodeURIComponent(q) + "&FORMAT=TLE", { credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error("CelesTrak answered HTTP " + r.status + "."); return r.text(); })
      .then(function (text) {
        if (!T.splitSets(text).length) throw new Error(/No GP data found/i.test(text) ? "CelesTrak has no element set for catalog number " + q + "." : "CelesTrak's answer held no element set.");
        cache[q] = { at: Date.now(), text: text };
        useText(text, "CelesTrak answered at " + TB.time(Date.now()) + ".");
      })
      .catch(function (err) {
        TB.message("fetchMsg", "Lookup failed: " + (err && err.message ? err.message : "no answer") + " Check the connection, or paste an element set instead.", "error");
      })
      .then(function () { busy = false; });
  }
  function useText(text, note) {
    try {
      var parsed = T.splitSets(text).map(function (s) { return T.parse(s.line1, s.line2, s.name); });
      TB.message("fetchMsg", note + " " + addParsed(parsed), "info");
    } catch (err) { TB.message("fetchMsg", err.message, "error"); }
  }

  function remove(cat) {
    sats = sats.filter(function (s) { if (s.e.catalogNumber === cat) { if (map) removeLayers(s); return false; } return true; });
    persist(); tick();
  }

  function tick() {
    var now = Date.now();
    var back = TB.num("back"), ahead = TB.num("ahead");
    if (!(back >= 0 && back <= 180)) back = 60;
    if (!(ahead >= 0 && ahead <= 180)) ahead = 30;
    var snap = [];
    var warn = [];
    sats.forEach(function (s, i) {
      var c = M.colour(i);
      var p = M.position(s.prop, now);
      s.pos = p;
      var age = T.ageDays(s.e.epochMs, now);
      snap.push({ name: s.e.name, catalogNumber: s.e.catalogNumber, epochUtc: new Date(s.e.epochMs).toISOString(), ageDays: age,
        utc: new Date(now).toISOString(), latDeg: p ? p.latDeg : null, lonDeg: p ? p.lonDeg : null, heightKm: p ? p.hKm : null,
        speedKmS: p ? p.speedKmS : null, groundSpeedKmS: p ? p.groundSpeedKmS : null });
      if (!p) warn.push((s.e.name || s.e.catalogNumber) + ": SGP4 could not move this element set to now; the orbit may have decayed.");
      if (!map) return;
      removeLayers(s);
      if (!p) return;
      var tr = M.trail(s.prop, now, back, ahead, 60);
      tr.past.forEach(function (ln) { s.layers.push(L.polyline(ln, { color: c, weight: 2, opacity: 0.8 }).addTo(map)); });
      tr.ahead.forEach(function (ln) { s.layers.push(L.polyline(ln, { color: c, weight: 2, opacity: 0.8, dashArray: "6 6" }).addTo(map)); });
      var mk = L.circleMarker([p.latDeg, p.lonDeg], { radius: 6, color: "#ffffff", weight: 2, fillColor: c, fillOpacity: 1 })
        .bindTooltip(TB.el("span", { text: s.e.name || String(s.e.catalogNumber) }))
        .addTo(map);
      s.layers.push(mk);
    });
    lastSnap = snap;
    TB.message("warn", warn.join(" "), "error");
    TB.$("updated").textContent = sats.length ? "Positions at " + TB.time(now, { seconds: true }) + (paused ? " (paused)." : ", moving every 5 seconds.") : "";
    list(now);
  }

  function list(now) {
    var rows = sats.map(function (s, i) {
      var sw = TB.el("span", { class: "mst-swatch" }); sw.style.background = M.colour(i);
      var name = TB.el("button", { type: "button", class: "mst-link", text: s.e.name || "Unnamed" });
      name.addEventListener("click", function () { if (map && s.pos) map.setView([s.pos.latDeg, s.pos.lonDeg], 4); });
      var rm = TB.el("button", { type: "button", text: "Remove" });
      rm.addEventListener("click", function () { remove(s.e.catalogNumber); });
      var age = T.ageDays(s.e.epochMs, now), p = s.pos;
      return [TB.el("span", null, [sw, name]), String(s.e.catalogNumber),
        p ? TB.fix(p.latDeg, 2) + "°" : "–", p ? TB.fix(p.lonDeg, 2) + "°" : "–", p ? TB.fix(p.hKm, 0) + " km" : "–",
        p ? TB.fix(p.groundSpeedKmS, 2) + " km/s" : "–",
        TB.fix(age, 1) + " days" + (Math.abs(age) > OLD_DAYS ? " (old)" : ""), rm];
    });
    TB.table("list", ["Satellite", "Catalog", "Latitude", "Longitude", "Height", "Ground speed", "Element set age", ""], rows);
    TB.$("showAll").hidden = rows.length <= 10;
    TB.$("listWrap").className = "scroll" + (showAll ? " all" : "");
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all";
  }

  function setPaused(on) {
    paused = on;
    TB.$("pause").setAttribute("aria-pressed", on ? "true" : "false");
    TB.$("pause").textContent = on ? "Resume updates" : "Pause updates";
    if (timer) { clearInterval(timer); timer = null; }
    if (!on) timer = setInterval(tick, TICK_MS);
    tick();
  }

  TB.ready(function () {
    if (window.L) {
      map = L.map("map", { worldCopyJump: false }).setView([20, 0], 1);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
      }).addTo(map);
    } else {
      TB.message("warn", "The map library (Leaflet) did not load; positions are still listed below.", "error");
    }
    var bar = TB.$("presets");
    M.PRESETS.forEach(function (p) {
      var b = TB.el("button", { type: "button", text: p.label, title: "Look up catalog number " + p.catalogNumber + " on CelesTrak" });
      b.addEventListener("click", function () { lookup(p.catalogNumber); });
      bar.appendChild(b);
    });
    var saved = TB.load(KEY);
    if (saved) {
      ["back", "ahead"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      if (Array.isArray(saved.sets) && saved.sets.length && window.satellite) {
        var parsed = [];
        saved.sets.forEach(function (s) { try { parsed.push(T.parse(s.line1, s.line2, s.name)); } catch (e) { /* skip a bad saved set */ } });
        try { addParsed(parsed); } catch (e) { TB.message("msg", e.message, "error"); }
      }
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); addPasted(); });
    TB.$("lookup").addEventListener("click", function () { lookup(TB.$("catnr").value); });
    TB.$("catnr").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); lookup(TB.$("catnr").value); } });
    ["back", "ahead"].forEach(function (k) { TB.$(k).addEventListener("change", function () { persist(); tick(); }); });
    TB.$("pause").addEventListener("click", function () { setPaused(!paused); });
    TB.$("clear").addEventListener("click", function () {
      if (map) sats.forEach(removeLayers);
      sats = []; persist(); tick();
    });
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; list(Date.now()); });
    TB.$("copy").addEventListener("click", function () {
      if (!lastSnap || !lastSnap.length) return TB.message("msg", "Add a satellite first.", "info");
      TB.copyJSON({ satellites: lastSnap }).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && TicTime.onChange) TicTime.onChange(tick);
    setPaused(false);
  });
})();
