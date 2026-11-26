/* Radio and optical horizon, line-of-sight range between two antennas, the first Fresnel zone and the Earth bulge,
   over a smooth Earth (no terrain). Pure functions: no DOM, no network.
   - Effective Earth radius: refraction bends a ray slightly back toward the ground. The standard model replaces the
     Earth's radius R by an effective radius a = k R and draws rays straight. k = 4/3 is the standard figure for radio
     waves in an average atmosphere, where refractivity falls by about 40 N-units per km of height (ITU-R P.453 and
     P.834; used for path profiles in ITU-R P.452 and P.526). For light, a refraction coefficient of about 1/7
     (surveyors use 0.13 to 0.14) gives k = 1 / (1 - 1/7) = 7/6. k = 1 is the bare geometric Earth.
     R = 6,371 km, the IUGG mean radius.
   - Horizon distance for an antenna h above the surface: d = sqrt(2 a h) (the tangent length; the exact form
     sqrt(2 a h + h^2) differs by less than 0.003 % below 1 km). With h in metres and d in km this is
     C sqrt(h), C = sqrt(2 k R) / 1000: 4.12 for k = 4/3 (the familiar radio-horizon rule), 3.86 for k = 7/6 and
     3.57 for k = 1.
   - Maximum line-of-sight range between heights h1 and h2: d1 + d2, the two horizons added.
   - Earth bulge, the height of the effective Earth's surface above the straight chord between the two ends, at a
     point d1 from one end and d2 from the other: b = d1 d2 / (2 a) (the effective-Earth curvature term of the
     ITU-R P.452 and P.526 path profiles). With d in km and b in m: b = d1 d2 / (12.742 k), about d1 d2 / 17 for k = 4/3.
   - First Fresnel zone radius at that point, for wavelength lambda = c / f: r1 = sqrt(lambda d1 d2 / d)
     (ITU-R P.530 and P.526): with d in km, f in GHz and r in m, r1 = 17.31 sqrt(d1 d2 / (f d)), usually
     rounded to 17.3 or 17.32 (17.32 = sqrt(300) takes c as 3e8 m/s; this file uses the exact speed of light).
     The n-th zone is sqrt(n) times larger. Keeping 0.6 r1 clear of obstacles leaves the diffraction loss near
     0 dB (ITU-R P.526 knife-edge: a clearance of 0.6 r1 gives v = -0.85, where the loss is about 0 dB).
   - Sight-line height above the smooth surface at distance x along a path of length D:
     c(x) = h1 + (h2 - h1) x / D - x (D - x) / (2 a). The ends see each other when c(x) >= 0 everywhere; for
     D = d1 + d2 the minimum is exactly 0, at the first antenna's horizon, so this agrees with the horizon sum. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).radioHorizon = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH_M = 6371000;       // m, IUGG mean radius
  var C_M_S = 299792458;         // m/s, speed of light (exact)
  var K = { radio: 4 / 3, optical: 7 / 6, geometric: 1 };

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function needK(k) {
    if (!isNum(k) || !(k > 0)) throw new Error("The refraction factor k must be a number above 0.");
    if (k > 100) throw new Error("k above 100 is not a meaningful refraction factor.");
  }
  function needHeight(h, what) {
    if (!isNum(h)) throw new Error((what || "Height") + " must be a number.");
    if (h < 0) throw new Error((what || "Height") + " must be zero or more.");
  }

  /** Effective Earth radius, m. */
  function effectiveRadiusM(k) { needK(k); return k * R_EARTH_M; }

  /** Horizon distance, km, for an antenna hM metres above the smooth surface: sqrt(2 k R h). */
  function horizonKm(hM, k) {
    needHeight(hM); needK(k);
    return Math.sqrt(2 * k * R_EARTH_M * hM) / 1000;
  }

  /** The C in "d (km) = C sqrt(h in m)" for refraction factor k: 4.12 for 4/3, 3.86 for 7/6, 3.57 for 1. */
  function ruleCoefficient(k) { needK(k); return Math.sqrt(2 * k * R_EARTH_M) / 1000; }

  /** Longest line-of-sight distance between heights h1 and h2 (m) over a smooth Earth, km. */
  function maxLosKm(h1, h2, k) { return horizonKm(h1, k) + horizonKm(h2, k); }

  /** Earth bulge above the chord, m, at d1 km from one end and d2 km from the other. */
  function bulgeM(d1Km, d2Km, k) {
    if (!isNum(d1Km) || !isNum(d2Km) || d1Km < 0 || d2Km < 0) throw new Error("Distances must be zero or more.");
    needK(k);
    return (d1Km * 1000) * (d2Km * 1000) / (2 * k * R_EARTH_M);
  }

  /** n-th Fresnel zone radius, m, at d1 km from one end and d2 km from the other, frequency fGHz. */
  function fresnelRadiusM(d1Km, d2Km, fGHz, n) {
    n = n === undefined ? 1 : n;
    if (!isNum(d1Km) || !isNum(d2Km) || d1Km < 0 || d2Km < 0) throw new Error("Distances must be zero or more.");
    if (!(d1Km + d2Km > 0)) throw new Error("The path must be longer than 0 km.");
    if (!isNum(fGHz) || !(fGHz > 0)) throw new Error("Frequency must be a number above 0 GHz.");
    if (!isNum(n) || !(n >= 1) || Math.floor(n) !== n) throw new Error("The zone number must be a whole number from 1.");
    var lambda = C_M_S / (fGHz * 1e9);
    var d1 = d1Km * 1000, d2 = d2Km * 1000;
    return Math.sqrt(n * lambda * d1 * d2 / (d1 + d2));
  }

  /** Height of the straight line between the two antenna tops above the smooth effective Earth, m, at xKm along a
   *  path of DKm, antennas h1 (at x = 0) and h2 (at x = D) metres above the surface. Negative: below the surface. */
  function clearanceM(xKm, DKm, h1, h2, k) {
    var x = xKm * 1000, D = DKm * 1000;
    return h1 + (h2 - h1) * x / D - x * (D - x) / (2 * k * R_EARTH_M);
  }

  /** Smallest value of f over [0, D] (km), by a dense scan and a golden-section refinement. f is smooth. */
  function minimise(f, DKm) {
    var N = 400, best = 0, bestV = f(0);
    for (var i = 1; i <= N; i++) {
      var v = f(DKm * i / N);
      if (v < bestV) { bestV = v; best = i; }
    }
    var lo = DKm * Math.max(0, best - 1) / N, hi = DKm * Math.min(N, best + 1) / N, g = (Math.sqrt(5) - 1) / 2;
    var a = hi - g * (hi - lo), b = lo + g * (hi - lo), fa = f(a), fb = f(b);
    for (var j = 0; j < 80; j++) {
      if (fa < fb) { hi = b; b = a; fb = fa; a = hi - g * (hi - lo); fa = f(a); }
      else { lo = a; a = b; fa = fb; b = lo + g * (hi - lo); fb = f(b); }
    }
    var x = (lo + hi) / 2, vx = f(x);
    return vx < bestV ? { xKm: x, value: vx } : { xKm: DKm * best / N, value: bestV };
  }

  /** Can antennas h1 and h2 (m) see each other DKm apart, with refraction factor k, and (when fGHz is given) is 60 %
   *  of the first Fresnel zone clear of the smooth surface? Returns the figures the page shows. */
  function path(h1, h2, DKm, k, fGHz) {
    needHeight(h1, "Height A"); needHeight(h2, "Height B"); needK(k);
    if (!isNum(DKm) || !(DKm > 0)) throw new Error("The distance between the two must be more than 0 km.");
    var a = k * R_EARTH_M, D = DKm * 1000;
    var dA = horizonKm(h1, k), dB = horizonKm(h2, k);
    var m = minimise(function (x) { return clearanceM(x, DKm, h1, h2, k); }, DKm);
    // Height needed at one end to see the other over a smooth Earth: (D - other end's horizon)^2 / (2 a).
    function needed(dOther) { return D <= dOther * 1000 ? 0 : Math.pow(D - dOther * 1000, 2) / (2 * a); }
    var out = {
      distanceKm: DKm, k: k, horizonAKm: dA, horizonBKm: dB, maxLosKm: dA + dB,
      visible: m.value >= -1e-9,
      minClearanceM: m.value, minClearanceAtKm: m.xKm,
      midBulgeM: bulgeM(DKm / 2, DKm / 2, k),
      heightNeededAtBM: needed(dA), heightNeededAtAM: needed(dB),
      extraHeightAtBM: Math.max(0, needed(dA) - h2), extraHeightAtAM: Math.max(0, needed(dB) - h1)
    };
    if (fGHz !== undefined && fGHz !== null) {
      fresnelRadiusM(DKm / 2, DKm / 2, fGHz);  // validates the frequency
      var margin = function (hb) {
        return minimise(function (x) {
          return clearanceM(x, DKm, h1, hb, k) - 0.6 * fresnelRadiusM(x, DKm - x, fGHz);
        }, DKm);
      };
      var fm = margin(h2);
      out.frequencyGHz = fGHz;
      out.midFresnelM = fresnelRadiusM(DKm / 2, DKm / 2, fGHz);
      out.fresnel60Clear = fm.value >= -1e-9;
      out.fresnelMarginM = fm.value;            // least (clearance - 0.6 r1) along the path
      out.fresnelMarginAtKm = fm.xKm;
      // Height at B for 60 % clearance, by bisection (the margin grows with B's height).
      if (out.fresnel60Clear) out.heightForFresnelAtBM = null;
      else {
        var lo = h2, hi = Math.max(1, h2);
        while (margin(hi).value < 0 && hi < 1e7) hi *= 2;
        for (var i = 0; i < 60; i++) { var mid = (lo + hi) / 2; if (margin(mid).value < 0) lo = mid; else hi = mid; }
        out.heightForFresnelAtBM = hi;
      }
    }
    return out;
  }

  /** Everything at one point dKm from A on a path of DKm: bulge, sight-line height, Fresnel radius and clearance. */
  function atPoint(h1, h2, DKm, xKm, k, fGHz) {
    needHeight(h1, "Height A"); needHeight(h2, "Height B"); needK(k);
    if (!isNum(DKm) || !(DKm > 0)) throw new Error("The distance between the two must be more than 0 km.");
    if (!isNum(xKm) || xKm < 0 || xKm > DKm) throw new Error("The point must lie on the path, from 0 to " + DKm + " km from A.");
    var out = { xKm: xKm, bulgeM: bulgeM(xKm, DKm - xKm, k), sightLineM: clearanceM(xKm, DKm, h1, h2, k) };
    out.chordHeightM = out.sightLineM + out.bulgeM;   // the straight line's height above the chord between the feet
    if (fGHz !== undefined && fGHz !== null) {
      out.fresnelM = fresnelRadiusM(xKm, DKm - xKm, fGHz);
      out.fresnel60M = 0.6 * out.fresnelM;
      out.clearanceRatio = out.fresnelM > 0 ? out.sightLineM / out.fresnelM : null;   // clearance in units of r1
    }
    return out;
  }

  return { R_EARTH_M: R_EARTH_M, C_M_S: C_M_S, K: K, effectiveRadiusM: effectiveRadiusM, horizonKm: horizonKm,
    ruleCoefficient: ruleCoefficient, maxLosKm: maxLosKm, bulgeM: bulgeM, fresnelRadiusM: fresnelRadiusM,
    clearanceM: clearanceM, path: path, atPoint: atPoint };
});
