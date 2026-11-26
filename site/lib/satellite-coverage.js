/* Satellite coverage of a ground target: how far from the target the satellite's ground point can be while the
   target still sees the satellite at or above a minimum elevation angle, the circle that draws on the map, and the
   statistics of the coverage windows over a period (how much of the time the target is covered, the longest gap,
   the mean revisit time). No DOM, no network, no propagator; the page finds the windows themselves with
   ./satellite-passes.js (rise and set at the minimum elevation).
   References:
   - Coverage geometry, spherical Earth: Wertz & Larson, Space Mission Analysis and Design, 3rd ed., section 5.2:
       sin(eta) = (R / (R + h)) cos(el)      eta: nadir angle at the satellite
       lambda   = 90 deg - el - eta          lambda: Earth central angle from the target to the circle's edge
       D        = R sin(lambda) / sin(eta)   slant range at the edge (law of sines; law of cosines used here)
     and the reverse, the elevation seen across a central angle lambda: tan(el) = (cos(lambda) - R/(R + h)) / sin(lambda).
   - Points on the circle: the destination-point formula on a sphere (Chris Veness, "Calculate distance, bearing and
     more between latitude/longitude points", movable-type.co.uk).
   - Coverage statistics (percent coverage, maximum gap, mean revisit): Wertz & Larson section 7.2 (coverage figures
     of merit). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).satelliteCoverage = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH = 6371.0;   // km, mean Earth radius (IUGG)
  var D2R = Math.PI / 180;

  /** The coverage circle for a satellite at altitude hKm seen at or above minElDeg. */
  function geometry(hKm, minElDeg) {
    if (!isFinite(hKm) || !isFinite(minElDeg)) throw new Error("Altitude and minimum elevation must be numbers.");
    if (!(hKm > 0)) throw new Error("Altitude must be above zero.");
    if (minElDeg < 0 || minElDeg >= 90) throw new Error("Minimum elevation must be from 0 up to (not including) 90 degrees.");
    var rs = R_EARTH + hKm, el = minElDeg * D2R;
    var eta = Math.asin((R_EARTH / rs) * Math.cos(el));
    var lambda = Math.PI / 2 - el - eta;
    var slant = Math.sqrt(R_EARTH * R_EARTH + rs * rs - 2 * R_EARTH * rs * Math.cos(lambda));
    return {
      centralAngleDeg: lambda / D2R,
      nadirAngleDeg: eta / D2R,
      radiusKm: R_EARTH * lambda,                              // along the surface, target to circle edge
      edgeSlantRangeKm: slant,
      areaKm2: 2 * Math.PI * R_EARTH * R_EARTH * (1 - Math.cos(lambda))
    };
  }

  /** Elevation (degrees) of a satellite at altitude hKm whose ground point is centralAngleDeg from the observer. */
  function elevationAt(hKm, centralAngleDeg) {
    if (!(hKm > 0) || !isFinite(centralAngleDeg)) throw new Error("Altitude must be above zero and the angle a number.");
    var lam = Math.abs(centralAngleDeg) * D2R;
    if (lam < 1e-12) return 90;
    return Math.atan2(Math.cos(lam) - R_EARTH / (R_EARTH + hKm), Math.sin(lam)) / D2R;
  }

  /** Destination point from (latDeg, lonDeg) on bearing brgDeg across a central angle angDeg; longitude is NOT
   *  wrapped, so a ring stays continuous on the map. */
  function destination(latDeg, lonDeg, brgDeg, angDeg) {
    var p1 = latDeg * D2R, l1 = lonDeg * D2R, th = brgDeg * D2R, d = angDeg * D2R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
    var l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / D2R, l2 / D2R];
  }

  /** A ring of n points (default 180) at central angle angDeg around (latDeg, lonDeg), as [[lat, lon]...] with
   *  continuous longitudes. A ring that contains a pole cannot close around the centre on the flat map, so it is
   *  closed along the pole's latitude instead. */
  function circle(latDeg, lonDeg, angDeg, n) {
    if (![latDeg, lonDeg, angDeg].every(isFinite)) throw new Error("Centre and radius must be numbers.");
    if (latDeg < -90 || latDeg > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
    if (!(angDeg > 0 && angDeg < 180)) throw new Error("The radius must be between 0 and 180 degrees of arc.");
    n = n || 180;
    var pts = [], prev = null;
    for (var i = 0; i <= n; i++) {
      var q = destination(latDeg, lonDeg, 360 * i / n, angDeg);
      if (prev) { while (q[1] - prev[1] > 180) q[1] -= 360; while (q[1] - prev[1] < -180) q[1] += 360; }
      pts.push(q); prev = q;
    }
    var north = latDeg + angDeg > 90, south = latDeg - angDeg < -90;
    if (north || south) {
      // The longitudes run once round (360 deg) instead of returning; close through the pole.
      var pole = north ? 90 : -90;
      var a = pts[0], b = pts[pts.length - 1];
      pts.push([pole, b[1]]); pts.push([pole, a[1]]);
    }
    return pts;
  }

  /** Statistics for coverage windows [{startMs, endMs}] within [fromMs, toMs]: merged windows, total covered
   *  seconds, fraction of the period, the longest gap (counting the edges of the period), the mean gap between
   *  windows, the mean revisit time (start to start) and the mean window length. */
  function stats(windows, fromMs, toMs) {
    if (!(isFinite(fromMs) && isFinite(toMs) && toMs > fromMs)) throw new Error("The period must end after it starts.");
    var w = (windows || []).map(function (x) {
      if (!x || !isFinite(x.startMs) || !isFinite(x.endMs) || x.endMs < x.startMs) throw new Error("Each window needs a start before its end.");
      return { startMs: Math.max(fromMs, x.startMs), endMs: Math.min(toMs, x.endMs) };
    }).filter(function (x) { return x.endMs > x.startMs; }).sort(function (p, q) { return p.startMs - q.startMs; });
    var merged = [];
    w.forEach(function (x) {
      var l = merged[merged.length - 1];
      if (l && x.startMs <= l.endMs) l.endMs = Math.max(l.endMs, x.endMs);
      else merged.push({ startMs: x.startMs, endMs: x.endMs });
    });
    var covered = 0, gaps = [], longest = 0, cursor = fromMs;
    merged.forEach(function (x, i) {
      covered += x.endMs - x.startMs;
      var g = x.startMs - cursor;
      if (i > 0) gaps.push(g);
      longest = Math.max(longest, g);
      cursor = x.endMs;
    });
    longest = Math.max(longest, toMs - cursor);
    var span = toMs - fromMs;
    var revisits = [];
    for (var k = 1; k < merged.length; k++) revisits.push(merged[k].startMs - merged[k - 1].startMs);
    var mean = function (a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : NaN; };
    return {
      windows: merged,
      count: merged.length,
      coveredS: covered / 1000,
      fraction: covered / span,
      longestGapS: longest / 1000,
      meanGapS: mean(gaps) / 1000,
      meanRevisitS: mean(revisits) / 1000,
      meanWindowS: merged.length ? covered / merged.length / 1000 : NaN
    };
  }

  return { geometry: geometry, elevationAt: elevationAt, destination: destination, circle: circle, stats: stats,
    R_EARTH: R_EARTH };
});
