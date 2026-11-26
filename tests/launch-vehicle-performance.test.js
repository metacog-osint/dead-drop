// Launch Vehicle Performance Calculator. References: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed.,
// example 6-1 (Hohmann transfer from 191.34411 km to 35,781.34857 km altitude: dv_a = 2.4570 km/s, dv_b = 1.4782 km/s,
// total 3.9352 km/s, transfer time 5.2567 h); combined plane change by the law of cosines,
// dv = sqrt(va^2 + vf^2 - 2 va vf cos(di)); Curtis, Orbital Mechanics for Engineering Students, section 4.7, for the J2
// node rate; Wertz & Larson, SMAD 3rd ed., chapter 6: a sun-synchronous orbit at 700 km has i = 98.19 deg.
// The payload scaling is a rule of thumb (rocket equation on the upper stage), tested only against its own formula.
// Hand calculations (mu = 398600.4418 km^3/s^2, R = 6378.137 km, omega = 7.292115e-5 rad/s, WGS 84 N):
//   GTO from a 200 km circular orbit: r0 = 6578.137, ra = 42164.137, a = 24371.137 km,
//     v0 = sqrt(mu / r0) = 7.784262 km/s, vp = sqrt(mu (2/r0 - 1/a)) = 10.238849 km/s, perigee burn = 2.45459 km/s.
//   GEO from there with the Cape's 28.5 deg: va = 1.59739, vgeo = 3.07466 km/s,
//     dv = sqrt(1.59739^2 + 3.07466^2 - 2 * 1.59739 * 3.07466 * cos 28.5) = 1.83649 km/s; coplanar 1.47727 km/s.
//   Rotation, Cape 28.5 deg at 200 km: v_site = 0.409051 km/s, v = 7.784262 km/s, N = 6383.003 km;
//     speed to add = sqrt(v^2 - 2 v omega N cos i + v_site^2) = 7.375211 km/s at i = 28.5, 7.795002 at i = 90;
//     a polar orbit costs 0.419791 km/s more.
//   Payload rule of thumb, Falcon 9 figures (22,800 kg to LEO, stage dry mass 4,000 kg, Isp 348 s):
//     g0 Isp = 3.4127142 km/s; to GTO: 26,800 exp(-2.45459 / 3.4127142) - 4,000 = 9,054.8 kg (published: 8,300 kg);
//     polar at 200 km: 26,800 exp(-0.419791 / 3.4127142) - 4,000 = 19,698.1 kg.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../site/lib/launch-vehicle-performance.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const F9 = { p0Kg: 22800, refAltKm: 200, siteLatDeg: 28.5, dryKg: 4000, ispS: 348 };

test("Hohmann: Vallado example 6-1", () => {
  const h = P.hohmann(P.R_EQ + 191.34411, P.R_EQ + 35781.34857);
  near(h.dv1, 2.4570, 1e-4, "first burn");
  near(h.dv2, 1.4782, 1e-4, "second burn");
  near(h.dv1 + h.dv2, 3.9352, 1e-4, "total");
  near(h.tofS / 3600, 5.2567, 1e-4, "time of flight");
  // Going down costs the same as going up.
  const d = P.hohmann(P.R_EQ + 35781.34857, P.R_EQ + 191.34411);
  near(d.dv1 + d.dv2, 3.9352, 1e-4, "reverse");
});

test("rotation: a polar orbit from the Cape costs 419.8 m/s more than a due-east one", () => {
  near(P.groundRelativeSpeed(28.5, 200, 28.5), 7.375211, 1e-5, "due east");
  near(P.groundRelativeSpeed(28.5, 200, 90), 7.795002, 1e-5, "polar");
  const r = P.estimate({ ...F9, target: { type: "circular", altKm: 200, incDeg: 90 } });
  near(r.dvExtraKms, 0.419791, 1e-5, "extra");
  near(r.payloadKg, 19698.1, 0.5, "payload");
  // The reference orbit itself returns the reference payload.
  const same = P.estimate({ ...F9, target: { type: "circular", altKm: 200, incDeg: 28.5 } });
  near(same.payloadKg, 22800, 1e-6, "reference");
  near(same.dvExtraKms, 0, 1e-12, "no extra");
});

test("GTO and GEO from the Cape", () => {
  const g = P.estimate({ ...F9, target: { type: "gto" } });
  near(g.parts[g.parts.length - 1].dvKms, 2.45459, 1e-5, "perigee burn");
  near(g.payloadKg, 9054.8, 0.5, "GTO payload, rule of thumb");
  const geo = P.estimate({ ...F9, target: { type: "geo" } });
  near(geo.parts[geo.parts.length - 1].dvKms, 1.83649, 1e-5, "apogee burn with 28.5 deg plane change");
  assert.equal(geo.targetIncDeg, 0);
  const eq = P.estimate({ ...F9, siteLatDeg: 0, refIncDeg: 0, target: { type: "geo" } });
  near(eq.parts[eq.parts.length - 1].dvKms, 1.47727, 1e-5, "coplanar apogee burn from the equator");
});

test("sun-synchronous inclination: 98.19 deg at 700 km", () => {
  near(P.ssoInclinationDeg(700), 98.19, 0.01, "700 km");
  assert.ok(P.ssoInclinationDeg(500) < P.ssoInclinationDeg(800), "rises with altitude");
  const r = P.estimate({ ...F9, target: { type: "sso", altKm: 700 } });
  near(r.targetIncDeg, 98.188, 0.001, "target inclination");
  assert.ok(r.payloadKg < 22800 && r.payloadKg > 0);
});

test("payload rule of thumb follows the rocket equation", () => {
  near(P.payloadFromDv(22800, 4000, 348, 0), 22800, 1e-9, "no change");
  // One exhaust velocity of extra dv divides the burnout mass by e.
  near(P.payloadFromDv(22800, 4000, 348, 9.80665 * 348 / 1000), 26800 / Math.E - 4000, 1e-6, "one exhaust velocity");
  // A stage with Isp 100 s cannot pay for GEO: 26,800 exp(-4.29 / 0.98) = 340 kg, less than its own 4,000 kg.
  const far = P.estimate({ ...F9, ispS: 100, target: { type: "geo" } });
  assert.equal(far.reachable, false);
  assert.equal(far.payloadKg, 0);
});

test("below the site latitude: launch at the latitude, then a plane change", () => {
  const r = P.estimate({ ...F9, target: { type: "circular", altKm: 200, incDeg: 0 } });
  assert.equal(r.launchIncDeg, 28.5);
  near(r.parts[r.parts.length - 1].dvKms, 2 * 7.784262 * Math.sin(28.5 * Math.PI / 360), 1e-5, "simple plane change");
});

test("bad input is refused", () => {
  assert.throws(() => P.estimate({ ...F9, p0Kg: 0, target: { type: "gto" } }));
  assert.throws(() => P.estimate({ ...F9, ispS: -1, target: { type: "gto" } }));
  assert.throws(() => P.estimate({ ...F9, dryKg: -5, target: { type: "gto" } }));
  assert.throws(() => P.estimate({ ...F9, refIncDeg: 10, target: { type: "gto" } }), /cannot be reached/);
  assert.throws(() => P.estimate({ ...F9, target: { type: "circular", altKm: 50, incDeg: 30 } }));
  assert.throws(() => P.estimate({ ...F9, target: { type: "warp" } }));
  assert.throws(() => P.estimate({ ...F9, target: { type: "gto", apogeeKm: 100 } }));
  assert.throws(() => P.hohmann(0, 7000));
});
