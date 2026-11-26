/* Satellite Coverage Planner page. The maths is in ../lib/satellite-coverage.js (tested in
   tests/satellite-coverage.test.js), with windows found by ../lib/satellite-passes.js, look angles from
   ../lib/satellite-visibility.js and map tracks from ../lib/ground-track.js; satellite.js runs SGP4. Only map tiles
   are fetched. */
(function () {
  "use strict";
  var KEY = "satellite-coverage-planner";
  var S = DD.satelliteCoverage, P = DD.satellitePasses, V = DD.satelliteVisibility, G = DD.groundTrack, T = DD.tleAnalyzer;
  var EXAMPLE = "ISS (ZARYA)\n" +
    "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n" +
    "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";
  var MAP_WINDOWS = 30;
  var map = null, layers = [], last = null, showAll = false;

  function readElements() {
    var sets = T.splitSets(TB.$("tle").value);
    if (!sets.length) throw new Error("Paste an element set: line 1 starting '1 ' and line 2 starting '2 ', with an optional name line above.");
    return T.parse(sets[0].line1, sets[0].line2, sets[0].name);
  }
  function propagator(e) {
    if (!window.satellite) throw new Error("The orbit library (satellite.js) did not load, so windows cannot be worked out. Check the connection and reload.");
    var rec = satellite.twoline2satrec(e.line1, e.line2);
    if (rec.error) throw new Error("SGP4 cannot use this element set (error code " + rec.error + ").");
    return function (ms) {
      var pv = satellite.propagate(rec, new Date(ms));
      return pv && pv.position ? pv : null;
    };
  }
  function lookFn(prop, obs) {
    return function (ms) {
      var pv = prop(ms);
      if (!pv) return null;
      var la = V.lookAngles(obs, V.temeToEcef(pv.position, V.gmst(V.julianDate(ms))));
      return { elDeg: la.elDeg, azDeg: la.azDeg };
    };
  }
  function dur(s) {
    if (!isFinite(s)) return "–";
    if (s < 3600) return TB.fix(s / 60, 1) + " min";
    return TB.fix(s / 3600, 2) + " h";
  }

  function draw(target, circleDeg, prop, windows) {
    if (!map) return;
    layers.forEach(function (l) { map.removeLayer(l); });
    layers = [];
    if (circleDeg > 0) layers.push(L.polygon(S.circle(target.latDeg, target.lonDeg, circleDeg, 180),
      { color: "#0072B2", weight: 1.5, fillColor: "#0072B2", fillOpacity: 0.12 }).addTo(map));
    windows.slice(0, MAP_WINDOWS).forEach(function (w) {
      var pts = G.track(prop, w.riseMs, Math.max(1, (w.setMs - w.riseMs) / 1000), 15);
      G.splitAntimeridian(pts).forEach(function (ln) { layers.push(L.polyline(ln, { color: "#D55E00", weight: 3 }).addTo(map)); });
    });
    layers.push(L.circleMarker([target.latDeg, target.lonDeg], { radius: 6, color: "#ffffff", weight: 2, fillColor: "#000000", fillOpacity: 1 })
      .bindTooltip(TB.el("span", { text: "Target" })).addTo(map));
    var b = L.featureGroup(layers).getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [10, 10], maxZoom: 6 });
  }

  function list() {
    if (!last) return;
    var prevEnd = null;
    var rows = last.passes.map(function (p) {
      var gap = prevEnd === null ? "–" : dur((p.riseMs - prevEnd) / 1000);
      prevEnd = p.setMs;
      return [(p.startsInProgress ? "(already in view) " : "") + TB.time(p.riseMs, { seconds: true, weekday: true }),
        TB.time(p.setMs, { seconds: true }) + (p.endsInProgress ? " (still in view)" : ""),
        dur(p.durationS), TB.fix(p.peakElDeg, 1) + "°", gap];
    });
    TB.table("list", ["Window opens", "Window closes", "Length", "Highest elevation", "Gap before"], rows);
    TB.$("showAll").hidden = rows.length <= 10;
    TB.$("listWrap").className = "scroll" + (showAll ? " all" : "");
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all";
  }

  function run() {
    TB.message("msg", ""); TB.message("warn", "");
    try {
      var e = readElements();
      var input = { tle: TB.$("tle").value, lat: TB.num("lat"), lon: TB.num("lon"), height: TB.num("height") || 0,
        minEl: TB.num("minEl"), days: Number(TB.$("days").value), start: TB.$("start").value };
      if (!isFinite(input.lat) || !isFinite(input.lon)) throw new Error("Enter the target's latitude and longitude.");
      if (input.lat < -90 || input.lat > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
      if (input.lon < -180 || input.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
      if (!(input.minEl >= 0 && input.minEl <= 80)) throw new Error("The minimum elevation must be from 0 to 80 degrees.");
      var start = V.parseUtcInput(input.start);
      if (!isFinite(start)) throw new Error("Enter the start time in UTC.");
      var end = start + input.days * 86400000;
      var target = { latDeg: input.lat, lonDeg: input.lon, hKm: input.height / 1000 };
      var prop = propagator(e);
      var p0 = prop(start);
      if (!p0) throw new Error("SGP4 could not move this element set to the start time; the orbit may have decayed or the start is far from the epoch.");
      var h0 = G.subSatellitePoint(p0.position, start).hKm;
      var passes = P.findPasses(lookFn(prop, target), start, end, { stepS: 30, maskDeg: input.minEl, tolS: 0.1 });
      var st = S.stats(passes.map(function (p) { return { startMs: p.riseMs, endMs: p.setMs }; }), start, end);
      var geo = h0 > 0 ? S.geometry(h0, input.minEl) : null;
      TB.save(KEY, input);
      var warn = e.warnings.slice();
      var a0 = T.ageDays(e.epochMs, start), a1 = T.ageDays(e.epochMs, end);
      if (Math.max(Math.abs(a0), Math.abs(a1)) > 7) warn.push("Part of the period is more than 7 days from the element set's epoch (" +
        TB.fix(a0, 1) + " to " + TB.fix(a1, 1) + " days), so window times are rough.");
      if (e.eccentricity > 0.05) warn.push("This orbit is noticeably elliptical (eccentricity " + TB.fix(e.eccentricity, 3) +
        "), so the circle on the map is right only near the start; the windows use the true height throughout.");
      if (passes.length > MAP_WINDOWS) warn.push("The map shows the ground track for the first " + MAP_WINDOWS + " of " + passes.length + " windows.");
      TB.message("warn", warn.join(" "), "error");
      TB.results("summary", [
        { k: "Windows", v: String(st.count) },
        { k: "Covered time", v: dur(st.coveredS) },
        { k: "Share of the period covered", v: TB.fix(st.fraction * 100, 2), u: "%" },
        { k: "Longest gap", v: dur(st.longestGapS), title: "Counting the time before the first window and after the last" },
        { k: "Mean revisit time", v: dur(st.meanRevisitS), title: "Start of one window to the start of the next" },
        { k: "Mean window length", v: dur(st.meanWindowS) },
        { k: "Satellite height at start", v: TB.fix(h0, 0), u: "km" },
        { k: "Coverage circle radius", v: geo ? TB.fix(geo.radiusKm, 0) : "–", u: "km", title: "Along the surface, at the height at the start" },
        { k: "Slant range at the minimum elevation", v: geo ? TB.fix(geo.edgeSlantRangeKm, 0) : "–", u: "km" },
        { k: "From", v: TB.time(start, { year: true }) },
        { k: "To", v: TB.time(end, { year: true }) }
      ]);
      last = { input: input, satellite: { name: e.name, catalogNumber: e.catalogNumber, epochUtc: new Date(e.epochMs).toISOString() },
        passes: passes, stats: st, geometry: geo, heightKm: h0 };
      draw(target, geo ? geo.centralAngleDeg : 0, prop, passes);
      list();
    } catch (err) {
      TB.message("msg", err.message, "error");
    }
  }

  TB.ready(function () {
    if (window.L) {
      map = L.map("map", { worldCopyJump: false }).setView([38, -77], 3);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
      }).addTo(map);
    } else {
      TB.message("warn", "The map library (Leaflet) did not load; the windows are still listed below.", "error");
    }
    var saved = TB.load(KEY);
    if (saved) {
      if (typeof saved.tle === "string" && saved.tle.trim()) TB.$("tle").value = saved.tle;
      ["lat", "lon", "height", "minEl"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      if ([1, 3, 7].indexOf(saved.days) >= 0) TB.$("days").value = String(saved.days);
      if (typeof saved.start === "string") TB.$("start").value = saved.start;
    }
    if (!TB.$("tle").value.trim()) TB.$("tle").value = EXAMPLE;
    if (!isFinite(V.parseUtcInput(TB.$("start").value))) {
      // The example element set is from 2008, so start it at its own epoch; anything else starts now.
      var ex = EXAMPLE.split("\n");
      TB.$("start").value = V.toUtcInput(TB.$("tle").value === EXAMPLE ? T.parse(ex[1], ex[2]).epochMs : Date.now());
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("now").addEventListener("click", function () { TB.$("start").value = V.toUtcInput(Date.now()); run(); });
    TB.$("example").addEventListener("click", function () {
      TB.$("tle").value = EXAMPLE;
      var l = EXAMPLE.split("\n");
      TB.$("start").value = V.toUtcInput(T.parse(l[1], l[2]).epochMs);
      TB.$("days").value = "1";
      run();
    });
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; list(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Find windows first.", "info");
      TB.copyJSON({ input: last.input, satellite: last.satellite, heightAtStartKm: last.heightKm, coverageCircle: last.geometry,
        stats: { windows: last.stats.count, coveredS: last.stats.coveredS, fraction: last.stats.fraction, longestGapS: last.stats.longestGapS,
          meanRevisitS: last.stats.meanRevisitS, meanWindowS: last.stats.meanWindowS },
        windows: last.passes.map(function (p) {
          return { opensUtc: new Date(p.riseMs).toISOString(), closesUtc: new Date(p.setMs).toISOString(), lengthS: p.durationS,
            peakElDeg: p.peakElDeg, peakUtc: new Date(p.peakMs).toISOString(), startsInProgress: p.startsInProgress, endsInProgress: p.endsInProgress };
        }) }).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && TicTime.onChange) TicTime.onChange(function () { if (last) run(); });
    run();
  });
})();
