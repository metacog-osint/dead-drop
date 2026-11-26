/* Delta-v budget for a transfer between two circular orbits, with an inclination change, and the propellant it
   takes. References:
   - Hohmann transfer: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., section 6.3 (coplanar maneuvers,
     Example 6-1); Curtis, Orbital Mechanics for Engineering Students, chapter 6 (Hohmann transfer).
   - Plane change and combined maneuvers: Vallado section 6.4 (noncoplanar transfers: inclination-only and combined changes, and the
     minimum-delta-v split of the plane change between the two burns); Curtis chapter 6 (plane change maneuvers).
     A burn that changes speed from va to vb and turns the orbit plane by d at the same time costs
       dv = sqrt(va^2 + vb^2 - 2 va vb cos d)      (law of cosines on the two velocity vectors)
     which is never more than doing the two separately, and is cheapest where the speed is lowest.
   - Rocket equation (Tsiolkovsky): m_final = m_initial * exp(-dv / (Isp * g0)), g0 = 9.80665 m/s^2.
   Assumes both orbits share the line where the planes cross (the burns are made there); circular orbits only. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).deltaV = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MU = 398600.4418;     // km^3/s^2
  var G0 = 9.80665;         // m/s^2, standard gravity (exact)
  var R_EARTH = 6378.137;   // km, WGS 84 equatorial radius: orbits must be above it
  var D2R = Math.PI / 180;

  function combined(va, vb, dRad) {
    return Math.sqrt(Math.max(0, va * va + vb * vb - 2 * va * vb * Math.cos(dRad)));
  }

  /** Mass left and propellant used for a delta-v (km/s), wet mass (kg) and specific impulse (s). */
  function rocket(dvKmS, wetMassKg, ispS) {
    if (!(wetMassKg > 0) || !(ispS > 0)) throw new Error("Wet mass and specific impulse must be above zero.");
    var ve = ispS * G0 / 1000;              // km/s, effective exhaust velocity
    var ratio = Math.exp(dvKmS / ve);       // m_initial / m_final
    var final = wetMassKg / ratio;
    return { exhaustVelocityKmS: ve, massRatio: ratio, finalMassKg: final, propellantKg: wetMassKg - final,
      propellantFraction: 1 - 1 / ratio };
  }

  /** Smallest f(s) for s in [0, d]: a coarse scan (the endpoints included), then golden-section refinement. */
  function minimise(f, d) {
    var n = 180, best = 0, bestF = f(0);
    for (var k = 1; k <= n; k++) { var s = d * k / n, v = f(s); if (v < bestF) { bestF = v; best = s; } }
    var lo = Math.max(0, best - d / n), hi = Math.min(d, best + d / n), g = (Math.sqrt(5) - 1) / 2;
    var x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = f(x1), f2 = f(x2);
    for (var it = 0; it < 80; it++) {
      if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = f(x1); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = f(x2); }
    }
    var xm = (lo + hi) / 2, fm = f(xm);
    return fm < bestF ? { s: xm, f: fm } : { s: best, f: bestF };
  }

  /** p: {r1, r2 (km, orbit radii), i1, i2 (deg), wetMass (kg), isp (s), oneBurn (bool)}. */
  function compute(p) {
    var r1 = p.r1, r2 = p.r2;
    if (![r1, r2, p.i1, p.i2].every(isFinite)) throw new Error("Every orbit input must be a number.");
    if (r1 <= R_EARTH || r2 <= R_EARTH) throw new Error("Both orbit radii must be above the Earth's radius, 6,378 km.");
    if (r1 > 1e7 || r2 > 1e7) throw new Error("Orbit radii must be under 10,000,000 km.");
    if (p.i1 < 0 || p.i1 > 180 || p.i2 < 0 || p.i2 > 180) throw new Error("Inclinations must be between 0 and 180 degrees.");
    var di = Math.abs(p.i2 - p.i1) * D2R;
    var at = (r1 + r2) / 2;                                    // transfer ellipse semi-major axis
    var v1 = Math.sqrt(MU / r1), v2 = Math.sqrt(MU / r2);      // circular speeds
    var vta = Math.sqrt(MU * (2 / r1 - 1 / at));               // transfer orbit speed at r1
    var vtb = Math.sqrt(MU * (2 / r2 - 1 / at));               // transfer orbit speed at r2
    var dv1 = Math.abs(vta - v1), dv2 = Math.abs(v2 - vtb);
    var out = {
      planeChangeDeg: di / D2R,
      circularSpeed1: v1, circularSpeed2: v2, transferSpeed1: vta, transferSpeed2: vtb,
      transferSmaKm: at,
      transferTimeH: Math.PI * Math.sqrt(at * at * at / MU) / 3600,   // half the transfer orbit's period
      hohmann: { burn1: dv1, burn2: dv2, total: dv1 + dv2 }
    };
    if (p.oneBurn) {
      // One burn at r1 that puts the far side of the orbit at r2 (a deorbit or perigee change), plane change in it.
      var b = combined(v1, vta, di);
      out.oneBurn = { burn1: b, total: b };
      out.best = { name: "One burn, plane change included", burn1: b, burn2: 0, total: b, planeAtStartDeg: di / D2R };
    } else {
      // Plane change on its own, at the larger of the two circular orbits (where it is cheapest when done alone).
      var vHigh = Math.min(v1, v2);
      var alone = 2 * vHigh * Math.sin(di / 2);
      out.separate = { burn1: dv1, burn2: dv2, planeChange: alone, total: dv1 + dv2 + alone };
      // All of the plane change folded into the burn at the larger radius (the slower point).
      var outerIsEnd = r2 >= r1;
      var c1 = outerIsEnd ? dv1 : combined(v1, vta, di), c2 = outerIsEnd ? combined(vtb, v2, di) : dv2;
      out.combinedAtOuter = { burn1: c1, burn2: c2, total: c1 + c2, planeAtStartDeg: outerIsEnd ? 0 : di / D2R };
      // The cheapest split of the plane change between the two burns.
      var m = minimise(function (s) { return combined(v1, vta, s) + combined(vtb, v2, di - s); }, di);
      var o1 = combined(v1, vta, m.s), o2 = combined(vtb, v2, di - m.s);
      out.optimal = { burn1: o1, burn2: o2, total: o1 + o2, planeAtStartDeg: m.s / D2R, planeAtEndDeg: (di - m.s) / D2R };
      out.best = { name: "Plane change split for the least delta-v", burn1: o1, burn2: o2, total: o1 + o2,
        planeAtStartDeg: m.s / D2R };
    }
    if (p.wetMass !== undefined || p.isp !== undefined) out.propellant = rocket(out.best.total, p.wetMass, p.isp);
    return out;
  }

  return { compute: compute, rocket: rocket, combined: combined, MU: MU, G0: G0, R_EARTH: R_EARTH };
});
