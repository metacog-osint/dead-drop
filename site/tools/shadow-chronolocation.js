/* Shadow Chronolocation page. The maths is in ../lib/shadow-chronolocation.js (tested in
   tests/shadow-chronolocation.test.js), which uses ../lib/sun-position.js for the Sun. */
(function () {
  "use strict";
  var KEY = "shadow-chronolocation";
  var C = DD.shadowChronolocation, S = DD.sunPosition;
  var last = null, showAll = { elev: false, az: false };

  function optNum(id) { var v = TB.num(id); return isFinite(v) ? v : null; }
  function deg(x, n) { return TB.fix(x, n === undefined ? 2 : n) + "°"; }
  function t(ms) { return TB.time(ms, { year: true, seconds: true }); }
  function sundial(ms, lon, eqt) {
    var m = C.apparentSolarMinutes(ms, lon, eqt), h = Math.floor(m / 60), mi = Math.floor(m - 60 * h);
    return (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi + " sundial";
  }
  function shift(x) {
    if (!x) return "–";
    var s = (x.shiftMin >= 0 ? "+" : "−") + TB.fix(Math.abs(x.shiftMin), 1) + " min";
    return x.capped ? "up to solar noon (" + s + ")" : s;
  }
  function shadowDir(sunAz) { return deg((sunAz + 180) % 360, 1); }

  function scrolled(id, head, rows, key) {
    TB.table(id, head, rows);
    var box = TB.$(id);
    box.className = showAll[key] ? "" : "scroll";
    if (rows.length > 10) {
      var b = TB.el("button", { type: "button", text: showAll[key] ? "Show fewer" : "Show all " + rows.length });
      b.addEventListener("click", function () { showAll[key] = !showAll[key]; render(); });
      box.appendChild(TB.el("div", { class: "actions" }, [b]));
    }
  }

  function render() {
    var L = last, r = L.result, inp = L.input, w = r.window;
    TB.$("day").textContent = "Local solar day of " + inp.date + " at this longitude: " + t(w.startMs) + " to " + t(w.endMs) + ".";
    var items = [];
    if (r.targetElevation !== undefined) {
      items.push({ k: "Sun's elevation from the shadow", v: deg(r.targetElevation), title: "atan(height / length)" });
      items.push({ k: "If the ratio is 5 % off", v: deg(r.elevation5pct.low) + " to " + deg(r.elevation5pct.high) });
    }
    if (r.sunAzimuth !== undefined) items.push({ k: "Sun's azimuth from the shadow", v: deg(r.sunAzimuth, 1) + " " + S.compass(r.sunAzimuth),
      title: "Shadow direction + 180°" });
    items.push({ k: "Solar noon", v: t(w.solarNoon) });
    items.push({ k: "Highest Sun that day", v: deg(r.maxElevation) });
    if (r.best) {
      items.push({ k: "Best match, length and direction", v: t(r.best.ms), cls: r.best.agrees ? "ok" : "warn",
        title: "The length's answer whose azimuth agrees best" });
      items.push({ k: "Azimuth off by", v: deg(Math.abs(r.best.azimuthResidual), 1), cls: r.best.agrees ? "ok" : "warn" });
      if (r.best.gapMin !== null) items.push({ k: "Direction alone gives a time", v: TB.fix(Math.abs(r.best.gapMin), 1), u: "min " +
        (r.best.gapMin >= 0 ? "later" : "earlier") });
    }
    TB.results("results", items);

    var notes = TB.$("notes");
    TB.clear(notes);
    r.notes.forEach(function (n) { notes.appendChild(TB.el("p", { class: "msg info", text: n })); });
    if (r.best && !r.best.agrees) notes.appendChild(TB.el("p", { class: "msg error", text: "The shadow's length and direction do not agree to within " +
      C.AGREE_DEG + "°. Check the date, the place, which way is north in the image, and whether the ground is level." }));

    var hasAz = r.sunAzimuth !== undefined;
    TB.$("elevHead").hidden = r.targetElevation === undefined;
    TB.$("elevNote").hidden = !r.elevationMatches.length;
    if (r.targetElevation !== undefined) {
      var head = ["Time (your setting)", "Side of noon", "Sun elevation", "Sun azimuth", "Shadow points", "Minutes per degree",
        "Ratio 5 % higher (shorter shadow)", "Ratio 5 % lower (longer shadow)", "Solar time"];
      if (hasAz) head.splice(5, 0, "Azimuth off by");
      var rows = r.elevationMatches.map(function (m) {
        var row = [t(m.ms), m.rising ? "Morning, Sun climbing" : "Afternoon, Sun sinking", deg(m.elevation), deg(m.azimuth, 1) + " " + S.compass(m.azimuth),
          shadowDir(m.azimuth), TB.fix(m.minPerDegree, 1), shift(m.ratioPlus5), shift(m.ratioMinus5), sundial(m.ms, inp.lon, m.eqTimeMin)];
        if (hasAz) row.splice(5, 0, deg(Math.abs(m.azimuthResidual), 1) + (r.best && r.best.ms === m.ms ? " (best)" : ""));
        return row;
      });
      scrolled("elevTable", head, rows, "elev");
    } else TB.clear(TB.$("elevTable"));

    TB.$("azHead").hidden = !hasAz;
    if (hasAz) {
      var headA = ["Time (your setting)", "Sun azimuth", "Sun elevation", "Shadow length per unit of height", "Minutes per degree of azimuth", "Solar time"];
      if (r.targetElevation !== undefined) headA.splice(3, 0, "Elevation off by");
      var rowsA = r.azimuthMatches.map(function (m) {
        var row = [t(m.ms), deg(m.azimuth, 1), deg(m.elevation), TB.fix(m.shadowPerHeight, 2), TB.fix(m.minPerDegree, 1), sundial(m.ms, inp.lon, m.eqTimeMin)];
        if (m.elevationResidual !== null) row.splice(3, 0, deg(Math.abs(m.elevationResidual)));
        return row;
      });
      scrolled("azTable", headA, rowsA, "az");
    } else TB.clear(TB.$("azTable"));
  }

  function run() {
    TB.message("msg", "");
    var input = { lat: TB.num("lat"), lon: TB.num("lon"), date: TB.$("date").value,
      heightM: optNum("h"), shadowM: optNum("L"), shadowAzimuth: optNum("az") };
    try {
      if (!isFinite(input.lat) || !isFinite(input.lon)) throw new Error("Enter the latitude and longitude.");
      var result = C.solve(input);
      last = { input: input, result: result };
      TB.save(KEY, input);
      render();
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }

  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      [["lat", "lat"], ["lon", "lon"], ["h", "heightM"], ["L", "shadowM"], ["az", "shadowAzimuth"]].forEach(function (p) {
        if (saved[p[1]] === null) TB.$(p[0]).value = "";
        else if (isFinite(saved[p[1]])) TB.$(p[0]).value = saved[p[1]];
      });
      if (/^\d{4}-\d{2}-\d{2}$/.test(saved.date || "")) TB.$("date").value = saved.date;
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && TicTime.onChange) TicTime.onChange(function () { if (last) render(); });
    run();
  });
})();
