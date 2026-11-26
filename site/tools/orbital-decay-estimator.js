/* Orbital Decay Estimator page. The maths is in ../lib/orbital-decay.js (tested in tests/orbital-decay.test.js). */
(function () {
  "use strict";
  var KEY = "orbital-decay";
  var NUMS = ["perigee", "apogee", "inclination", "mass", "area", "cd"];
  var PRESETS = {
    cubesat: { mass: 4, area: 0.03, cd: 2.2 },
    smallsat: { mass: 100, area: 1, cd: 2.2 },
    station: { mass: 420000, area: 1700, cd: 2.2 }
  };
  var DAY = 86400000;
  var last = null, allRows = [], showingAll = false;

  function lifeText(r) {
    if (!r.reentered) return { v: "more than " + r.beyondYears, u: "years" };
    var d = r.lifetimeDays;
    if (d < 1) return { v: TB.fix(d * 24, 1), u: "hours" };
    if (d < 730) return { v: TB.fix(d, 0), u: "days" };
    return { v: TB.fix(d / 365.25, 1), u: "years" };
  }
  // Dates only (the estimate is far too rough for a time of day), in the viewer's zone, which is named.
  function zone() { return window.TicTime && window.TicTime.zoneLabel ? window.TicTime.zoneLabel() : "UTC"; }
  function day(d) { return TB.time(d, { year: true, time: false }); }
  function dateText(r, start) {
    if (!r.reentered) return "after " + day(new Date(start.getTime() + r.beyondYears * 365.25 * DAY)) + " (" + zone() + ")";
    return day(new Date(start.getTime() + r.lifetimeDays * DAY)) + " (" + zone() + ")";
  }
  function renderProfile() {
    var rows = showingAll ? allRows : allRows.slice(0, 10);
    TB.table("profile", ["Time from start", "Date (" + zone() + ")", "Mean altitude (km)", "Perigee (km)", "Apogee (km)", "Period (min)"], rows);
    var btn = TB.$("showAll");
    btn.hidden = allRows.length <= 10;
    btn.textContent = showingAll ? "Show the first 10" : "Show all " + allRows.length + " rows";
  }
  function run() {
    TB.message("msg", "");
    var input = {};
    NUMS.forEach(function (k) { input[k] = TB.num(k); });
    input.startUtc = TB.$("start").value;
    try {
      var s = input.startUtc || "";
      var start = new Date(s.length === 16 ? s + ":00Z" : s + "Z");
      if (isNaN(start.getTime())) throw new Error("Enter a valid start date and time (UTC).");
      var p = { perigeeKm: input.perigee, apogeeKm: input.apogee, inclinationDeg: input.inclination,
        massKg: input.mass, areaM2: input.area, cd: input.cd };
      var O = DD.orbitalDecay;
      var mid = O.estimate(p);
      var dense = O.estimate(Object.assign({}, p, { densityScale: 2 }));
      var thin = O.estimate(Object.assign({}, p, { densityScale: 0.5 }));
      last = { input: input, startUtc: start.toISOString(), tableDensity: mid, densityDoubled: dense, densityHalved: thin };
      TB.save(KEY, input);
      var l = lifeText(mid), ld = lifeText(dense), lt = lifeText(thin);
      TB.results("results", [
        { k: "Lifetime, table density (rough)", v: l.v, u: l.u, cls: "warn" },
        { k: "Re-entry around", v: dateText(mid, start) },
        { k: "If the air is twice as dense (busier Sun)", v: ld.v, u: ld.u, title: "Re-entry " + dateText(dense, start) },
        { k: "If the air is half as dense (quieter Sun)", v: lt.v, u: lt.u, title: "Re-entry " + dateText(thin, start) },
        { k: "Height lost per day now (mean altitude)", v: TB.fix(-mid.initialDecay.daKmPerDay * 1000, 1), u: "m/day" },
        { k: "Perigee lost per day now", v: TB.fix(-mid.initialDecay.perigeeKmPerDay * 1000, 1), u: "m/day" },
        { k: "Ballistic coefficient B", v: TB.fix(mid.ballisticCoefficient, 1), u: "kg/m²" },
        { k: "Air density at perigee (table)", v: mid.densityAtPerigee.toExponential(2), u: "kg/m³" },
        { k: "Orbital period", v: TB.fix(mid.periodMin, 2), u: "min" },
        { k: "Semi-major axis", v: TB.fix(mid.semiMajorAxisKm, 1), u: "km" },
        { k: "Eccentricity", v: TB.fix(mid.eccentricity, 5) }
      ]);
      allRows = mid.profile.map(function (x) {
        var t = x.tDays < 730 ? TB.fix(x.tDays, 1) + " days" : TB.fix(x.tDays / 365.25, 2) + " years";
        return [t, day(new Date(start.getTime() + x.tDays * DAY)),
          TB.fix(x.meanAltKm, 0), TB.fix(x.perigeeKm, 0), TB.fix(x.apogeeKm, 0), TB.fix(x.periodMin, 2)];
      });
      if (!mid.reentered) allRows[allRows.length - 1][0] += " (estimate stops here)";
      renderProfile();
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      NUMS.forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
      if (typeof saved.startUtc === "string" && saved.startUtc) TB.$("start").value = saved.startUtc;
    }
    if (!TB.$("start").value) TB.$("start").value = new Date().toISOString().slice(0, 16);
    TB.$("preset").addEventListener("change", function () {
      var pr = PRESETS[this.value];
      if (!pr) return;
      TB.$("mass").value = pr.mass; TB.$("area").value = pr.area; TB.$("cd").value = pr.cd;
    });
    TB.$("showAll").addEventListener("click", function () { showingAll = !showingAll; renderProfile(); });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); showingAll = false; run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Estimate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
