// Satellite Conjunction Analysis. References: Alfano and Negron, "Determining satellite close approaches", Journal of
// the Astronautical Sciences 41(2), 1993 (bracket each minimum of the separation, then refine it); Press et al.,
// Numerical Recipes, 3rd ed., section 10.2 (golden-section search); Vallado, Fundamentals of Astrodynamics and
// Applications, 4th ed., section 3.3 (the RSW satellite frame: radial, along-track, cross-track).
// Hand-worked examples, all with made-up motions:
// 1. Straight-line pass. A sits at the origin; B starts at (100, 5, 0) km moving at (-10, 0, 0) km/s. The closest
//    approach is at t* = -(r0 . v) / |v|^2 = 1000 / 100 = 10 s, where B is at (0, 5, 0): miss 5 km, relative speed
//    10 km/s. Sampled only at 0 and 60 s (the old method), the separations are 100.12 km and 500.02 km, so sampling
//    alone reports 100.1 km: 95 km too far.
// 2. Two circular orbits of radius R = 6878 km (500 km up) crossing at right angles: A in the equator,
//    A = R (cos nt, sin nt, 0); B over the poles, B = R (cos(nt + p), 0, sin(nt + p)), B leads A by p = 0.01 rad.
//    |A - B|^2 = R^2 (2 - 2 cos(nt) cos(nt + p)) = R^2 (2 - cos p - cos(2nt + p)), smallest when 2nt + p = 2 pi k:
//    miss = R sqrt(1 - cos p) = R sqrt(2) sin(p/2) = 6878 * 1.414214 * 0.0049999792 = 48.635 km,
//    at t = (k pi - p/2) / n. With mu = 398600.4418 km^3/s^2, n = sqrt(mu / R^3) = 1.1068165e-3 rad/s, so
//    pi/n = 2838.404 s and p/(2n) = 4.5175 s: the minima are at 2833.887 s and 5672.291 s.
//    Relative speed there: A's velocity nR(sin(p/2), cos(p/2), 0), B's nR(-sin(p/2), 0, cos(p/2)), difference
//    nR sqrt(4 sin^2(p/2) + 2 cos^2(p/2)) = 7.61272 * 1.414231 = 10.7661 km/s; approach angle 90 deg less a
//    hair: cos = (-sin^2(p/2)) gives 90.0014 deg.
// 3. RSW frame: A at (7000, 0, 0) moving (0, 7.5, 0): R = x, W = r x v / |r x v| = z, S = W x R = y. B at
//    (7001, 2, 3) is 1 km radial, 2 km along-track, 3 km cross-track.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../site/lib/conjunction.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const T0 = Date.UTC(2026, 0, 1);
const sec = (ms) => (ms - T0) / 1000;

const still = () => ({ position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
const line = (ms) => ({ position: { x: 100 - 10 * sec(ms), y: 5, z: 0 }, velocity: { x: -10, y: 0, z: 0 } });

test("straight-line pass: refinement finds what sampling misses", () => {
  // Sampling only every 60 s over 0-120 s:
  near(C.separation(still, line, T0), 100.125, 0.001, "sample at 0 s");
  near(C.separation(still, line, T0 + 60000), 500.025, 0.001, "sample at 60 s");
  const r = C.closeApproaches(still, line, T0, T0 + 120000, { stepS: 60, thresholdKm: 10 });
  assert.equal(r.approaches.length, 1);
  near(sec(r.closest.ms), 10, 0.002, "TCA");
  near(r.closest.missKm, 5, 1e-6, "miss distance");
  near(r.closest.relSpeedKmS, 10, 1e-9, "relative speed");
  assert.equal(r.closest.inside, true);
  assert.deepEqual(r.edges, []);
  assert.equal(r.samples, 3);
});

const R = 6878, MU = 398600.4418, n = Math.sqrt(MU / R ** 3), p = 0.01;
const eq = (ms) => { const a = n * sec(ms);
  return { position: { x: R * Math.cos(a), y: R * Math.sin(a), z: 0 }, velocity: { x: -n * R * Math.sin(a), y: n * R * Math.cos(a), z: 0 } }; };
const polar = (ms) => { const b = n * sec(ms) + p;
  return { position: { x: R * Math.cos(b), y: 0, z: R * Math.sin(b) }, velocity: { x: -n * R * Math.sin(b), y: 0, z: n * R * Math.cos(b) } }; };

test("crossing circular orbits: hand-worked miss distance, times and speed", () => {
  near(n, 1.1068165e-3, 1e-9, "mean motion");
  for (const stepS of [60, 300]) {
    const r = C.closeApproaches(eq, polar, T0 + 100000, T0 + 6000000, { stepS, thresholdKm: 50 });
    assert.equal(r.approaches.length, 2, `two minima at a ${stepS} s step`);
    // At 100 s the objects are separating (the k = 0 minimum was at -4.5 s), so the start is an edge:
    // 6878 sqrt(2 - cos 0.01 - cos(2 n 100 + 0.01)) = 1123.78 km.
    assert.equal(r.edges.length, 1); assert.equal(r.edges[0].atStart, true);
    near(r.edges[0].missKm, 1123.776, 0.001, "separation at the start");
    near(sec(r.approaches[0].ms), 2833.887, 0.005, "first TCA");
    near(sec(r.approaches[1].ms), 5672.291, 0.005, "second TCA");
    r.approaches.forEach((a) => {
      near(a.missKm, 48.635, 0.001, "miss");
      near(a.relSpeedKmS, 10.7661, 1e-4, "relative speed");
      near(a.approachAngleDeg, 90.0014, 1e-3, "approach angle");
      assert.equal(a.inside, true);
    });
  }
  // A tighter screening distance keeps both minima but marks them outside.
  const r2 = C.closeApproaches(eq, polar, T0 + 100000, T0 + 6000000, { stepS: 60, thresholdKm: 10 });
  assert.ok(r2.approaches.every((a) => !a.inside));
});

test("RSW components: hand-worked", () => {
  const c = C.rsw({ x: 7000, y: 0, z: 0 }, { x: 0, y: 7.5, z: 0 }, { x: 1, y: 2, z: 3 });
  near(c.radialKm, 1, 1e-12, "radial"); near(c.alongTrackKm, 2, 1e-12, "along-track"); near(c.crossTrackKm, 3, 1e-12, "cross-track");
  const s = C.stateAt(() => ({ position: { x: 7000, y: 0, z: 0 }, velocity: { x: 0, y: 7.5, z: 0 } }),
    () => ({ position: { x: 7001, y: 2, z: 3 }, velocity: { x: 0, y: 7.5, z: 0 } }), T0);
  near(s.missKm, Math.sqrt(14), 1e-12, "miss"); near(s.relSpeedKmS, 0, 1e-12, "speed"); near(s.approachAngleDeg, 0, 1e-6, "angle");
});

test("edges, gaps and bad input", () => {
  // Separating all window long: no closest approach inside it; the start is listed as an edge, 10 km apart.
  const away = (ms) => ({ position: { x: 10 + sec(ms), y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } });
  const e = C.closeApproaches(still, away, T0, T0 + 600000, { stepS: 60 });
  assert.equal(e.approaches.length, 0); assert.equal(e.closest, null);
  assert.equal(e.edges.length, 1); assert.equal(e.edges[0].atStart, true);
  near(e.edges[0].missKm, 10, 1e-3, "edge miss");
  // Closing all window long: the end is the edge, 1000 - 600 = 400 km apart.
  const toward = (ms) => ({ position: { x: 1000 - sec(ms), y: 0, z: 0 }, velocity: { x: -1, y: 0, z: 0 } });
  const f = C.closeApproaches(still, toward, T0, T0 + 600000, { stepS: 60 });
  assert.equal(f.edges.length, 1); assert.equal(f.edges[0].atStart, false); near(f.edges[0].missKm, 400, 1e-3, "end miss");
  // A propagator that fails everywhere: no approaches, every sample counted as failed.
  const g = C.closeApproaches(still, () => null, T0, T0 + 120000, { stepS: 60 });
  assert.equal(g.approaches.length, 0); assert.equal(g.closest, null); assert.equal(g.failedSamples, 3);
  assert.throws(() => C.closeApproaches(still, line, T0, T0));
  assert.throws(() => C.closeApproaches(still, null, T0, T0 + 1000));
  assert.throws(() => C.closeApproaches(still, line, T0, T0 + 1000, { stepS: 0 }));
  assert.throws(() => C.closeApproaches(still, line, T0, T0 + 1000, { thresholdKm: -1 }));
  assert.throws(() => C.closeApproaches(still, line, T0, T0 + 86400000 * 365, { stepS: 1 }), /samples/);
});
