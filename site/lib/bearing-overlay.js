/* Range rings and bearing lines for a flat web map, drawn as true great-circle shapes on a spherical Earth.
   A range ring is the set of points at one distance from a centre: each vertex is the destination point at that
   distance on bearings 0 to 360 degrees. A bearing line is the great circle that leaves the centre on the given
   bearing, sampled along its length so it bends on the map as it should. Reference: Chris Veness, "Calculate
   distance, bearing and more between latitude/longitude points" (movable-type.co.uk), destination point.
   Needs distance-bearing.js (window.DD.distanceBearing in the browser, require under Node). */
(function (root, factory) {
  var gc = (typeof module === "object" && module.exports) ? require("./distance-bearing.js") : root.DD.distanceBearing;
  var api = factory(gc);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).bearingOverlay = api;
})(typeof self !== "undefined" ? self : this, function (gc) {
  "use strict";
  var D2R = Math.PI / 180;
  var MAX_KM = Math.PI * gc.R_EARTH;   // 20,015 km: half way round; beyond this the ring shrinks again

  function checkCentre(lat, lon) { gc.checkPoint(lat, lon, "Centre"); }
  function checkLength(km, what) {
    if (typeof km !== "number" || !isFinite(km) || km <= 0) throw new Error(what + " must be a number above 0 km.");
    if (km >= MAX_KM) throw new Error(what + " must be under " + Math.floor(MAX_KM) + " km (half way round the Earth).");
  }

  /** Which pole, if any, lies inside a ring of radiusKm around (lat, lon): "N", "S" or null. */
  function enclosedPole(lat, lon, radiusKm) {
    var ang = radiusKm / gc.R_EARTH;
    if ((90 - lat) * D2R < ang) return "N";
    if ((90 + lat) * D2R < ang) return "S";
    return null;
  }

  /** A ring of n vertices (plus the closing one) at radiusKm from the centre, as [lat, lon] with longitudes
   *  unwrapped about the centre. If the ring encloses a pole, the outline is closed through that pole so a map
   *  fills the right side of it. Returns { ring, pole }. */
  function ring(lat, lon, radiusKm, n) {
    checkCentre(lat, lon);
    checkLength(radiusKm, "Radius");
    n = n || 180;
    var lats = [], lons = [];
    for (var i = 0; i <= n; i++) {
      var p = gc.destination(lat, lon, 360 * i / n, radiusKm);
      lats.push(p.lat); lons.push(p.lon);
    }
    lons = gc.unwrap([lon].concat(lons)).slice(1);   // start next to the centre's own longitude
    var pts = lats.map(function (la, i) { return [la, lons[i]]; });
    var pole = enclosedPole(lat, lon, radiusKm);
    if (pole) {
      var pl = pole === "N" ? 90 : -90;
      pts.push([pl, pts[pts.length - 1][1]]);
      pts.push([pl, pts[0][1]]);
    }
    return { ring: pts, pole: pole };
  }

  /** A bearing line from the centre: sampled points, the end point and the bearing on arrival there. */
  function bearingLine(lat, lon, bearingDeg, lengthKm, n) {
    checkCentre(lat, lon);
    if (typeof bearingDeg !== "number" || !isFinite(bearingDeg)) throw new Error("Bearing must be a number of degrees.");
    checkLength(lengthKm, "Length");
    var b = gc.normBearing(bearingDeg);
    var end = gc.destination(lat, lon, b, lengthKm);
    return { bearing: b, points: gc.track(lat, lon, b, lengthKm, n || Math.max(16, Math.ceil(lengthKm / 50))),
      end: { lat: end.lat, lon: end.lon }, finalBearing: end.finalBearing };
  }

  return { ring: ring, bearingLine: bearingLine, enclosedPole: enclosedPole, MAX_KM: MAX_KM };
});
