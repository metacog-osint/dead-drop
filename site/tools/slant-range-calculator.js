/* Slant Range Calculator page. The maths is in ../lib/slant-range.js (tested in tests/slant-range.test.js). */
(function () {
  "use strict";
  var KEY = "slant-range";
  var last = null;
  function run() {
    TB.message("msg", "");
    var input = { altitude: TB.num("altitude"), elevation: TB.num("elevation"), observerAlt: TB.num("observerAlt") || 0 };
    try {
      var r = DD.slantRange.compute(input.altitude, input.elevation, input.observerAlt);
      last = { input: input, result: r };
      TB.save(KEY, input);
      TB.results("results", [
        { k: "Slant range", v: TB.fix(r.slantRangeKm, 1), u: "km" },
        { k: "Slant range", v: TB.fix(r.slantRangeKm * 0.621371, 1), u: "mi" },
        { k: "Ground range", v: TB.fix(r.groundRangeKm, 1), u: "km", title: "Distance along the surface to the point below the satellite" },
        { k: "Range at the horizon", v: TB.fix(r.horizonRangeKm, 1), u: "km" },
        { k: "One-way delay", v: TB.fix(r.oneWayDelayMs, 3), u: "ms" },
        { k: "Round-trip delay", v: TB.fix(r.roundTripDelayMs, 3), u: "ms" },
        { k: "Earth central angle", v: TB.fix(r.centralAngleDeg, 3), u: "°" },
        { k: "Nadir angle at the satellite", v: TB.fix(r.nadirAngleDeg, 2), u: "°" }
      ]);
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      ["altitude", "elevation", "observerAlt"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
    }
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
