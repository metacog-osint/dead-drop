/* Line of sight between two points over terrain, allowing for the Earth's curvature and atmospheric refraction.
   References:
   - Great-circle distance (haversine) and intermediate points: Chris Veness, "Calculate distance, bearing and more
     between latitude/longitude points", movable-type.co.uk, on a sphere of radius 6,371 km (IUGG mean radius).
   - Curvature with refraction: the effective Earth radius model, k R, with k = 4/3 for radio waves in the ITU-R
     standard atmosphere (refractivity falling 40 N-units per km; ITU-R P.453 and P.834, as used for path profiles in
     ITU-R P.452 and P.526). Over distance d from the observer the surface drops d^2 / (2 k R) below the observer's
     level plane, which gives the familiar radio horizon sqrt(2 k R h), about 4.12 sqrt(h in m) km. For light, the
     surveyors' coefficient of refraction of about 0.13 gives k = 1 / (1 - 0.13), about 7/6 (by day; it varies a lot
     near the ground). k = 1 is the bare geometric Earth.
   A target is visible when the straight sight line from the observer's eye to the target clears the ground at every
   sample point between them, after each point is lowered by its curvature drop. Pure functions: no DOM, no network.
   The terrain heights come from the page (a public elevation service) or from a test. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).viewshed = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH = 6371000;   // m, IUGG mean radius
  var K_RADIO = 4 / 3, K_OPTICAL = 7 / 6;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function checkPoint(p, what) {
    if (!p || ![p.lat, p.lon].every(function (x) { return typeof x === "number" && isFinite(x); }))
      throw new Error(what + ": latitude and longitude must be numbers.");
    if (p.lat < -90 || p.lat > 90) throw new Error(what + ": latitude must be between -90 and 90 degrees.");
    if (p.lon < -180 || p.lon > 180) throw new Error(what + ": longitude must be between -180 and 180 degrees.");
  }

  /** Great-circle distance in metres (haversine; Veness). */
  function distanceM(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = (b.lat - a.lat) * D2R, dl = (b.lon - a.lon) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R_EARTH * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  /** Initial bearing from a to b, degrees clockwise from true north (Veness). */
  function bearingDeg(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }

  /** The point a fraction f of the way from a to b along the great circle (Veness, "intermediate point"). */
  function intermediate(a, b, f) {
    var delta = distanceM(a, b) / R_EARTH;
    if (delta < 1e-12) return { lat: a.lat, lon: a.lon };
    var p1 = a.lat * D2R, l1 = a.lon * D2R, p2 = b.lat * D2R, l2 = b.lon * D2R;
    var A = Math.sin((1 - f) * delta) / Math.sin(delta), B = Math.sin(f * delta) / Math.sin(delta);
    var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    var z = A * Math.sin(p1) + B * Math.sin(p2);
    return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D, lon: Math.atan2(y, x) * R2D };
  }

  /** n + 1 evenly spaced points from a to b (n intervals), each with its distance from a in metres. */
  function profilePoints(a, b, n) {
    checkPoint(a, "Observer"); checkPoint(b, "Target");
    if (!(n >= 2 && n <= 1000 && Math.floor(n) === n)) throw new Error("Sample count must be a whole number from 2 to 1000.");
    var D = distanceM(a, b), pts = [];
    for (var i = 0; i <= n; i++) {
      var f = i / n, p = intermediate(a, b, f);
      pts.push({ lat: p.lat, lon: p.lon, distM: f * D });
    }
    return pts;
  }

  /** Curvature drop below the observer's level plane at distance d (m), for refraction factor k (k = Infinity: none). */
  function dropM(d, k, R) { return isFinite(k) ? d * d / (2 * k * (R || R_EARTH)) : 0; }

  /** Distance to the horizon over a smooth sphere of effective radius k R, for an eye h metres above it. */
  function horizonM(h, k, R) {
    if (!(h >= 0)) throw new Error("Height must be zero or more.");
    k = k || K_RADIO; R = R || R_EARTH;
    return Math.sqrt(2 * k * R * h + h * h);
  }

  /** Line of sight along a terrain profile.
   *  profile: { distM: [0, ..., D] increasing, groundM: [...] same length } (ground heights above a common datum)
   *  observerHeightM / targetHeightM: heights above the ground at each end; opts: { k: 4/3, R: 6371000 }. */
  function lineOfSight(profile, observerHeightM, targetHeightM, opts) {
    opts = opts || {};
    var k = opts.k === undefined ? K_RADIO : opts.k, R = opts.R || R_EARTH;
    if (!(k > 0)) throw new Error("The refraction factor k must be more than 0.");
    var d = profile && profile.distM, g = profile && profile.groundM;
    if (!Array.isArray(d) || !Array.isArray(g) || d.length !== g.length || d.length < 2)
      throw new Error("The profile needs matching lists of distances and ground heights, at least two points.");
    for (var j = 0; j < d.length; j++) {
      if (!isFinite(d[j]) || !isFinite(g[j])) throw new Error("Profile point " + j + " is not a number.");
      if (j > 0 && !(d[j] > d[j - 1])) throw new Error("Profile distances must increase.");
    }
    if (d[0] !== 0) throw new Error("The profile must start at the observer (distance 0).");
    if (![observerHeightM, targetHeightM].every(function (x) { return isFinite(x) && x >= 0; }))
      throw new Error("Observer and target heights must be zero or more.");
    var n = d.length - 1, D = d[n];
    var eye = g[0] + observerHeightM;
    var tgt = g[n] + targetHeightM - dropM(D, k, R);       // target, lowered by its curvature drop
    var adjusted = g.map(function (h, i) { return h - dropM(d[i], k, R); });
    var sight = d.map(function (x) { return eye + (tgt - eye) * x / D; });
    var minClear = Infinity, minAt = -1, maxSlope = -Infinity, maxSlopeAt = -1;
    for (var i = 1; i < n; i++) {
      var c = sight[i] - adjusted[i];
      if (c < minClear) { minClear = c; minAt = i; }
      var s = (adjusted[i] - eye) / d[i];
      if (s > maxSlope) { maxSlope = s; maxSlopeAt = i; }
    }
    var visible = n < 2 ? true : minClear >= 0;
    // Height the target would need above its ground to be seen: the sight line through the steepest obstruction.
    var neededTgt = n < 2 ? tgt : Math.max(tgt, eye + maxSlope * D);
    var extra = neededTgt - tgt;
    return {
      visible: visible,
      distanceM: D,
      eyeM: eye,
      targetTopM: g[n] + targetHeightM,
      minClearanceM: n < 2 ? null : minClear,
      minClearanceAtM: n < 2 ? null : d[minAt],
      obstructionAtM: !visible ? d[maxSlopeAt] : null,
      obstructionGroundM: !visible ? g[maxSlopeAt] : null,
      extraTargetHeightM: visible ? 0 : extra,
      // Angle of the sight line above the observer's level plane, with curvature and refraction (small-angle form).
      lookAngleDeg: Math.atan2(tgt - eye, D) * R2D,
      targetDropM: dropM(D, k, R),
      adjustedGroundM: adjusted,
      sightLineM: sight,
      k: k
    };
  }

  /** Check an Open-Elevation /api/v1/lookup reply and return the heights in order. */
  function parseElevations(json, expected) {
    var r = json && json.results;
    if (!Array.isArray(r)) throw new Error("The elevation service's reply had no results list.");
    if (r.length !== expected) throw new Error("The elevation service returned " + r.length + " heights for " + expected + " points.");
    return r.map(function (x, i) {
      var e = x && x.elevation;
      if (typeof e !== "number" || !isFinite(e) || e < -1000 || e > 9000)
        throw new Error("The elevation service has no usable height for point " + (i + 1) + ".");
      return e;
    });
  }

  return { distanceM: distanceM, bearingDeg: bearingDeg, intermediate: intermediate, profilePoints: profilePoints,
    dropM: dropM, horizonM: horizonM, lineOfSight: lineOfSight, parseElevations: parseElevations,
    R_EARTH: R_EARTH, K_RADIO: K_RADIO, K_OPTICAL: K_OPTICAL };
});
