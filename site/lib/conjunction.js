/* Conjunction screening: when two objects in orbit pass closest to each other in a time window, how close
   (the miss distance), and how fast they pass. No DOM, no network, no orbit propagator: the caller passes
   propA(ms) and propB(ms), functions that return {position, velocity} in one inertial frame (km, km/s; TEME from
   SGP4) or something falsy when they fail, so the search can be tested with made-up motions.
   Method: sample the separation every stepS seconds; every sample lower than both neighbours brackets a local
   minimum between the neighbours, which a golden-section search narrows to tolS (Press et al., Numerical Recipes,
   3rd ed., section 10.2). A minimum at either end of the window is narrowed within its one step; if it stays on the
   window's edge (the objects are separating at the start or closing at the end) it is listed apart, under edges,
   since the true closest approach lies outside the window. Sampling alone (the separation at whole steps) can miss the
   true miss distance badly: two low orbits crossing at about 10 km/s move about 600 km relative to each other per
   minute. Bracketing the minima and refining them is the approach of Alfano and Negron, "Determining satellite close
   approaches", Journal of the Astronautical Sciences 41(2), 1993, here with a simpler one-dimensional search.
   The miss vector is also given in the radial, along-track and cross-track frame of object A (RSW in Vallado
   section 3.3; RTN in the CCSDS Conjunction Data Message): R along A's position, W (cross-track) along A's orbital
   angular momentum r x v, S (along-track) = W x R.
   Limit, stated plainly: with element sets and SGP4 the positions themselves are uncertain by about a kilometre at
   the element set's epoch, growing by one to a few kilometres a day, so the miss distance is a screening figure with
   kilometre-level error. It is not a probability of collision, which needs each object's position covariance and
   size, as in a Conjunction Data Message. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).conjunction = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var GOLD = (Math.sqrt(5) - 1) / 2;

  function finite3(v) { return !!v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z); }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
  function unit(a) { var n = norm(a); return { x: a.x / n, y: a.y / n, z: a.z / n }; }

  /** Separation in km at ms, or NaN when either propagator fails. */
  function separation(propA, propB, ms) {
    var a = propA(ms), b = propB(ms);
    if (!a || !b || !finite3(a.position) || !finite3(b.position)) return NaN;
    return norm(sub(b.position, a.position));
  }

  /** Components of vector d in object A's radial / along-track / cross-track frame. */
  function rsw(rA, vA, d) {
    var R = unit(rA), W = unit(cross(rA, vA)), S = cross(W, R);
    return { radialKm: dot(d, R), alongTrackKm: dot(d, S), crossTrackKm: dot(d, W) };
  }

  /** The full picture at one time: miss vector, distance, relative velocity, speed, and the RSW components. */
  function stateAt(propA, propB, ms) {
    var a = propA(ms), b = propB(ms);
    if (!a || !b || !finite3(a.position) || !finite3(b.position)) return null;
    var d = sub(b.position, a.position);
    var out = { ms: ms, missKm: norm(d), relSpeedKmS: NaN, radialKm: NaN, alongTrackKm: NaN, crossTrackKm: NaN, approachAngleDeg: NaN };
    if (finite3(a.velocity) && finite3(b.velocity)) {
      var dv = sub(b.velocity, a.velocity);
      out.relSpeedKmS = norm(dv);
      var c = rsw(a.position, a.velocity, d);
      out.radialKm = c.radialKm; out.alongTrackKm = c.alongTrackKm; out.crossTrackKm = c.crossTrackKm;
      var na = norm(a.velocity), nb = norm(b.velocity);
      // Angle between the two velocity vectors: near 0 for objects flying together, near 180 for head-on.
      if (na > 0 && nb > 0) out.approachAngleDeg = Math.acos(Math.max(-1, Math.min(1, dot(a.velocity, b.velocity) / (na * nb)))) * 180 / Math.PI;
    }
    return out;
  }

  /** Golden-section search for the smallest separation in [lo, hi] (ms), to within tol ms. */
  function refine(propA, propB, lo, hi, tol) {
    var f = function (t) { var d = separation(propA, propB, t); return isFinite(d) ? d : Infinity; };
    var x1 = hi - GOLD * (hi - lo), x2 = lo + GOLD * (hi - lo), f1 = f(x1), f2 = f(x2);
    while (hi - lo > tol) {
      if (f1 <= f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - GOLD * (hi - lo); f1 = f(x1); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + GOLD * (hi - lo); f2 = f(x2); }
    }
    // The ends of the bracket can be lower than the interior when the minimum sits on an end.
    var cands = [lo, (lo + hi) / 2, hi];
    var best = cands[0], bestF = f(best);
    for (var i = 1; i < cands.length; i++) { var v = f(cands[i]); if (v < bestF) { bestF = v; best = cands[i]; } }
    return best;
  }

  /** Every local minimum of the separation between startMs and endMs. opts: stepS (60), tolS (0.001),
   *  thresholdKm (screening distance, default 10), maxSamples (200000). Returns {approaches, closest, edges,
   *  samples, failedSamples}: approaches are the closest approaches inside the window, in time order, each
   *  stateAt(...) plus {inside} (miss distance within the screening distance); closest is the one with the
   *  smallest miss distance, or null; edges holds the separation at a window end where the objects are separating
   *  (start) or closing (end), each with {atStart}. */
  function closeApproaches(propA, propB, startMs, endMs, opts) {
    opts = opts || {};
    if (typeof propA !== "function" || typeof propB !== "function") throw new Error("Both propagators must be functions of time.");
    if (!(isFinite(startMs) && isFinite(endMs) && endMs > startMs)) throw new Error("The end of the window must be after its start.");
    var step = (opts.stepS === undefined ? 60 : opts.stepS) * 1000;
    var tol = (opts.tolS === undefined ? 0.001 : opts.tolS) * 1000;
    var thr = opts.thresholdKm === undefined ? 10 : opts.thresholdKm;
    if (!(step > 0)) throw new Error("The step must be greater than zero.");
    if (!(tol > 0)) throw new Error("The tolerance must be greater than zero.");
    if (!(thr >= 0)) throw new Error("The screening distance must be zero or more.");
    var n = Math.ceil((endMs - startMs) / step);
    if (n + 1 > (opts.maxSamples || 200000)) throw new Error("That needs " + (n + 1) + " samples; lengthen the step or shorten the window.");
    var ts = [], ds = [];
    for (var i = 0; i <= n; i++) {
      var t = Math.min(startMs + i * step, endMs);
      ts.push(t); ds.push(separation(propA, propB, t));
    }
    var out = [], edges = [];
    for (var k = 0; k <= n; k++) {
      if (!isFinite(ds[k])) continue;
      var left = k > 0 ? ds[k - 1] : NaN, right = k < n ? ds[k + 1] : NaN;
      var lo, hi, edge = false;
      if (k === 0) {
        if (!(n >= 1 && isFinite(right) && ds[k] < right)) continue;
        lo = ts[0]; hi = ts[1]; edge = true;
      } else if (k === n) {
        if (!(isFinite(left) && ds[k] < left)) continue;
        lo = ts[n - 1]; hi = ts[n]; edge = true;
      } else {
        if (!(isFinite(left) && isFinite(right) && ds[k] <= left && ds[k] < right)) continue;
        lo = ts[k - 1]; hi = ts[k + 1];
      }
      var tca = refine(propA, propB, lo, hi, tol);
      var st = stateAt(propA, propB, tca);
      if (!st) continue;
      st.inside = st.missKm <= thr;
      // An end-of-window minimum is a real closest approach only if the refined time moved off the window's edge.
      if (edge && (Math.abs(tca - startMs) <= tol || Math.abs(tca - endMs) <= tol)) {
        st.atStart = k === 0;
        edges.push(st);
        continue;
      }
      if (out.length && Math.abs(out[out.length - 1].ms - st.ms) <= tol) continue;   // the same minimum found twice
      out.push(st);
    }
    var closest = null;
    out.forEach(function (a) { if (!closest || a.missKm < closest.missKm) closest = a; });
    return { approaches: out, closest: closest, edges: edges, samples: n + 1, failedSamples: ds.filter(function (d) { return !isFinite(d); }).length };
  }

  return { closeApproaches: closeApproaches, separation: separation, stateAt: stateAt, rsw: rsw, refine: refine };
});
