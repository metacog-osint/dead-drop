/* Launch Window Calculator page. The maths is in ../lib/launch-window.js (tested in tests/launch-window.test.js). */
(function () {
  "use strict";
  var KEY = "launch-window";
  var FIELDS = ["lat", "lon", "inc", "alt", "mode", "raan", "epoch", "ltan", "start", "days"];
  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  var last = null, showAll = false;

  function compass(az) { return COMPASS[Math.round(az / 22.5) % 16]; }
  // datetime-local inputs carry no zone; this page reads and writes them as UTC.
  function readUtc(id) {
    var v = String(TB.$(id).value || "").trim();
    if (!v) return new Date(NaN);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) v += ":00";
    return new Date(v + "Z");
  }
  function utcInputValue(d) { return d.toISOString().slice(0, 19); }
  function parseHhmm(s) {
    var m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s || ""));
    if (!m || Number(m[2]) > 59) return NaN;
    return Number(m[1]) + Number(m[2]) / 60;
  }
  function hours(deg) {
    var h = deg / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.round(((h - hh) * 60 - mm) * 60);
    if (ss === 60) { ss = 0; mm += 1; }
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    return hh + "h " + (mm < 10 ? "0" : "") + mm + "m " + (ss < 10 ? "0" : "") + ss + "s";
  }

  function showMode() {
    var ltan = TB.$("mode").value === "ltan";
    TB.$("raan-fields").hidden = ltan;
    TB.$("ltan-fields").hidden = !ltan;
  }

  function render() {
    if (!last) return;
    var r = last.result, w = r.windows;
    var rows = w.map(function (x) {
      return [TB.time(x.time, { year: true, weekday: true, seconds: true }),
        x.pass === "north" ? "North-going" : "South-going",
        TB.fix(x.azimuthDeg, 2) + "° " + compass(x.azimuthDeg),
        hours(x.lstDeg) + " (" + TB.fix(x.lstDeg, 3) + "°)",
        TB.fix(x.raanDeg, 3) + "°"];
    });
    TB.table("table", ["Time", "Pass", "Launch azimuth (inertial)", "Local sidereal time", "RAAN then"], rows);
    var btn = TB.$("showall");
    btn.hidden = w.length <= 10;
    btn.textContent = showAll ? "Show fewer" : "Show all " + w.length;
    TB.$("table").className = showAll ? "" : "scroll";
  }

  function run() {
    TB.message("msg", "");
    var input = {};
    FIELDS.forEach(function (k) { input[k] = TB.$(k).value; });
    input.j2 = TB.$("j2").checked;
    try {
      var opts = {
        latDeg: TB.num("lat"), lonDeg: TB.num("lon"), incDeg: TB.num("inc"), altKm: TB.num("alt"),
        start: readUtc("start"), days: TB.num("days"), mode: input.mode,
        raanDeg: TB.num("raan"), raanEpoch: readUtc("epoch"), useJ2: input.j2, ltanHours: parseHhmm(input.ltan)
      };
      if (opts.mode === "ltan" && !isFinite(opts.ltanHours)) throw new Error("Write the node time as hh:mm, for example 22:30.");
      var r = DD.launchWindow.windows(opts);
      TB.save(KEY, input);
      last = { input: opts, result: r };
      var g = r.geometry;
      var items = [
        { k: "Windows found", v: String(r.windows.length), u: "in " + TB.fix(opts.days, 2) + " days" },
        { k: "North-going launch azimuth", v: TB.fix(g.north.azimuthDeg, 2) + "° " + compass(g.north.azimuthDeg), title: "Inertial; see the method notes" },
        { k: "Δλ, node to site (north-going)", v: TB.fix(g.north.deltaLambdaDeg, 3), u: "°" },
        { k: "Plane drift", v: TB.fix(r.nodeRateDegPerDay, 4), u: "° per day",
          title: opts.mode === "ltan" ? "A sun-synchronous plane follows the mean sun" : "From J2, the Earth's oblateness" }
      ];
      if (g.single) items.splice(2, 0, { k: "Passes", v: "One a day: the inclination equals the latitude", cls: "warn" });
      else items.splice(2, 0, { k: "South-going launch azimuth", v: TB.fix(g.south.azimuthDeg, 2) + "° " + compass(g.south.azimuthDeg) });
      TB.results("results", items);
      render();
    } catch (e) {
      last = null;
      TB.clear(TB.$("results"));
      TB.clear(TB.$("table"));
      TB.$("showall").hidden = true;
      TB.message("msg", e.message, "error");
    }
  }

  TB.ready(function () {
    var now = new Date();
    now.setUTCSeconds(0, 0);
    TB.$("start").value = utcInputValue(now);
    TB.$("epoch").value = utcInputValue(now);
    var saved = TB.load(KEY);
    if (saved) {
      // The search start always opens at the current time; everything else comes back as it was left.
      FIELDS.forEach(function (k) { if (k !== "start" && typeof saved[k] === "string" && saved[k] !== "") TB.$(k).value = saved[k]; });
      if (typeof saved.j2 === "boolean") TB.$("j2").checked = saved.j2;
    }
    showMode();
    TB.$("mode").addEventListener("change", showMode);
    TB.$("site").addEventListener("change", function () {
      if (!this.value) return;
      var p = this.value.split(",");
      TB.$("lat").value = p[0];
      TB.$("lon").value = p[1];
    });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); showAll = false; run(); });
    TB.$("showall").addEventListener("click", function () { showAll = !showAll; render(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Find windows first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied. Times are in UTC.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime) window.TicTime.onChange(render);
    run();
  });
})();
