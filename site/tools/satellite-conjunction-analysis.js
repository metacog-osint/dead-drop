/* Satellite Conjunction Analysis page. The maths is in ../lib/conjunction.js (tested in tests/conjunction.test.js);
   element sets are read by ../lib/tle-analyzer.js and satellite.js runs SGP4. No network requests. */
(function () {
  "use strict";
  var KEY = "satellite-conjunction-analysis";
  var C = DD.conjunction, T = DD.tleAnalyzer;
  var last = null, showAll = false;

  function parseUtc(s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?$/.exec(String(s || "").trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN;
  }
  function toUtcInput(ms) { return new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19); }

  function readElements(id, label) {
    var sets = T.splitSets(TB.$(id).value);
    if (!sets.length) throw new Error("Paste an element set for object " + label + ": line 1 starting '1 ' and line 2 starting '2 '.");
    try { return T.parse(sets[0].line1, sets[0].line2, sets[0].name); }
    catch (e) { throw new Error("Object " + label + ": " + e.message); }
  }
  function propagator(e, label) {
    var rec = satellite.twoline2satrec(e.line1, e.line2);
    if (rec.error) throw new Error("SGP4 cannot use object " + label + "'s element set (error code " + rec.error + ").");
    return function (ms) {
      var pv = satellite.propagate(rec, new Date(ms));
      return pv && pv.position ? pv : null;
    };
  }
  function label(e) { return (e.name || "Unnamed") + " (" + e.catalogNumber + ")"; }

  function list() {
    if (!last) return;
    var rows = last.result.approaches.filter(function (a) { return !last.input.insideOnly || a.inside; }).map(function (a) {
      return [TB.time(a.ms, { seconds: true, year: true }), TB.fix(a.missKm, 3) + " km", a.inside ? "Yes" : "No",
        TB.fix(a.relSpeedKmS, 3) + " km/s", TB.fix(a.approachAngleDeg, 1) + "°",
        TB.fix(a.radialKm, 2), TB.fix(a.alongTrackKm, 2), TB.fix(a.crossTrackKm, 2)];
    });
    TB.table("list", ["Time of closest approach", "Miss distance", "Inside screening distance", "Relative speed",
      "Angle between paths", "Radial (km)", "Along-track (km)", "Cross-track (km)"], rows);
    TB.$("showAll").hidden = rows.length <= 10;
    TB.$("listWrap").className = "scroll" + (showAll ? " all" : "");
    TB.$("showAll").textContent = showAll ? "Show fewer" : "Show all";
  }

  function run() {
    TB.message("msg", ""); TB.message("warn", "");
    try {
      if (!window.satellite) throw new Error("The orbit library (satellite.js) did not load, so nothing can be screened. Check the connection and reload.");
      var a = readElements("tleA", "A"), b = readElements("tleB", "B");
      if (a.catalogNumber === b.catalogNumber) throw new Error("Both element sets are for catalog number " + a.catalogNumber + "; give two different objects.");
      var input = { tleA: TB.$("tleA").value, tleB: TB.$("tleB").value, start: TB.$("start").value, hours: TB.num("hours"),
        threshold: TB.num("threshold"), step: TB.num("step"), insideOnly: TB.$("insideOnly").checked };
      if (!(input.hours >= 0.1 && input.hours <= 168)) throw new Error("The window must be from 0.1 to 168 hours.");
      if (!(input.threshold >= 0 && input.threshold <= 1000)) throw new Error("The screening distance must be from 0 to 1,000 km.");
      if (!(input.step >= 5 && input.step <= 300)) throw new Error("The search step must be from 5 to 300 seconds.");
      var start = parseUtc(input.start);
      if (!isFinite(start)) throw new Error("Enter the start time in UTC.");
      var end = start + input.hours * 3600000;
      var r = C.closeApproaches(propagator(a, "A"), propagator(b, "B"), start, end,
        { stepS: input.step, thresholdKm: input.threshold, tolS: 0.001 });
      TB.save(KEY, input);
      var warn = [];
      a.warnings.forEach(function (w) { warn.push("Object A: " + w); });
      b.warnings.forEach(function (w) { warn.push("Object B: " + w); });
      [[a, "A"], [b, "B"]].forEach(function (x) {
        var d0 = T.ageDays(x[0].epochMs, start), d1 = T.ageDays(x[0].epochMs, end);
        var worst = Math.max(Math.abs(d0), Math.abs(d1));
        if (worst > 3) warn.push("Object " + x[1] + "'s element set is up to " + TB.fix(worst, 1) +
          " days from its epoch in this window, so its position may be off by several kilometres or more.");
      });
      if (r.failedSamples) warn.push("SGP4 failed at " + r.failedSamples + " of " + r.samples + " sample times; an orbit may have decayed.");
      r.edges.forEach(function (e) {
        if (!r.closest || e.missKm < r.closest.missKm) warn.push((e.atStart ? "At the window's start the two are " + TB.fix(e.missKm, 1) +
          " km apart and moving apart, so a closer approach came just before the window." : "At the window's end the two are " +
          TB.fix(e.missKm, 1) + " km apart and still closing, so a closer approach comes just after it.") + " Move the window to see it.");
      });
      TB.message("warn", warn.join(" "), "error");
      var inside = r.approaches.filter(function (x) { return x.inside; }).length;
      var c = r.closest;
      TB.results("summary", [
        { k: "Object A", v: label(a) },
        { k: "Object B", v: label(b) },
        { k: "Closest miss distance", v: c ? TB.fix(c.missKm, 3) : "–", u: "km", cls: c && c.inside ? "warn" : null,
          title: "Screening figure; kilometre-level error" },
        { k: "Time of closest approach", v: c ? TB.time(c.ms, { seconds: true, year: true }) : "None in the window" },
        { k: "Relative speed then", v: c ? TB.fix(c.relSpeedKmS, 3) : "–", u: "km/s" },
        { k: "Approaches inside " + TB.fix(input.threshold, 1) + " km", v: String(inside), cls: inside ? "warn" : "ok" },
        { k: "Closest approaches in the window", v: String(r.approaches.length) },
        { k: "From", v: TB.time(start, { year: true }) },
        { k: "To", v: TB.time(end, { year: true }) }
      ]);
      last = { input: input, a: a, b: b, result: r };
      list();
    } catch (err) {
      TB.message("msg", err.message, "error");
    }
  }

  function json() {
    var conv = function (x) {
      return { tcaUtc: new Date(x.ms).toISOString(), missKm: x.missKm, insideScreeningDistance: x.inside, relSpeedKmS: x.relSpeedKmS,
        approachAngleDeg: x.approachAngleDeg, radialKm: x.radialKm, alongTrackKm: x.alongTrackKm, crossTrackKm: x.crossTrackKm };
    };
    var obj = function (e) { return { name: e.name, catalogNumber: e.catalogNumber, epochUtc: new Date(e.epochMs).toISOString() }; };
    return { note: "Miss distances from element sets (SGP4) are screening figures with kilometre-level error, not collision probabilities.",
      input: last.input, objectA: obj(last.a), objectB: obj(last.b),
      closest: last.result.closest ? conv(last.result.closest) : null, approaches: last.result.approaches.map(conv),
      windowEdges: last.result.edges.map(function (e) { return { atStart: e.atStart, utc: new Date(e.ms).toISOString(), separationKm: e.missKm }; }) };
  }

  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      ["tleA", "tleB", "start"].forEach(function (k) { if (typeof saved[k] === "string") TB.$(k).value = saved[k]; });
      ["hours", "threshold", "step"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      TB.$("insideOnly").checked = !!saved.insideOnly;
    }
    if (!isFinite(parseUtc(TB.$("start").value))) TB.$("start").value = toUtcInput(Date.now());
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("now").addEventListener("click", function () { TB.$("start").value = toUtcInput(Date.now()); run(); });
    TB.$("insideOnly").addEventListener("change", function () { if (last) { last.input.insideOnly = TB.$("insideOnly").checked; list(); } });
    TB.$("showAll").addEventListener("click", function () { showAll = !showAll; list(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Screen a pair first.", "info");
      TB.copyJSON(json()).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && TicTime.onChange) TicTime.onChange(function () { if (last) run(); });
    if (TB.$("tleA").value.trim() && TB.$("tleB").value.trim()) run();
    else TB.message("msg", "Paste two element sets, then Screen.", "info");
  });
})();
