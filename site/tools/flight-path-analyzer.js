/* Flight Path Analyzer page. The maths is in ../lib/distance-bearing.js and ../lib/flight-path.js
   (tested in tests/flight-path.test.js). Map: Leaflet with OpenStreetMap tiles. */
(function () {
  "use strict";
  var KEY = "flight-path";
  var IDS = ["lat", "lon", "azimuth", "range", "time"];
  var map, layers = [], last = null;

  function ll(p) {
    return TB.fix(Math.abs(p.lat), 4) + "° " + (p.lat < 0 ? "S" : "N") + ", " +
      TB.fix(Math.abs(p.lon), 4) + "° " + (p.lon < 0 ? "W" : "E");
  }
  function draw(input, r) {
    layers.forEach(function (l) { map.removeLayer(l); });
    var line = L.polyline(r.track, { color: "#b3261e", weight: 3, dashArray: "10 5" });
    var start = L.circleMarker([input.lat, input.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: "#1d6b3a", fillOpacity: 1 })
      .bindTooltip("Launch point " + ll(input));
    var tip = r.track[r.track.length - 1];
    var end = L.circleMarker(tip, { radius: 7, color: "#ffffff", weight: 2, fillColor: "#b3261e", fillOpacity: 1 })
      .bindTooltip("End point " + ll(r.end));
    layers = [line, start, end];
    layers.forEach(function (l) { l.addTo(map); });
    map.fitBounds(line.getBounds(), { padding: [24, 24], maxZoom: 9 });
  }
  function run() {
    TB.message("msg", "");
    var input = {};
    IDS.forEach(function (k) { input[k] = TB.num(k); });
    try {
      var r = DD.flightPath.compute(input.lat, input.lon, input.azimuth, input.range, isNaN(input.time) ? null : input.time);
      var me = r.minimumEnergy;
      last = { input: input, result: { end: r.end, arrivalBearingDeg: r.arrivalBearingDeg,
        averageGroundSpeedKmH: r.averageGroundSpeedKmH, minimumEnergy: me } };
      TB.save(KEY, input);
      var items = [
        { k: "End point", v: ll(r.end) },
        { k: "Arrival bearing", v: TB.fix(r.arrivalBearingDeg, 1), u: "° true", title: "Direction of travel at the end point" },
        { k: "Ground range", v: TB.fix(r.rangeKm, 1), u: "km (" + TB.fix(r.rangeKm / 1.852, 1) + " NM)" }
      ];
      if (r.averageGroundSpeedKmH !== null) {
        items.push({ k: "Average speed along the ground track", v: TB.fix(r.averageGroundSpeedKmH, 0), u: "km/h",
          title: "Ground range divided by your flight time" });
      }
      TB.results("results", items);
      var b = [
        { k: "Apogee (highest point)", v: TB.fix(me.apogeeAltitudeKm, 0), u: "km above the surface" },
        { k: "Speed at cut-off", v: TB.fix(me.burnoutSpeedKmS, 2), u: "km/s" },
        { k: "Climb angle at cut-off", v: TB.fix(me.flightPathAngleDeg, 1), u: "° above horizontal" },
        { k: "Flight time, cut-off to re-entry", v: TB.fix(me.flightTimeMin, 1), u: "min" }
      ];
      if (r.averageGroundSpeedKmH !== null) {
        b.push({ k: "Your time against minimum energy", v: TB.fix(input.time / me.flightTimeMin, 2), u: "times",
          title: "Above 1: slower than the minimum-energy path (for example lofted, or a non-ballistic flight)" });
      }
      TB.results("ballistic", b);
      draw(input, r);
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    map = L.map("map").setView([28.5, -80.6], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);
    var saved = TB.load(KEY);
    if (saved) IDS.forEach(function (k) { if (saved[k] !== null && isFinite(saved[k])) TB.$(k).value = saved[k]; });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
