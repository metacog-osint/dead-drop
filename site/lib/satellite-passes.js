/* Finding a satellite's passes over an observer: when it rises above a horizon mask, when it is highest, when it
   sets. No DOM, no network, no propagator: the caller passes look(ms), a function that returns at least
   {elDeg, azDeg} for a time (or null when the propagator fails), so the search can be tested with any made-up orbit.
   Method: step through the window at a fixed interval (30 s by default); where the elevation crosses the mask
   between two steps, bisect to the crossing (to 0.5 s by default); refine the highest point with a golden-section
   search around the highest step. This is the usual root-bracketing approach for rise and set times (Vallado,
   Fundamentals of Astrodynamics and Applications, 4th ed., section 11.4, and Montenbruck & Pfleger, Astronomy on the
   Personal Computer, section 3.3). Limit: a pass that rises above the mask and falls back within one step can be
   missed; with a 30 s step that is only a pass that grazes the mask. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).satellitePasses = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var GOLD = (Math.sqrt(5) - 1) / 2;

  function elAt(look, ms) {
    var v = look(ms);
    return v && isFinite(v.elDeg) ? v : null;
  }

  /** Bisects between t0 (where above(t0) === a0) and t1 (the other side) to within tol ms. */
  function bisect(look, t0, t1, mask, a0, tol) {
    while (t1 - t0 > tol) {
      var mid = (t0 + t1) / 2, v = elAt(look, mid);
      if (!v) break;
      if ((v.elDeg >= mask) === a0) t0 = mid; else t1 = mid;
    }
    return (t0 + t1) / 2;
  }

  /** Golden-section search for the highest elevation in [lo, hi]. */
  function peakIn(look, lo, hi, tol) {
    var x1 = hi - GOLD * (hi - lo), x2 = lo + GOLD * (hi - lo);
    var f1 = elAt(look, x1), f2 = elAt(look, x2);
    while (hi - lo > tol && f1 && f2) {
      if (f1.elDeg < f2.elDeg) { lo = x1; x1 = x2; f1 = f2; x2 = lo + GOLD * (hi - lo); f2 = elAt(look, x2); }
      else { hi = x2; x2 = x1; f2 = f1; x1 = hi - GOLD * (hi - lo); f1 = elAt(look, x1); }
    }
    var t = (lo + hi) / 2;
    return { ms: t, look: elAt(look, t) };
  }

  /** Passes between startMs and endMs. opts: stepS (30), maskDeg (0, the elevation that counts as rising and
   *  setting), minPeakDeg (0, drop passes that never get this high), tolS (0.5), maxPasses (1000).
   *  Each pass: {riseMs, riseAzDeg, peakMs, peakElDeg, peakAzDeg, setMs, setAzDeg, durationS,
   *  startsInProgress, endsInProgress} (the flags mark a pass already up at the start or still up at the end, whose
   *  rise or set time is then the window's edge). */
  function findPasses(look, startMs, endMs, opts) {
    opts = opts || {};
    if (typeof look !== "function") throw new Error("look must be a function of time.");
    if (!(isFinite(startMs) && isFinite(endMs) && endMs > startMs)) throw new Error("The end of the window must be after its start.");
    var step = (opts.stepS || 30) * 1000, mask = opts.maskDeg || 0, minPeak = isFinite(opts.minPeakDeg) ? opts.minPeakDeg : -90;
    var tol = (opts.tolS || 0.5) * 1000, maxPasses = opts.maxPasses || 1000;
    if (!(step > 0)) throw new Error("The step must be greater than zero.");
    var passes = [], cur = null, prevT = null;
    var bestT = null, bestEl = -Infinity;

    function close(setMs, endsInProgress) {
      var lo = Math.max(cur.riseMs, bestT - step), hi = Math.min(setMs, bestT + step);
      var pk = hi > lo ? peakIn(look, lo, hi, tol) : { ms: bestT, look: elAt(look, bestT) };
      var peak = pk.look && pk.look.elDeg >= bestEl ? pk : { ms: bestT, look: elAt(look, bestT) };
      var setLook = elAt(look, setMs);
      var p = {
        riseMs: cur.riseMs, riseAzDeg: cur.riseAz,
        peakMs: peak.ms, peakElDeg: peak.look ? peak.look.elDeg : bestEl, peakAzDeg: peak.look ? peak.look.azDeg : NaN,
        setMs: setMs, setAzDeg: setLook ? setLook.azDeg : NaN,
        durationS: (setMs - cur.riseMs) / 1000,
        startsInProgress: cur.startsInProgress, endsInProgress: endsInProgress
      };
      if (p.peakElDeg >= minPeak) passes.push(p);
      cur = null; bestEl = -Infinity; bestT = null;
    }

    var t = startMs;
    while (passes.length < maxPasses) {
      var v = elAt(look, t);
      if (!v) {
        if (cur) close(prevT, true);          // the propagator failed: end the pass at the last good time
        prevT = null;
      } else {
        var up = v.elDeg >= mask;
        if (up && !cur) {
          var rise = (prevT === null) ? t : bisect(look, prevT, t, mask, false, tol);
          var rl = elAt(look, rise);
          cur = { riseMs: rise, riseAz: rl ? rl.azDeg : v.azDeg, startsInProgress: prevT === null };
        }
        if (up && v.elDeg > bestEl) { bestEl = v.elDeg; bestT = t; }
        if (!up && cur) close(bisect(look, prevT, t, mask, true, tol), false);
        prevT = t;
      }
      if (t >= endMs) break;
      t = Math.min(t + step, endMs);
    }
    if (cur) close(prevT === null ? endMs : Math.min(prevT, endMs), true);
    return passes;
  }

  /** Samples a pass every stepS seconds from rise to set (both ends included). */
  function samplePass(look, pass, stepS) {
    var step = (stepS || 30) * 1000, out = [];
    for (var t = pass.riseMs; t < pass.setMs; t += step) { var v = look(t); if (v) out.push(v); }
    var last = look(pass.setMs);
    if (last) out.push(last);
    return out;
  }

  /** The part of a pass during which look(ms).visible is true, sampled every stepS seconds:
   *  {firstMs, lastMs, maxElDeg} or null when no sample is visible. */
  function visibleWindow(look, pass, stepS) {
    var step = (stepS || 30) * 1000, first = null, last = null, maxEl = -Infinity;
    var t = pass.riseMs;
    while (true) {
      var v = look(t);
      if (v && v.visible) { if (first === null) first = t; last = t; if (v.elDeg > maxEl) maxEl = v.elDeg; }
      if (t >= pass.setMs) break;
      t = Math.min(t + step, pass.setMs);
    }
    return first === null ? null : { firstMs: first, lastMs: last, maxElDeg: maxEl };
  }

  return { findPasses: findPasses, samplePass: samplePass, visibleWindow: visibleWindow };
});
