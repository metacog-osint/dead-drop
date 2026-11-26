// Ground Track Plotter. References: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed.
// - Example 3-5 (GMST, IAU-82, section 3.5): 20 August 1992 12:14 UT1 is JD 2448855.009722, T = -0.073647919 centuries,
//   GMST = 152.578787810 deg; at 104 deg W the local sidereal time is 48.578787810 deg.
// - Example 3-3 (Earth-fixed to geodetic, Algorithm 12): r = (6524.834, 6862.875, 6448.296) km gives geodetic
//   latitude 34.352496 deg, longitude 46.4464 deg, height 5085.22 km above WGS 84.
// Hand-worked checks with a made-up propagator (a circular orbit over the equator, 7000 km from the centre):
// - Started at the Example 3-5 instant with the satellite's inertial angle equal to GMST (152.578787810 deg), it is
//   over latitude 0, longitude 0, at height 7000 - 6378.137 = 621.863 km.
// - With a 90-minute period, the next equator crossing at the same inertial angle is west by the Earth's turn in
//   90 min: 360.98564736629 deg/day * 90/1440 = 22.56160 deg, so at longitude -22.56160 deg.
// - Antimeridian: a segment from (0, 170) to (10, -170) crosses 180 after 10 of its 20 degrees, so at latitude 5;
//   it is split into (0, 170)-(5, 180) and (5, -180)-(10, -170). Going west, (0, -175) to (4, 175): crosses -180
//   after 5 of 10 degrees, at latitude 2.
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../site/lib/ground-track.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const D2R = Math.PI / 180;
const T0 = Date.UTC(1992, 7, 20, 12, 14, 0);

test("GMST: Vallado Example 3-5", () => {
  const jd = G.julianDate(T0);
  near(jd, 2448855.009722, 1e-6, "Julian date");
  near((jd - 2451545) / 36525, -0.073647919, 1e-9, "T");
  const deg = G.gmst(jd) / D2R;
  near(deg, 152.578787810, 1e-6, "GMST");
  near(((deg - 104) + 360) % 360, 48.578787810, 1e-6, "LST at 104 W");
  // J2000.0 itself (JD 2451545.0): GMST = 67310.54841 s = 280.46061837 deg.
  near(G.gmst(2451545.0) / D2R, 280.46061837, 1e-7, "GMST at J2000");
});

test("Earth-fixed to geodetic: Vallado Example 3-3", () => {
  const g = G.earthFixedToGeodetic({ x: 6524.834, y: 6862.875, z: 6448.296 });
  near(g.latDeg, 34.352496, 2e-5, "latitude");
  near(g.lonDeg, 46.4464, 1e-4, "longitude");
  near(g.hKm, 5085.22, 0.01, "height");
  // Hand checks: on the equator at x = a + 100 km is (0, 0, 100 km); at the pole the height is z - b,
  // b = a (1 - f) = 6356.752 km.
  const eq = G.earthFixedToGeodetic({ x: 6478.137, y: 0, z: 0 });
  near(eq.latDeg, 0, 1e-9, "equator lat"); near(eq.lonDeg, 0, 1e-9, "equator lon"); near(eq.hKm, 100, 1e-6, "equator h");
  const w = G.earthFixedToGeodetic({ x: 0, y: -7000, z: 0 });
  near(w.lonDeg, -90, 1e-9, "90 W");
  const pole = G.earthFixedToGeodetic({ x: 0, y: 0, z: 6456.752 });
  near(pole.latDeg, 90, 1e-9, "pole lat"); near(pole.hKm, 100, 1e-3, "pole h");
  const nearPole = G.earthFixedToGeodetic({ x: 1e-3, y: 0, z: -6456.752 });
  near(nearPole.latDeg, -90, 1e-5, "near south pole lat"); near(nearPole.hKm, 100, 1e-3, "near south pole h");
});

// Circular equatorial orbit, radius 7000 km, period 90 min, starting at inertial angle alpha0 (radians).
function circular(alpha0, periodMin, r) {
  const n = 2 * Math.PI / (periodMin * 60);
  return (ms) => {
    const a = alpha0 + n * (ms - T0) / 1000;
    return { position: { x: r * Math.cos(a), y: r * Math.sin(a), z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
  };
}

test("sub-satellite point and track with a made-up circular orbit", () => {
  const prop = circular(152.578787810 * D2R, 90, 7000);
  const p0 = G.subSatellitePoint(prop(T0).position, T0);
  near(p0.latDeg, 0, 1e-9, "start lat"); near(p0.lonDeg, 0, 1e-5, "start lon"); near(p0.hKm, 621.863, 1e-6, "height");
  const p1 = G.subSatellitePoint(prop(T0 + 90 * 60000).position, T0 + 90 * 60000);
  near(p1.lonDeg, -22.56160, 1e-4, "one orbit later");
  near(G.westwardShiftDeg(90), 22.56160, 1e-4, "westward shift");
  near(G.periodMin(15.72125391), 91.59575, 1e-5, "period from mean motion (ISS 2008 set: 1440 / 15.72125391)");
  // Two orbits at a 60 s step: 180 steps + 1 = 181 points; the last lands exactly on the end.
  const tr = G.track(prop, T0, 2 * 5400, 60);
  assert.equal(tr.length, 181);
  assert.equal(tr[180].ms, T0 + 10800000);
  near(tr[180].lonDeg, -45.12321, 1e-4, "after two orbits");
  const lines = G.splitAntimeridian(tr);
  // The track runs east from 0 at 360/90 - 0.2507 = 3.749 deg/min of longitude; it crosses 180 once per orbit.
  assert.equal(lines.length, 3);
  lines.forEach((l) => l.forEach((q) => assert.ok(q[1] >= -180 && q[1] <= 180)));
  const s = G.summary(tr);
  near(s.maxLatDeg, 0, 1e-9, "equatorial max lat"); near(s.minHKm, 621.863, 1e-6, "min h");
});

test("antimeridian split: hand-worked crossings", () => {
  const east = G.splitAntimeridian([[0, 170], [10, -170]]);
  assert.deepEqual(east, [[[0, 170], [5, 180]], [[5, -180], [10, -170]]]);
  const west = G.splitAntimeridian([{ latDeg: 0, lonDeg: -175 }, { latDeg: 4, lonDeg: 175 }]);
  assert.deepEqual(west, [[[0, -175], [2, -180]], [[2, 180], [4, 175]]]);
  // No crossing: one line, unchanged.
  assert.deepEqual(G.splitAntimeridian([[0, 10], [1, 20], [2, 30]]), [[[0, 10], [1, 20], [2, 30]]]);
  // A gap (propagator failure) ends a line; single points on their own are dropped.
  assert.deepEqual(G.splitAntimeridian([[0, 0], [1, 1], null, [5, 5], null, [7, 7], [8, 8]]),
    [[[0, 0], [1, 1]], [[7, 7], [8, 8]]]);
  assert.deepEqual(G.splitAntimeridian([]), []);
});

test("bad input", () => {
  assert.throws(() => G.julianDate(NaN));
  assert.throws(() => G.earthFixedToGeodetic({ x: 1, y: NaN, z: 0 }));
  assert.throws(() => G.track(null, T0, 60, 10));
  assert.throws(() => G.track(() => null, T0, 0, 10));
  assert.throws(() => G.track(() => null, T0, 60, 0));
  assert.throws(() => G.track(() => null, T0, 86400 * 30, 1), /points/);
  assert.throws(() => G.periodMin(0));
  assert.throws(() => G.splitAntimeridian([[0, NaN]]));
  // A propagator that fails gives nulls, not a crash.
  const tr = G.track(() => false, T0, 120, 60);
  assert.deepEqual(tr, [null, null, null]);
  assert.equal(G.summary(tr), null);
});
