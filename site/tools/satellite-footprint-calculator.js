/* Satellite Footprint Calculator page. The maths is in ../lib/satellite-footprint.js
   (tested in tests/satellite-footprint.test.js). */
(function () {
  "use strict";
  var KEY = "satellite-footprint";
  var last = null;
  function run() {
    TB.message("msg", "");
    var input = { altitude: TB.num("altitude"), elevation: TB.num("elevation") };
    try {
      var r = DD.satelliteFootprint.compute(input.altitude, input.elevation);
      last = { input: input, result: r };
      TB.save(KEY, input);
      TB.results("results", [
        { k: "Footprint radius (along the ground)", v: TB.fix(r.footprintRadiusKm, 0), u: "km" },
        { k: "Footprint diameter (along the ground)", v: TB.fix(r.footprintDiameterKm, 0), u: "km",
          title: "Also the longest ground distance between two stations that can both see the satellite at once" },
        { k: "Area covered", v: TB.fix(r.areaKm2 / 1e6, 2), u: "million km²" },
        { k: "Share of the Earth's surface", v: TB.fix(r.fractionOfEarth * 100, 3), u: "%" },
        { k: "Slant range to the edge", v: TB.fix(r.edgeSlantRangeKm, 0), u: "km",
          title: "Straight-line distance from the satellite to a station on the footprint edge" },
        { k: "Nadir angle to the edge", v: TB.fix(r.nadirAngleDeg, 2), u: "°",
          title: "Beam half-width the satellite needs, measured from straight down" },
        { k: "Earth central angle", v: TB.fix(r.centralAngleDeg, 2), u: "°" },
        { k: "Earth's angular radius from the satellite", v: TB.fix(r.earthAngularRadiusDeg, 2), u: "°" }
      ]);
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      ["altitude", "elevation"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
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
