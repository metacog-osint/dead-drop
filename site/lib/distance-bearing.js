/* Great-circle geometry on a spherical Earth: distance, initial and final bearing, midpoint, the point a given
   distance along a bearing, and sampled paths and range rings for drawing on a map. Reference: Chris Veness,
   "Calculate distance, bearing and more between latitude/longitude points" (movable-type.co.uk): the haversine
   distance, the forward azimuth theta = atan2(sin dLon cos lat2, cos lat1 sin lat2 - sin lat1 cos lat2 cos dLon),
   the midpoint, and the destination point lat2 = asin(sin lat1 cos d + cos lat1 sin d cos theta). The same results
   are in any spherical trigonometry text (e.g. Wertz & Larson, Space Mission Analysis and Design, 3rd ed., app. A).
   Also used by bearing-overlay.js and flight-path.js. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).distanceBearing = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH = 6371.0;          // km, mean Earth radius (IUGG)
  var KM_PER_NM = 1.852;         // exact, by definition
  var KM_PER_MI = 1.609344;      // exact, international mile
  var D2R = Math.PI / 180;
  var CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  function checkPoint(lat, lon, what) {
    what = what || "Point";
    if (!isFinite(lat) || !isFinite(lon) || typeof lat !== "number" || typeof lon !== "number")
      throw new Error(what + ": latitude and longitude must both be numbers.");
    if (lat < -90 || lat > 90) throw new Error(what + ": latitude must be between -90 and 90 degrees.");
    if (lon < -180 || lon > 180) throw new Error(what + ": longitude must be between -180 and 180 degrees.");
  }
  /** Longitude into [-180, 180). */
  function normLon(lon) { var x = ((lon + 180) % 360 + 360) % 360 - 180; return x === -0 ? 0 : x; }
  /** Bearing into [0, 360). */
  function normBearing(b) { var x = ((b % 360) + 360) % 360; return x === -0 ? 0 : x; }

  /** Central angle between two points, radians (haversine form, well conditioned for short distances). */
  function centralAngle(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    a = Math.min(1, Math.max(0, a));
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function distanceKm(lat1, lon1, lat2, lon2, radiusKm) {
    return (radiusKm || R_EARTH) * centralAngle(lat1, lon1, lat2, lon2);
  }
  /** Initial bearing (forward azimuth) from point 1 toward point 2, degrees clockwise from true north. */
  function initialBearing(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return normBearing(Math.atan2(y, x) / D2R);
  }
  /** Final bearing: the direction of travel on arrival at point 2 (the reverse of point 2's bearing to point 1). */
  function finalBearing(lat1, lon1, lat2, lon2) {
    return normBearing(initialBearing(lat2, lon2, lat1, lon1) + 180);
  }
  function midpoint(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, l1 = lon1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var bx = Math.cos(p2) * Math.cos(dl), by = Math.cos(p2) * Math.sin(dl);
    var p3 = Math.atan2(Math.sin(p1) + Math.sin(p2), Math.sqrt((Math.cos(p1) + bx) * (Math.cos(p1) + bx) + by * by));
    var l3 = l1 + Math.atan2(by, Math.cos(p1) + bx);
    return { lat: p3 / D2R, lon: normLon(l3 / D2R) };
  }
  /** The point distKm along a great circle that starts at (lat, lon) on bearingDeg, with the bearing on arrival. */
  function destination(lat, lon, bearingDeg, distKm, radiusKm) {
    var d = distKm / (radiusKm || R_EARTH);
    var p1 = lat * D2R, l1 = lon * D2R, t = bearingDeg * D2R;
    var sp2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t);
    var p2 = Math.asin(Math.min(1, Math.max(-1, sp2)));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    var out = { lat: p2 / D2R, lon: normLon(l2 / D2R) };
    out.finalBearing = d === 0 ? normBearing(bearingDeg) : finalBearing(lat, lon, out.lat, out.lon);
    return out;
  }
  /** 16-point compass name for a bearing. */
  function cardinal(b) { return CARDINALS[Math.round(normBearing(b) / 22.5) % 16]; }

  /** Makes a run of longitudes continuous (no 360-degree jumps) so a line drawn through them on a flat map does not
   *  cross the whole map at the antimeridian. Each value is moved by whole turns to within 180 of the one before. */
  function unwrap(lons) {
    var out = [];
    for (var i = 0; i < lons.length; i++) {
      if (i === 0) { out.push(lons[0]); continue; }
      var prev = out[i - 1], x = lons[i];
      while (x - prev > 180) x -= 360;
      while (x - prev < -180) x += 360;
      out.push(x);
    }
    return out;
  }
  /** n+1 points [lat, lon] along the great circle from (lat, lon) on bearingDeg for distKm, longitudes unwrapped. */
  function track(lat, lon, bearingDeg, distKm, n) {
    n = n || 64;
    var lats = [], lons = [];
    for (var i = 0; i <= n; i++) {
      var p = destination(lat, lon, bearingDeg, distKm * i / n);
      lats.push(p.lat); lons.push(p.lon);
    }
    lons = unwrap(lons);
    return lats.map(function (la, i) { return [la, lons[i]]; });
  }

  /** Everything the Distance and Bearing page shows for two points. */
  function compute(latA, lonA, latB, lonB) {
    checkPoint(latA, lonA, "Point A");
    checkPoint(latB, lonB, "Point B");
    var c = centralAngle(latA, lonA, latB, lonB);
    var km = R_EARTH * c;
    var same = km < 1e-6;                         // under a millimetre: no defined direction
    var antipodal = Math.PI - c < 1e-6;           // within ~6 m of the antipode: every direction is a shortest path
    var r = {
      distanceKm: km,
      distanceMi: km / KM_PER_MI,
      distanceNm: km / KM_PER_NM,
      centralAngleDeg: c / D2R,
      initialBearing: null, finalBearing: null, initialCardinal: null, finalCardinal: null,
      midpoint: null,
      note: null
    };
    if (same) { r.midpoint = { lat: latA, lon: normLon(lonA) }; r.note = "The two points are the same; there is no bearing."; return r; }
    if (antipodal) { r.note = "The points are antipodal (opposite sides of the Earth): every direction is a shortest path, so bearing and midpoint are not defined."; return r; }
    r.initialBearing = initialBearing(latA, lonA, latB, lonB);
    r.finalBearing = finalBearing(latA, lonA, latB, lonB);
    r.initialCardinal = cardinal(r.initialBearing);
    r.finalCardinal = cardinal(r.finalBearing);
    r.midpoint = midpoint(latA, lonA, latB, lonB);
    return r;
  }

  return { compute: compute, checkPoint: checkPoint, normLon: normLon, normBearing: normBearing,
    centralAngle: centralAngle, distanceKm: distanceKm, initialBearing: initialBearing, finalBearing: finalBearing,
    midpoint: midpoint, destination: destination, cardinal: cardinal, unwrap: unwrap, track: track,
    R_EARTH: R_EARTH, KM_PER_NM: KM_PER_NM, KM_PER_MI: KM_PER_MI };
});
