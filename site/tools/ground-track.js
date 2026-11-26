/* Ground Track Plotter page. The maths is in ../lib/ground-track.js (tested in tests/ground-track.test.js) and the
   element set is read by ../lib/tle-analyzer.js; satellite.js runs SGP4. Only map tiles are fetched. */
(function () {
  "use strict";
  var KEY = "ground-track";
  var G = DD.groundTrack, T = DD.tleAnalyzer;
  var EXAMPLE = "ISS (ZARYA)\n" +
    "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n" +
    "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";
  var COLOUR = "#0f766e";
  var map = null, layers = [], last = null, showAll = false;

  function parseUtc(s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?$/.exec(String(s || "").trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN;
  }
  function toUtcInput(ms) { return new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19); }

  function readElements() {
    var sets = T.splitSets(TB.$("tle").value);
    if (!sets.length) throw new Error("Paste an element set: line 1 starting '1 ' and line 2 starting '2 ', with an optional name line above.");
    return T.parse(sets[0].line1, sets[0].line2, sets[0].name);
  }
  function propagator(e) {
    if (!window.satellite) throw new Error("The orbit library (satellite.js) did not load, so the track cannot be worked out. Check the connection and reload.");
    var rec = satellite.twoline2satrec(e.line1, e.line2);
    if (rec.error) throw new Error("SGP4 cannot use this element set (error code " + rec.error + ").");
    return function (ms) {
      var pv = satellite.propagate(rec, new Date(ms));
      return pv && pv.position ? pv : null;
    };
  }

  function clearMap() { layers.forEach(function (l) { map.removeLayer(l); }); layers = []; }

  function draw(points, name) {
    if (!map) return;
    clearMap();
    var lines = G.splitAntimeridian(points);
    lines.forEach(function (ln) { layers.push(L.polyline(ln, { color: COLOUR, weight: 2 }).addTo(map)); });
    var first = points.filter(function (p) { return p; })[0];
    if (first) {
      var pop = TB.el("div", null, [TB.el("strong", { text: name || "Satellite" }), TB.el("br"),
        "At the start, " + TB.time(first.ms, { seconds: true }), TB.el("br"),
        TB.fix(first.latDeg, 3) + "°, " + TB.fix(first.lonDeg, 3) + "°, " + TB.fix(first.hKm, 1) + " km up"]);
      var m = L.circleMarker([first.latDeg, first.lonDeg], { radius: 7, color: "#ffffff", weight: 2, fillColor: COLOUR, fillOpacity: 1 })
        .bindPopup(pop).addTo(map);
      layers.push(m);
    }
    if (layers.length > 1) {
      var b = L.featureGroup(layers).getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [10, 10], maxZoom: 5 });
    }
  }

  function listPoints() {
    if (!last) return;
    var rows = last.points.filter(function (p) { return p; }).map(function (p) {
      return [TB.time(p.ms, { seconds: true }), TB.fix(p.latDeg, 3) + "°", TB.fix(p.lonDeg, 3) + "°", TB.fix(p.hKm, 1) + " km"];
    });
    TB.table("points", ["Time", "Latitude", "Longitude", "Height"], rows);
    TB.$("showAll").hidden = rows.length <= 10;
    TB.$("pointWrap").className = "scroll" + (showAll ? " all" : "");
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all";
  }

  function run() {
    TB.message("msg", ""); TB.message("warn", "");
    try {
      var e = readElements();
      var input = { tle: TB.$("tle").value, start: TB.$("start").value, revs: TB.num("revs"), step: TB.num("step") };
      if (!(input.revs >= 0.1 && input.revs <= 15)) throw new Error("Orbits must be from 0.1 to 15.");
      if (!(input.step >= 5 && input.step <= 600)) throw new Error("The step must be from 5 to 600 seconds.");
      var start = parseUtc(input.start);
      if (!isFinite(start)) throw new Error("Enter the start time in UTC.");
      var period = G.periodMin(e.meanMotionRevDay);
      var duration = period * 60 * input.revs;
      var prop = propagator(e);
      var points = G.track(prop, start, duration, input.step, 20000);
      var s = G.summary(points);
      if (!s) throw new Error("SGP4 could not move this element set to any time in the span; the orbit may have decayed or the element set is far from its epoch.");
      TB.save(KEY, input);
      var warn = e.warnings.slice();
      var a0 = T.ageDays(e.epochMs, start), a1 = T.ageDays(e.epochMs, start + duration * 1000);
      if (Math.max(Math.abs(a0), Math.abs(a1)) > 7) warn.push("The span is " + TB.fix(a0, 1) + " to " + TB.fix(a1, 1) +
        " days from the element set's epoch, so the positions may be off by tens of kilometres or more; use a fresher element set.");
      var gaps = points.length - s.points;
      if (gaps) warn.push(gaps + " of " + points.length + " points could not be worked out (SGP4 failed there).");
      TB.message("warn", warn.join(" "), "error");
      TB.results("summary", [
        { k: "Satellite", v: (e.name || "Unnamed") + " (" + e.catalogNumber + ")" },
        { k: "Period", v: TB.fix(period, 2), u: "min" },
        { k: "Inclination", v: TB.fix(e.inclinationDeg, 2), u: "°", title: "Tilt of the orbit to the equator" },
        { k: "Westward shift per orbit", v: TB.fix(G.westwardShiftDeg(period), 2), u: "°", title: "The Earth's turn during one period" },
        { k: "Height range", v: TB.fix(s.minHKm, 0) + " to " + TB.fix(s.maxHKm, 0), u: "km", title: "Above the WGS 84 ellipsoid" },
        { k: "Latitude range", v: TB.fix(s.minLatDeg, 1) + "° to " + TB.fix(s.maxLatDeg, 1) + "°" },
        { k: "Element set age at start", v: TB.fix(a0, 1), u: "days" },
        { k: "From", v: TB.time(start, { year: true }) },
        { k: "To", v: TB.time(start + duration * 1000, { year: true }) }
      ]);
      last = { input: input, satellite: { name: e.name, catalogNumber: e.catalogNumber, epochUtc: new Date(e.epochMs).toISOString() },
        periodMin: period, points: points };
      draw(points, e.name);
      listPoints();
    } catch (err) {
      TB.message("msg", err.message, "error");
    }
  }

  TB.ready(function () {
    if (window.L) {
      map = L.map("map", { worldCopyJump: false }).setView([0, 0], 1);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
      }).addTo(map);
    } else {
      TB.message("warn", "The map library (Leaflet) did not load; the points are still listed below.", "error");
    }
    var saved = TB.load(KEY);
    if (saved) {
      if (typeof saved.tle === "string" && saved.tle.trim()) TB.$("tle").value = saved.tle;
      ["revs", "step"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      if (typeof saved.start === "string") TB.$("start").value = saved.start;
    }
    if (!TB.$("tle").value.trim()) TB.$("tle").value = EXAMPLE;
    if (!isFinite(parseUtc(TB.$("start").value))) {
      // The example element set is from 2008, so start it at its own epoch; anything else starts now.
      var ex = EXAMPLE.split("\n");
      TB.$("start").value = toUtcInput(TB.$("tle").value === EXAMPLE ? T.parse(ex[1], ex[2]).epochMs : Date.now());
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("now").addEventListener("click", function () { TB.$("start").value = toUtcInput(Date.now()); run(); });
    TB.$("example").addEventListener("click", function () {
      TB.$("tle").value = EXAMPLE;
      var l = EXAMPLE.split("\n");
      TB.$("start").value = toUtcInput(T.parse(l[1], l[2]).epochMs);
      run();
    });
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; listPoints(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Plot a track first.", "info");
      var out = { input: last.input, satellite: last.satellite, periodMin: last.periodMin,
        points: last.points.filter(function (p) { return p; }).map(function (p) {
          return { utc: new Date(p.ms).toISOString(), latDeg: p.latDeg, lonDeg: p.lonDeg, heightKm: p.hKm };
        }) };
      TB.copyJSON(out).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && TicTime.onChange) TicTime.onChange(function () { if (last) run(); });
    run();
  });
})();
