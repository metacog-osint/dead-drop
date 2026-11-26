/* Launch Azimuth Calculator page. The maths is in ../lib/launch-azimuth.js (tested in tests/launch-azimuth.test.js). */
(function () {
  "use strict";
  var KEY = "launch-azimuth";
  var FIELDS = ["lat", "lon", "inc", "alt"];
  var last = null, map = null, layer = null;

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function drawMap(lat, lon, r) {
    if (!window.L) return;   // Leaflet did not load (offline); the numbers still stand.
    if (!map) {
      map = L.map("map", { worldCopyJump: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    var n = DD.launchAzimuth.headingLine(lat, lon, r.rotatingNorthDeg, 2000);
    var s = DD.launchAzimuth.headingLine(lat, lon, r.rotatingSouthDeg, 2000);
    L.polyline(n, { color: cssVar("--plot-1", "#2b5d8a"), weight: 3 }).addTo(layer)
      .bindTooltip("North-going, " + TB.fix(r.rotatingNorthDeg, 1) + "°");
    if (!r.dueEastOrWest) {
      L.polyline(s, { color: cssVar("--plot-2", "#c2410c"), weight: 3, dashArray: "6 6" }).addTo(layer)
        .bindTooltip("South-going, " + TB.fix(r.rotatingSouthDeg, 1) + "°");
    }
    L.marker([lat, lon]).addTo(layer).bindPopup(TB.el("div", null, [
      TB.el("strong", { text: "Launch site" }), TB.el("br"),
      TB.fix(lat, 3) + "°, " + TB.fix(lon, 3) + "°"
    ]));
    map.fitBounds(L.latLngBounds(n.concat(s).concat([[lat, lon]])), { padding: [20, 20] });
  }

  function run() {
    TB.message("msg", "");
    var input = { lat: TB.num("lat"), lon: TB.num("lon"), inc: TB.num("inc"), alt: TB.num("alt") };
    try {
      if (!isFinite(input.lon)) input.lon = 0;
      if (input.lon < -180 || input.lon > 180) throw new Error("Longitude must be between -180 and 180 degrees.");
      var A = DD.launchAzimuth;
      var r = A.compute(input.lat, input.inc, input.alt);
      last = { input: input, result: r };
      TB.save(KEY, input);
      var items = [
        { k: "North-going, relative to the ground", v: TB.fix(r.rotatingNorthDeg, 2) + " " + A.compass(r.rotatingNorthDeg), u: "°", cls: "ok",
          title: "The heading flown at liftoff, corrected for the Earth's rotation" },
        { k: "South-going, relative to the ground", v: TB.fix(r.rotatingSouthDeg, 2) + " " + A.compass(r.rotatingSouthDeg), u: "°", cls: "ok" },
        { k: "North-going, inertial", v: TB.fix(r.inertialNorthDeg, 2), u: "°", title: "Heading for a non-rotating Earth" },
        { k: "South-going, inertial", v: TB.fix(r.inertialSouthDeg, 2), u: "°" },
        { k: "Orbital speed", v: TB.fix(r.orbitalSpeedKms * 1000, 0), u: "m/s" },
        { k: "Ground speed at the site", v: TB.fix(r.siteSpeedKms * 1000, 1), u: "m/s", title: "Eastward speed from the Earth's spin" },
        { k: "Rotation gain along the orbit", v: TB.fix(r.rotationGainKms * 1000, 1), u: "m/s",
          cls: r.rotationGainKms < 0 ? "warn" : null, title: "Negative means the launch works against the Earth's spin" },
        { k: "Speed to add, relative to the ground", v: TB.fix(r.groundSpeedNeededKms * 1000, 0), u: "m/s",
          title: "Ideal: no gravity, drag or steering losses" },
        { k: "Reachable from this latitude", v: TB.fix(r.minInclinationDeg, 2) + " to " + TB.fix(r.maxInclinationDeg, 2), u: "°" }
      ];
      if (r.dueEastOrWest) items.splice(1, 1, { k: "Note", v: "One heading only: the inclination equals the latitude", cls: "warn" });
      TB.results("results", items);
      drawMap(input.lat, input.lon, r);
    } catch (e) {
      last = null;
      TB.message("msg", e.message, "error");
    }
  }

  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) FIELDS.forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
    TB.$("site").addEventListener("change", function () {
      if (!this.value) return;
      var p = this.value.split(",");
      TB.$("lat").value = p[0];
      TB.$("lon").value = p[1];
      run();
    });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
