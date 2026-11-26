/* Locating a radio transmitter from several receivers, on a spherical Earth (R = 6,371 km).
   Spherical formulas (distance, initial bearing, destination, intersection of two great-circle paths,
   cross-track distance) follow Chris Veness, "Calculate distance, bearing and more between latitude/longitude
   points" (movable-type.co.uk), which takes them from Ed Williams' Aviation Formulary.
   Bearing fix (angle of arrival): a weighted least-squares fix in the manner of Stansfield, "Statistical theory of
   d.f. fixing", J. IEE 94 part IIIA (1947): each bearing with standard error sigma pulls the fix toward its line
   with weight 1 / (R sin(delta) sigma)^2, where delta is the angular range, and the 2 x 2 covariance of the fix
   gives the error ellipse. Poisel, Electronic Warfare Target Location Methods, 2nd ed. (2012), covers the same.
   Time-difference fix (TDOA): each receiver's arrival time minus the reference receiver's, times c, is the
   difference of the two distances to the transmitter; the fix is the weighted least-squares solution of those
   equations, with the differences' correlation (they share the reference) in the weight matrix
   (Torrieri, "Statistical theory of passive location systems", IEEE Trans. AES 20(2), 1984).
   The emitter is taken to be at ground level, in two dimensions. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).rfTriangulation = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R = 6371.0;                 // km, mean Earth radius (IUGG)
  var C_KM_US = 0.299792458;      // km per microsecond, speed of light
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var K95 = Math.sqrt(-2 * Math.log(0.05)); // 2.4477: 95% ellipse scale for two dimensions (chi-square, 2 dof)

  function wrap180(x) { return ((x + 540) % 360 + 360) % 360 - 180; }
  function wrap360(x) { return ((x % 360) + 360) % 360; }

  /** Great-circle distance in km (haversine). */
  function distanceKm(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  /** Initial bearing, degrees clockwise from true north, 0 to 360. */
  function bearingDeg(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return wrap360(Math.atan2(y, x) * R2D);
  }
  /** The point distKm along a great circle from (lat, lon) on initial bearing brngDeg. */
  function destination(lat, lon, brngDeg, distKm) {
    var p1 = lat * D2R, l1 = lon * D2R, t = brngDeg * D2R, d = distKm / R;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * R2D, lon: wrap180(l2 * R2D) };
  }
  /** Where the path from point 1 on bearing b1 meets the path from point 2 on bearing b2, ahead of both;
   *  null when they do not meet ahead of both, or the points coincide. Veness, "Intersection of two paths". */
  function intersection(lat1, lon1, b1, lat2, lon2, b2) {
    var p1 = lat1 * D2R, l1 = lon1 * D2R, p2 = lat2 * D2R, l2 = lon2 * D2R;
    var t13 = b1 * D2R, t23 = b2 * D2R;
    var dp = p2 - p1, dl = l2 - l1;
    var d12 = 2 * Math.asin(Math.sqrt(Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2)));
    if (Math.abs(d12) < 1e-12) return null;
    var cosTa = (Math.sin(p2) - Math.sin(p1) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(p1));
    var cosTb = (Math.sin(p1) - Math.sin(p2) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(p2));
    var ta = Math.acos(Math.min(Math.max(cosTa, -1), 1));
    var tb = Math.acos(Math.min(Math.max(cosTb, -1), 1));
    var t12 = Math.sin(l2 - l1) > 0 ? ta : 2 * Math.PI - ta;
    var t21 = Math.sin(l2 - l1) > 0 ? 2 * Math.PI - tb : tb;
    var a1 = t13 - t12, a2 = t21 - t23;
    if (Math.sin(a1) === 0 && Math.sin(a2) === 0) return null;   // both along the baseline: no single point
    if (Math.sin(a1) * Math.sin(a2) < 0) return null;            // they head to opposite sides of the baseline
    var cosA3 = -Math.cos(a1) * Math.cos(a2) + Math.sin(a1) * Math.sin(a2) * Math.cos(d12);
    var d13 = Math.atan2(Math.sin(d12) * Math.sin(a1) * Math.sin(a2), Math.cos(a2) + Math.cos(a1) * cosA3);
    var p3 = Math.asin(Math.sin(p1) * Math.cos(d13) + Math.cos(p1) * Math.sin(d13) * Math.cos(t13));
    var dl13 = Math.atan2(Math.sin(t13) * Math.sin(d13) * Math.cos(p1), Math.cos(d13) - Math.sin(p1) * Math.sin(p3));
    return { lat: p3 * R2D, lon: wrap180((l1 + dl13) * R2D), distance1Km: d13 * R };
  }
  /** Signed distance (km) of point P from the great circle leaving S on bearing brngDeg; positive to the right. */
  function crossTrackKm(latS, lonS, brngDeg, latP, lonP) {
    var d13 = distanceKm(latS, lonS, latP, lonP) / R;
    var t13 = bearingDeg(latS, lonS, latP, lonP) * D2R;
    return Math.asin(Math.sin(d13) * Math.sin(t13 - brngDeg * D2R)) * R;
  }
  /** Mean of points as unit vectors (safe across the antimeridian, unlike averaging longitudes). */
  function meanPoint(pts) {
    var x = 0, y = 0, z = 0;
    pts.forEach(function (p) {
      var a = p.lat * D2R, b = p.lon * D2R;
      x += Math.cos(a) * Math.cos(b); y += Math.cos(a) * Math.sin(b); z += Math.sin(a);
    });
    var h = Math.sqrt(x * x + y * y);
    return { lat: Math.atan2(z, h) * R2D, lon: Math.atan2(y, x) * R2D };
  }

  // ---- small linear algebra ----
  function inv2(a, b, c, d) { // [[a, b], [c, d]]
    var det = a * d - b * c;
    if (!(Math.abs(det) > 1e-18 * Math.max(1, Math.abs(a * d), Math.abs(b * c)))) return null;
    return [[d / det, -b / det], [-c / det, a / det]];
  }
  function quad(r, W) { // r' W r
    var s = 0;
    for (var i = 0; i < r.length; i++) for (var j = 0; j < r.length; j++) s += r[i] * W[i][j] * r[j];
    return s;
  }
  /** Error ellipse from a 2 x 2 covariance [[ee, en], [en, nn]] in km^2: 1-sigma semi-axes and the bearing of the
   *  major axis (degrees clockwise from north, 0 to 180). */
  function ellipse(cov) {
    var ee = cov[0][0], nn = cov[1][1], en = cov[0][1];
    var mid = (ee + nn) / 2, h = Math.sqrt(((ee - nn) / 2) * ((ee - nn) / 2) + en * en);
    var l1 = mid + h, l2 = Math.max(mid - h, 0);
    var fromEast = 0.5 * Math.atan2(2 * en, ee - nn) * R2D;   // major-axis angle counter-clockwise from east
    var orient = wrap360(90 - fromEast) % 180;
    return { majorKm: Math.sqrt(l1), minorKm: Math.sqrt(l2), orientDeg: orient };
  }
  function scaled(e, k) { return { majorKm: e.majorKm * k, minorKm: e.minorKm * k, orientDeg: e.orientDeg }; }

  /** Gauss-Newton on the sphere. model(lat, lon) returns {r: residuals (km), W: weight matrix (1/km^2)}.
   *  Steps are taken in a local east-north frame, with a numerical Jacobian over 1 m. */
  function gaussNewton(start, model, maxIter) {
    var x = { lat: start.lat, lon: start.lon }, h = 0.001, it = 0;
    var m = model(x.lat, x.lon), cost = quad(m.r, m.W), N = null;
    function jac(p) {
      var e1 = destination(p.lat, p.lon, 90, h), e0 = destination(p.lat, p.lon, 270, h);
      var n1 = destination(p.lat, p.lon, 0, h), n0 = destination(p.lat, p.lon, 180, h);
      var re1 = model(e1.lat, e1.lon).r, re0 = model(e0.lat, e0.lon).r;
      var rn1 = model(n1.lat, n1.lon).r, rn0 = model(n0.lat, n0.lon).r;
      return re1.map(function (_, i) { return [(re1[i] - re0[i]) / (2 * h), (rn1[i] - rn0[i]) / (2 * h)]; });
    }
    function normal(J, W, r) {
      var a = 0, b = 0, d = 0, g0 = 0, g1 = 0, n = J.length;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        var w = W[i][j];
        a += J[i][0] * w * J[j][0]; b += J[i][0] * w * J[j][1]; d += J[i][1] * w * J[j][1];
        g0 += J[i][0] * w * r[j]; g1 += J[i][1] * w * r[j];
      }
      return { N: [[a, b], [b, d]], g: [g0, g1] };
    }
    for (it = 0; it < (maxIter || 60); it++) {
      var J = jac(x), ne = normal(J, m.W, m.r);
      var Ni = inv2(ne.N[0][0], ne.N[0][1], ne.N[1][0], ne.N[1][1]);
      if (!Ni) return null;
      var de = -(Ni[0][0] * ne.g[0] + Ni[0][1] * ne.g[1]);
      var dn = -(Ni[1][0] * ne.g[0] + Ni[1][1] * ne.g[1]);
      var step = Math.sqrt(de * de + dn * dn);
      if (!isFinite(step)) return null;
      if (step > 2000) { de *= 2000 / step; dn *= 2000 / step; step = 2000; }
      var brng = Math.atan2(de, dn) * R2D, accepted = false, frac = 1;
      for (var k = 0; k < 12; k++) {
        var y = destination(x.lat, x.lon, brng, step * frac), my = model(y.lat, y.lon), cy = quad(my.r, my.W);
        if (cy <= cost || step * frac < 1e-9) { x = y; m = my; cost = cy; accepted = true; break; }
        frac /= 2;
      }
      if (!accepted || step * frac < 1e-7) break;
    }
    var Jf = jac(x), nf = normal(Jf, m.W, m.r);
    N = inv2(nf.N[0][0], nf.N[0][1], nf.N[1][0], nf.N[1][1]);
    if (!N) return null;
    return { lat: x.lat, lon: x.lon, cov: N, cost: cost, r: m.r, iterations: it + 1 };
  }

  function checkPoint(p, i) {
    if (![p.lat, p.lon].every(function (v) { return typeof v === "number" && isFinite(v); })) {
      throw new Error("Receiver " + (i + 1) + ": latitude and longitude must be numbers.");
    }
    if (Math.abs(p.lat) > 90) throw new Error("Receiver " + (i + 1) + ": latitude must be between -90 and 90.");
    if (Math.abs(p.lat) > 89.9) throw new Error("Receiver " + (i + 1) + ": too close to a pole for this method.");
  }

  /** Bearing fix. rx: [{lat, lon, bearing, sigmaDeg?}] with bearings in degrees from true north (or magnetic, with
   *  opts.declinationDeg, east positive, added to each). opts.sigmaDeg is the default bearing error (1 sigma). */
  function aoaFix(rx, opts) {
    opts = opts || {};
    var decl = opts.declinationDeg || 0, sigDefault = opts.sigmaDeg === undefined ? 3 : opts.sigmaDeg;
    if (!Array.isArray(rx) || rx.length < 2) throw new Error("A bearing fix needs at least two receivers.");
    if (!isFinite(decl)) throw new Error("Declination must be a number.");
    var list = rx.map(function (p, i) {
      checkPoint(p, i);
      if (typeof p.bearing !== "number" || !isFinite(p.bearing)) throw new Error("Receiver " + (i + 1) + ": bearing must be a number.");
      var s = p.sigmaDeg === undefined || p.sigmaDeg === null ? sigDefault : p.sigmaDeg;
      if (!(isFinite(s) && s > 0)) throw new Error("Receiver " + (i + 1) + ": bearing error must be above 0.");
      return { name: p.name || "Receiver " + (i + 1), lat: p.lat, lon: p.lon, brg: wrap360(p.bearing + decl), sigma: s };
    });
    for (var a = 0; a < list.length; a++) for (var b = a + 1; b < list.length; b++) {
      if (distanceKm(list[a].lat, list[a].lon, list[b].lat, list[b].lon) < 1e-6) {
        throw new Error(list[a].name + " and " + list[b].name + " are at the same place.");
      }
    }
    var pairs = [], seeds = [];
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var p = intersection(list[i].lat, list[i].lon, list[i].brg, list[j].lat, list[j].lon, list[j].brg);
      var row = { a: list[i].name, b: list[j].name, point: null, cutDeg: null };
      if (p && p.distance1Km < Math.PI * R / 2) {  // more than a quarter of the way round the Earth is not a fix
        // Cut angle: the angle between the two bearing lines where they cross; near 90 deg is best, small is poor.
        var c = Math.abs(wrap180(bearingDeg(p.lat, p.lon, list[i].lat, list[i].lon) - bearingDeg(p.lat, p.lon, list[j].lat, list[j].lon)));
        row.point = { lat: p.lat, lon: p.lon };
        row.cutDeg = c > 90 ? 180 - c : c;
        seeds.push(row.point);
      }
      pairs.push(row);
    }
    if (!seeds.length) throw new Error("No two bearings cross ahead of their receivers, so there is no fix.");
    var model = function (lat, lon) {
      var r = [], W = [];
      list.forEach(function (q, k) {
        var d = distanceKm(q.lat, q.lon, lat, lon) / R;
        var s = Math.max(R * Math.sin(Math.min(d, Math.PI / 2)) * q.sigma * D2R, 1e-6);
        r.push(crossTrackKm(q.lat, q.lon, q.brg, lat, lon));
        W.push(list.map(function (_, m) { return m === k ? 1 / (s * s) : 0; }));
      });
      return { r: r, W: W };
    };
    var sol = gaussNewton(meanPoint(seeds), model);
    if (!sol) throw new Error("The bearings are too close to parallel to give a fix.");
    var warnings = [];
    var per = list.map(function (q, k) {
      var back = bearingDeg(q.lat, q.lon, sol.lat, sol.lon);
      var resid = wrap180(q.brg - back);
      if (Math.abs(resid) > 90) warnings.push(q.name + "'s bearing points away from the fix.");
      return { name: q.name, trueBearingDeg: q.brg, bearingToFixDeg: back, residualDeg: resid,
        rangeKm: distanceKm(q.lat, q.lon, sol.lat, sol.lon), crossTrackKm: sol.r[k] };
    });
    var cuts = pairs.filter(function (x) { return x.cutDeg !== null; }).map(function (x) { return x.cutDeg; });
    if (cuts.length && Math.max.apply(null, cuts) < 30) {
      warnings.push("Every pair of bearings crosses at less than 30 degrees, so the fix is stretched along the bearings.");
    }
    var e1 = ellipse(sol.cov);
    return { method: "aoa", lat: sol.lat, lon: sol.lon, cov: sol.cov, ellipse1: e1, ellipse95: scaled(e1, K95),
      chi2: sol.cost, dof: list.length - 2, receivers: per, pairs: pairs, warnings: warnings, iterations: sol.iterations };
  }

  /** TDOA fix. rx: [{lat, lon, tdoaUs}]: each receiver's arrival time in microseconds, relative to any common
   *  reference; the first receiver is the reference and the differences are taken from its value.
   *  opts.sigmaNs: each receiver's timing error, 1 sigma, in nanoseconds (default 50). */
  function tdoaFix(rx, opts) {
    opts = opts || {};
    var sigNs = opts.sigmaNs === undefined ? 50 : opts.sigmaNs;
    if (!(isFinite(sigNs) && sigNs > 0)) throw new Error("Timing error must be above 0.");
    if (!Array.isArray(rx) || rx.length < 3) throw new Error("A time-difference fix needs at least three receivers.");
    rx.forEach(function (p, i) {
      checkPoint(p, i);
      if (typeof p.tdoaUs !== "number" || !isFinite(p.tdoaUs)) throw new Error("Receiver " + (i + 1) + ": time difference must be a number.");
    });
    for (var a = 0; a < rx.length; a++) for (var b = a + 1; b < rx.length; b++) {
      if (distanceKm(rx[a].lat, rx[a].lon, rx[b].lat, rx[b].lon) < 1e-6) throw new Error("Receivers " + (a + 1) + " and " + (b + 1) + " are at the same place.");
    }
    var ref = rx[0], others = rx.slice(1), m = others.length;
    var dd = others.map(function (p) { return C_KM_US * (p.tdoaUs - ref.tdoaUs); });
    var s = C_KM_US * sigNs / 1000;  // km
    others.forEach(function (p, i) {
      // A distance difference can be at most the baseline (transmitter on the line through both, beyond one);
      // allow five standard errors of the difference for timing noise.
      var base = distanceKm(ref.lat, ref.lon, p.lat, p.lon);
      if (Math.abs(dd[i]) > base + 5 * Math.SQRT2 * s) {
        throw new Error("Receiver " + (i + 2) + ": a time difference of " + (p.tdoaUs - ref.tdoaUs) +
          " µs is more than the signal takes to cross the " + base.toFixed(2) + " km between it and receiver 1, so no place fits.");
      }
    });
    // Arrival-time errors e_i, each with variance sigma^2, give differences e_i - e_0 with covariance
    // s^2 (I + 1 1'); its inverse is (I - 1 1' / (m + 1)) / s^2 (Sherman-Morrison).
    var W = [];
    for (var i = 0; i < m; i++) { W.push([]); for (var j = 0; j < m; j++) W[i].push(((i === j ? 1 : 0) - 1 / (m + 1)) / (s * s)); }
    var model = function (lat, lon) {
      var d0 = distanceKm(ref.lat, ref.lon, lat, lon);
      return { r: others.map(function (p, k) { return distanceKm(p.lat, p.lon, lat, lon) - d0 - dd[k]; }), W: W };
    };
    // Coarse search on a 101 x 101 grid round the receivers, then refine the best local minima.
    var c0 = meanPoint(rx), ext = 20;
    rx.forEach(function (p) { ext = Math.max(ext, 3 * distanceKm(c0.lat, c0.lon, p.lat, p.lon)); });
    ext = Math.min(ext, 3000);
    var n = 101, grid = [], coslat = Math.max(Math.cos(c0.lat * D2R), 0.05);
    for (var gy = 0; gy < n; gy++) {
      grid.push([]);
      for (var gx = 0; gx < n; gx++) {
        var e = -ext + 2 * ext * gx / (n - 1), nn = -ext + 2 * ext * gy / (n - 1);
        var lat = c0.lat + nn / R * R2D, lon = wrap180(c0.lon + e / (R * coslat) * R2D);
        lat = Math.max(Math.min(lat, 89.9), -89.9);
        var mm = model(lat, lon);
        grid[gy].push({ lat: lat, lon: lon, cost: quad(mm.r, mm.W) });
      }
    }
    var minima = [];
    for (gy = 0; gy < n; gy++) for (gx = 0; gx < n; gx++) {
      var c = grid[gy][gx].cost, low = true;
      for (var dy = -1; dy <= 1 && low; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var yy = gy + dy, xx = gx + dx;
        if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
        if (grid[yy][xx].cost < c) { low = false; break; }
      }
      if (low) minima.push(grid[gy][gx]);
    }
    minima.sort(function (p, q) { return p.cost - q.cost; });
    var sols = [];
    minima.slice(0, 8).forEach(function (g) {
      var sl = gaussNewton(g, model);
      if (!sl) return;
      if (distanceKm(c0.lat, c0.lon, sl.lat, sl.lon) > 5 * ext) return;
      if (sols.some(function (o) { return distanceKm(o.lat, o.lon, sl.lat, sl.lon) < 0.01; })) return;
      sols.push(sl);
    });
    if (!sols.length) throw new Error("No position fits these time differences; check the receiver order and the signs.");
    sols.sort(function (p, q) { return p.cost - q.cost; });
    var best = sols[0];
    // Another solution "also fits" when its chi-square is within 5.99 of the best (95% for two unknowns).
    var alternates = sols.slice(1).filter(function (o) { return o.cost - best.cost < 5.99; })
      .map(function (o) { return { lat: o.lat, lon: o.lon, chi2: o.cost }; });
    var warnings = [];
    if (alternates.length) {
      warnings.push("More than one position fits the time differences equally well. Add a receiver to tell them apart.");
    }
    var d0 = distanceKm(ref.lat, ref.lon, best.lat, best.lon);
    var per = rx.map(function (p, k) {
      var dist = distanceKm(p.lat, p.lon, best.lat, best.lon);
      return { name: p.name || "Receiver " + (k + 1), rangeKm: dist, measuredUs: p.tdoaUs - ref.tdoaUs,
        fittedUs: (dist - d0) / C_KM_US, residualNs: k === 0 ? 0 : best.r[k - 1] / C_KM_US * 1000 };
    });
    var e1 = ellipse(best.cov);
    return { method: "tdoa", lat: best.lat, lon: best.lon, cov: best.cov, ellipse1: e1, ellipse95: scaled(e1, K95),
      chi2: best.cost, dof: m - 2, receivers: per, alternates: alternates, warnings: warnings, iterations: best.iterations };
  }

  /** What perfect receivers would measure from a transmitter at (lat, lon): true bearings, and arrival times
   *  relative to the first receiver in microseconds. */
  function simulate(emitter, rx) {
    var d0 = distanceKm(rx[0].lat, rx[0].lon, emitter.lat, emitter.lon);
    return rx.map(function (p) {
      return { lat: p.lat, lon: p.lon, name: p.name, bearing: bearingDeg(p.lat, p.lon, emitter.lat, emitter.lon),
        tdoaUs: (distanceKm(p.lat, p.lon, emitter.lat, emitter.lon) - d0) / C_KM_US };
    });
  }

  /** Points along a great circle, longitudes kept continuous for drawing on a map. */
  function gcPath(lat, lon, brngDeg, distKm, steps) {
    steps = steps || 64;
    var out = [], prev = null;
    for (var i = 0; i <= steps; i++) {
      var p = destination(lat, lon, brngDeg, distKm * i / steps), L = p.lon;
      if (prev !== null) { while (L - prev > 180) L -= 360; while (L - prev < -180) L += 360; }
      out.push([p.lat, L]); prev = L;
    }
    return out;
  }
  /** Outline of an ellipse (semi-axes in km, major axis on bearing orientDeg) round a centre. */
  function ellipsePath(lat, lon, e, steps) {
    steps = steps || 72;
    var out = [], prev = null;
    for (var i = 0; i <= steps; i++) {
      var t = 2 * Math.PI * i / steps;
      var u = e.majorKm * Math.cos(t), v = e.minorKm * Math.sin(t);           // along and across the major axis
      var o = e.orientDeg * D2R;
      var east = u * Math.sin(o) + v * Math.cos(o), north = u * Math.cos(o) - v * Math.sin(o);
      var p = destination(lat, lon, Math.atan2(east, north) * R2D, Math.sqrt(east * east + north * north)), L = p.lon;
      if (prev !== null) { while (L - prev > 180) L -= 360; while (L - prev < -180) L += 360; }
      out.push([p.lat, L]); prev = L;
    }
    return out;
  }

  return { R: R, C_KM_US: C_KM_US, K95: K95, distanceKm: distanceKm, bearingDeg: bearingDeg, destination: destination,
    intersection: intersection, crossTrackKm: crossTrackKm, meanPoint: meanPoint, ellipse: ellipse,
    aoaFix: aoaFix, tdoaFix: tdoaFix, simulate: simulate, gcPath: gcPath, ellipsePath: ellipsePath };
});
