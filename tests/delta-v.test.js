// Delta-V Mission Planner. References: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., section 6.3
// (Hohmann transfer, Example 6-1) and section 6.4 (plane changes and combined maneuvers); Curtis, Orbital Mechanics
// for Engineering Students, chapter 6; Tsiolkovsky's rocket equation with g0 = 9.80665 m/s^2.
// Worked example: Vallado Example 6-1, LEO at 191.34411 km altitude to GEO at 35781.34857 km (R = 6378.137 km):
//   r1 = 6569.4811 km, r2 = 42159.4856 km, a_t = 24364.4833 km, mu = 398600.4418
//   v1 = 7.789388, v_ta = v1 sqrt(2 - r1/a_t) = 10.246426  -> dv_a = 2.457038 km/s   (Vallado: 2.457)
//   v2 = 3.074831, v_tb = v_ta r1/r2 = 1.596644           -> dv_b = 1.478187 km/s   (Vallado: 1.478)
//   total 3.935225 km/s (Vallado: 3.935); transfer time pi sqrt(a_t^3/mu) = 18924 s = 5.2567 h (Vallado: 5.256 h)
// With a 28.5 deg plane change (a Cape Canaveral launch to GEO), done by hand:
//   all of it folded into the apogee burn: dv_b = sqrt(1.596644^2 + 3.074831^2 - 2*1.596644*3.074831*cos 28.5)
//     = sqrt(2.549272 + 9.454585 - 8.628947) = 1.837093; total 2.457038 + 1.837093 = 4.294131 km/s
//   done on its own at GEO after circularising: 2 * 3.074831 * sin(14.25 deg) = 1.513760; total 5.448985 km/s
// Pure plane change at r = 6921 km, 51.6 to 28.5 deg: v = 7.588998, dv = 2 v sin(11.55 deg) = 3.038992 km/s.
// Rocket: dv 3.935225 km/s, Isp 300 s: ve = 2.941995 km/s, ratio e^1.337604 = 3.809904,
//   1000 kg wet leaves 262.474 kg and burns 737.526 kg. dv = ve ln 2 halves the mass.
const test = require("node:test");
const assert = require("node:assert/strict");
const DV = require("../site/lib/delta-v.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const LEO = 6378.137 + 191.34411, GEO = 6378.137 + 35781.34857;

test("Hohmann: Vallado Example 6-1, LEO to GEO", () => {
  const r = DV.compute({ r1: LEO, r2: GEO, i1: 0, i2: 0 });
  near(r.hohmann.burn1, 2.457038, 2e-5, "burn 1");
  near(r.hohmann.burn2, 1.478187, 2e-5, "burn 2");
  near(r.hohmann.total, 3.935225, 3e-5, "total");
  near(r.transferTimeH, 5.2567, 0.0005, "transfer time");
  // No plane change: every strategy is the plain Hohmann transfer.
  near(r.optimal.total, r.hohmann.total, 1e-9, "optimal");
  near(r.combinedAtOuter.total, r.hohmann.total, 1e-9, "combined");
  near(r.separate.total, r.hohmann.total, 1e-9, "separate");
});

test("Hohmann with a 28.5 deg plane change: where and how it is done", () => {
  const r = DV.compute({ r1: LEO, r2: GEO, i1: 28.5, i2: 0 });
  near(r.combinedAtOuter.burn1, 2.457038, 2e-5, "burn 1 unchanged");
  near(r.combinedAtOuter.burn2, 1.837093, 3e-5, "apogee burn with the plane change");
  near(r.combinedAtOuter.total, 4.294131, 5e-5, "combined at apogee");
  near(r.separate.planeChange, 1.513760, 2e-5, "plane change alone at GEO");
  near(r.separate.total, 5.448985, 5e-5, "separate");
  // The best split is no worse than doing it all at apogee, and a little of it belongs at perigee.
  assert.ok(r.optimal.total <= r.combinedAtOuter.total + 1e-12);
  assert.ok(r.optimal.total > r.hohmann.total);
  assert.ok(r.optimal.planeAtStartDeg > 0 && r.optimal.planeAtStartDeg < 5, `split ${r.optimal.planeAtStartDeg}`);
  near(r.optimal.planeAtStartDeg + r.optimal.planeAtEndDeg, 28.5, 1e-9, "split adds up");
  // Local minimum: moving 0.05 deg either way costs more (law of cosines written out here, not taken from the lib).
  const D = Math.PI / 180, c = (a, b, d) => Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(d));
  const f = (s) => c(r.circularSpeed1, r.transferSpeed1, s * D) + c(r.transferSpeed2, r.circularSpeed2, (28.5 - s) * D);
  const s0 = r.optimal.planeAtStartDeg;
  near(f(s0), r.optimal.total, 1e-9, "objective");
  assert.ok(f(s0 + 0.05) > f(s0) && f(s0 - 0.05) > f(s0));
  assert.equal(r.best.total, r.optimal.total);
  // Vallado's minimum-combined-plane-change example for this same transfer puts about 2.2 deg at perigee for a
  // total of about 4.27 km/s (recalled, rounded figures, so a loose check).
  near(r.optimal.planeAtStartDeg, 2.2, 0.1, "Vallado split");
  near(r.optimal.total, 4.27, 0.01, "Vallado total");
});

test("plane change alone in one orbit", () => {
  const r = DV.compute({ r1: 6921, r2: 6921, i1: 51.6, i2: 28.5 });
  near(r.hohmann.total, 0, 1e-12, "no Hohmann");
  near(r.separate.total, 3.038992, 2e-5, "2 v sin(di/2)");
  near(r.combinedAtOuter.total, 3.038992, 2e-5, "same when the radii match");
  near(r.optimal.total, 3.038992, 2e-5, "splitting a pure plane change does not help");
});

test("lowering an orbit puts the plane change at the start (the larger radius)", () => {
  const r = DV.compute({ r1: GEO, r2: LEO, i1: 0, i2: 28.5 });
  near(r.combinedAtOuter.total, 4.294131, 5e-5, "mirror of the raise");
  near(r.combinedAtOuter.planeAtStartDeg, 28.5, 1e-9, "at the start");
  near(r.separate.planeChange, 1.513760, 2e-5, "alone, at the larger orbit");
});

test("one burn: lowering the far side of the orbit (a deorbit burn)", () => {
  // 550 km circular to a 50 km perigee: v1 = sqrt(mu/6928.137) = 7.585, vta = v1 sqrt(2 - r1/a_t),
  // a_t = 6678.137, r1/a_t = 1.037435, sqrt(0.962565) = 0.981104 -> dv = 0.1433 km/s.
  const r = DV.compute({ r1: 6928.137, r2: 6428.137, i1: 51.6, i2: 51.6, oneBurn: true });
  near(r.oneBurn.total, 0.1433, 0.0005, "deorbit burn");
  assert.equal(r.best.burn2, 0);
  assert.equal(r.optimal, undefined);
});

test("rocket equation", () => {
  const p = DV.rocket(3.935225, 1000, 300);
  near(p.exhaustVelocityKmS, 2.941995, 1e-6, "ve");
  near(p.massRatio, 3.809904, 2e-5, "mass ratio");
  near(p.finalMassKg, 262.474, 0.002, "final mass");
  near(p.propellantKg, 737.526, 0.002, "propellant");
  near(DV.rocket(2.941995 * Math.LN2, 500, 300).finalMassKg, 250, 1e-3, "ve ln 2 halves the mass");
  near(DV.rocket(0, 500, 300).propellantKg, 0, 1e-12, "no burn");
});

test("delta-v: rejects bad input", () => {
  assert.throws(() => DV.compute({ r1: 6000, r2: 42164, i1: 0, i2: 0 }));
  assert.throws(() => DV.compute({ r1: 7000, r2: 42164, i1: -1, i2: 0 }));
  assert.throws(() => DV.compute({ r1: 7000, r2: 42164, i1: 0, i2: 181 }));
  assert.throws(() => DV.compute({ r1: NaN, r2: 42164, i1: 0, i2: 0 }));
  assert.throws(() => DV.compute({ r1: 7000, r2: 42164, i1: 0, i2: 0, wetMass: 0, isp: 300 }));
  assert.throws(() => DV.rocket(1, 1000, 0));
});
