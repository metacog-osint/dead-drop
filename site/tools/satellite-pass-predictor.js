/* Satellite Pass Predictor page. The maths is in ../lib/satellite-passes.js, ../lib/satellite-visibility.js and
   ../lib/tle-analyzer.js (tested in tests/satellite-passes.test.js and the other two); satellite.js runs SGP4. */
(function () {
  "use strict";
  var KEY = "satellite-pass-predictor";
  var V = DD.satelliteVisibility, T = DD.tleAnalyzer, P = DD.satellitePasses;
  var EXAMPLE = "ISS (ZARYA)\n" +
    "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n" +
    "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";
  var last = null;

  function readElements() {
    var sets = T.splitSets(TB.$("tle").value);
    if (!sets.length) throw new Error("Paste an element set: line 1 starting '1 ' and line 2 starting '2 ', with an optional name line above.");
    return T.parse(sets[0].line1, sets[0].line2, sets[0].name);
  }
  function propagator(e) {
    if (!window.satellite) throw new Error("The orbit library (satellite.js) did not load, so passes cannot be worked out. Check the connection and reload.");
    var rec = satellite.twoline2satrec(e.line1, e.line2);
    if (rec.error) throw new Error("SGP4 cannot use this element set (error code " + rec.error + ").");
    return function (ms) {
      var pv = satellite.propagate(rec, new Date(ms));
      return pv && pv.position ? pv : null;
    };
  }
  function t(ms) { return TB.time(ms, { seconds: true }); }
  function dir(az) { return TB.fix(az, 0) + "° " + V.compass(az); }

  function run() {
    TB.message("msg", ""); TB.message("warn", "");
    try {
      var e = readElements();
      var input = { tle: TB.$("tle").value, lat: TB.num("lat"), lon: TB.num("lon"), height: TB.num("height") || 0,
        start: TB.$("start").value, days: Number(TB.$("days").value), mask: TB.num("mask") || 0,
        minPeak: TB.num("minPeak") || 0, eyeOnly: TB.$("eyeOnly").checked };
      if (!isFinite(input.lat) || !isFinite(input.lon)) throw new Error("Enter a latitude and a longitude.");
      if (input.lat < -90 || input.lat > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
      if (input.lon < -180 || input.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
      if (input.mask < 0 || input.mask > 45) throw new Error("The horizon mask must be between 0 and 45 degrees.");
      if (input.minPeak < 0 || input.minPeak > 90) throw new Error("The lowest peak must be between 0 and 90 degrees.");
      var start = V.parseUtcInput(input.start);
      if (!isFinite(start)) throw new Error("Enter the start time in UTC.");
      var end = start + input.days * 86400000;
      var obs = { latDeg: input.lat, lonDeg: input.lon, hKm: input.height / 1000 };
      var prop = propagator(e);
      var look = function (ms) { return V.observe(prop, ms, obs, { maskDeg: input.mask }); };
      var passes = P.findPasses(look, start, end, { stepS: 30, maskDeg: input.mask, minPeakDeg: input.minPeak });
      passes.forEach(function (p) { p.seen = P.visibleWindow(look, p, 30); });
      TB.save(KEY, input);
      var warn = e.warnings.slice();
      var a0 = T.ageDays(e.epochMs, start), a1 = T.ageDays(e.epochMs, end);
      if (Math.max(Math.abs(a0), Math.abs(a1)) > 7) warn.push("Part of the period is more than 7 days from the element set's epoch (" +
        TB.fix(a0, 1) + " to " + TB.fix(a1, 1) + " days), so times are rough.");
      if (look(start) === null) warn.push("SGP4 could not move this element set to the start time; the orbit may have decayed.");
      TB.message("warn", warn.join(" "), "error");

      var shown = input.eyeOnly ? passes.filter(function (p) { return p.seen; }) : passes;
      var seenCount = passes.filter(function (p) { return p.seen; }).length;
      var best = passes.reduce(function (m, p) { return Math.max(m, p.peakElDeg); }, -Infinity);
      TB.results("summary", [
        { k: "Passes found", v: String(passes.length) },
        { k: "Can be seen with the eye", v: String(seenCount), cls: seenCount ? "ok" : null },
        { k: "Highest peak", v: passes.length ? TB.fix(best, 1) : "–", u: "°" },
        { k: "From", v: TB.time(start, { year: true }) },
        { k: "To", v: TB.time(end, { year: true }) }
      ]);
      var rows = shown.map(function (p) {
        return [
          (p.startsInProgress ? "(already up) " : "") + TB.time(p.riseMs, { seconds: true, weekday: true }),
          dir(p.riseAzDeg),
          t(p.peakMs), TB.fix(p.peakElDeg, 1) + "°", dir(p.peakAzDeg),
          t(p.setMs) + (p.endsInProgress ? " (still up)" : ""), dir(p.setAzDeg),
          TB.fix(p.durationS / 60, 1) + " min",
          p.seen ? "Yes, " + TB.time(p.seen.firstMs, { date: false }) + " to " + TB.time(p.seen.lastMs, { date: false }) : "No"
        ];
      });
      TB.table("passes", ["Rise", "Rise direction", "Highest", "Peak elevation", "Peak direction", "Set", "Set direction",
        "Duration", "Seen by eye"], rows);
      TB.$("showAll").hidden = rows.length <= 10;
      TB.$("passWrap").style.maxHeight = "";
      TB.$("showAll").textContent = "Show all";
      last = { input: input, satellite: { name: e.name, catalogNumber: e.catalogNumber, epochMs: e.epochMs },
        passes: passes.map(function (p) {
          return { riseUtc: new Date(p.riseMs).toISOString(), riseAzDeg: p.riseAzDeg, peakUtc: new Date(p.peakMs).toISOString(),
            peakElDeg: p.peakElDeg, peakAzDeg: p.peakAzDeg, setUtc: new Date(p.setMs).toISOString(), setAzDeg: p.setAzDeg,
            durationS: p.durationS, startsInProgress: p.startsInProgress, endsInProgress: p.endsInProgress,
            seenByEye: p.seen ? { fromUtc: new Date(p.seen.firstMs).toISOString(), toUtc: new Date(p.seen.lastMs).toISOString() } : null };
        }) };
    } catch (err) {
      TB.message("msg", err.message, "error");
    }
  }

  TB.ready(function () {
    var sel = TB.$("site");
    V.SITES.forEach(function (s, i) { sel.appendChild(TB.el("option", { value: String(i), text: s.name })); });
    sel.addEventListener("change", function () {
      var s = V.SITES[Number(sel.value)];
      if (sel.value !== "" && s) { TB.$("lat").value = s.lat; TB.$("lon").value = s.lon; }
    });
    var saved = TB.load(KEY);
    if (saved) {
      if (typeof saved.tle === "string" && saved.tle.trim()) TB.$("tle").value = saved.tle;
      ["lat", "lon", "height", "mask", "minPeak"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      if ([1, 3, 7, 14].indexOf(saved.days) >= 0) TB.$("days").value = String(saved.days);
      if (typeof saved.start === "string") TB.$("start").value = saved.start;
      TB.$("eyeOnly").checked = !!saved.eyeOnly;
    }
    if (!TB.$("tle").value.trim()) TB.$("tle").value = EXAMPLE;
    if (!isFinite(V.parseUtcInput(TB.$("start").value))) TB.$("start").value = V.toUtcInput(Date.now());
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("now").addEventListener("click", function () { TB.$("start").value = V.toUtcInput(Date.now()); run(); });
    TB.$("example").addEventListener("click", function () {
      TB.$("tle").value = EXAMPLE;
      TB.$("start").value = V.toUtcInput(T.parse(EXAMPLE.split("\n")[1], EXAMPLE.split("\n")[2]).epochMs);
      TB.$("days").value = "1";
      run();
    });
    TB.$("showAll").addEventListener("click", function () {
      var w = TB.$("passWrap"), all = w.style.maxHeight === "none";
      w.style.maxHeight = all ? "" : "none";
      TB.$("showAll").textContent = all ? "Show all" : "Show fewer";
    });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Find passes first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
