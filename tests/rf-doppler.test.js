// RF Satellite Tracking Tool (Doppler). References: first-order Doppler f_r = f (1 - rdot / c) (Montenbruck & Gill,
// Satellite Orbits, 2000, section 6.2.3); range rate along the observer-satellite line in the Earth-fixed frame
// (Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., section 4.4); Earth-fixed velocity
// v_ECEF = R3(theta) v_TEME - omega x r_ECEF (Vallado section 3.7), omega = 7.292115e-5 rad/s (WGS 84).
// Worked examples, by hand (c = 299792.458 km/s):
// 1. 145.800 MHz, approaching at 1 km/s (rdot = -1): shift = 145.8e6 / 299792.458 = +486.336 Hz.
//    Receding at 7 km/s: -145.8e6 * 7 / 299792.458 = -3404.355 Hz.
// 2. Uplink at 435.000 MHz, approaching at 1 km/s: transmit 435e6 / (1 + 1/c) = 434998549.00 Hz (1451.00 Hz low),
//    so the satellite hears exactly 435 MHz.
// 3. Range rate is not the geocentric radial speed. Observer at (6378.137, 0, 0) km; satellite at (0, 7000, 0) km
//    moving at (-7.5, 0, 0) km/s, square to its own radius, so its speed towards the Earth's centre is 0. The line
//    of sight is (-6378.137, 7000, 0), length 9469.986 km; rdot = (6378.137 * 7.5) / 9469.986 = +5.051330 km/s.
//    The old tool used the geocentric radial speed (here 0) and so showed almost no Doppler for circular orbits.
// 4. TEME to Earth-fixed velocity with theta = 0: r = (7000, 0, 0), v = (0, 7.5, 0) gives
//    v_ECEF = (0, 7.5 - 7.292115e-5 * 7000, 0) = (0, 6.989552, 0) km/s.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../site/lib/rf-doppler.js");
const V = require("../site/lib/satellite-visibility.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("doppler: first-order shift, approaching and receding", () => {
  near(D.shiftHz(145.8e6, -1), 486.336, 1e-3, "approaching 1 km/s");
  near(D.shiftHz(145.8e6, 7), -3404.355, 1e-3, "receding 7 km/s");
  near(D.receivedHz(145.8e6, -1), 145800486.336, 1e-3, "received");
  assert.equal(D.shiftHz(145.8e6, 0), -0);
});

test("doppler: uplink pre-correction", () => {
  near(D.uplinkTransmitHz(435e6, -1), 434998549.00, 0.01, "uplink");
  // What the satellite hears from that transmission is the nominal frequency.
  near(D.uplinkTransmitHz(435e6, -1) * (1 + 1 / D.C_KM_S), 435e6, 1e-6, "round trip");
});

test("doppler: range rate along the line of sight, not the geocentric radial speed", () => {
  near(D.rangeRate({ x: 0, y: 7000, z: 0 }, { x: -7.5, y: 0, z: 0 }, { x: 6378.137, y: 0, z: 0 }), 5.051330, 1e-6, "rdot");
  // Directly overhead and moving sideways: the range is not changing.
  near(D.rangeRate({ x: 6878.137, y: 0, z: 0 }, { x: 0, y: 7.6, z: 0 }, { x: 6378.137, y: 0, z: 0 }), 0, 1e-12, "overhead");
  // The look-angle code gives the same range rate from an observer on the equator at 0 E.
  near(V.lookAngles({ latDeg: 0, lonDeg: 0, hKm: 0 }, { x: 0, y: 7000, z: 0 }, { x: -7.5, y: 0, z: 0 }).rangeRateKmS,
    5.051330, 1e-6, "lookAngles rdot");
});

test("doppler: Earth-fixed velocity removes the Earth's rotation", () => {
  const v = V.temeToEcefVelocity({ x: 7000, y: 0, z: 0 }, { x: 0, y: 7.5, z: 0 }, 0);
  near(v.x, 0, 1e-12, "vx");
  near(v.y, 6.989552, 1e-6, "vy");
  near(v.z, 0, 1e-12, "vz");
});

test("doppler: curve over samples", () => {
  const c = D.curve(145.8e6, [{ ms: 0, rangeRateKmS: -1 }, { ms: 1, rangeRateKmS: NaN }, { ms: 2, rangeRateKmS: 7 }]);
  assert.equal(c.length, 2);
  near(c[0].shiftHz, 486.336, 1e-3, "first");
  near(c[1].receivedHz, 145.8e6 - 3404.355, 1e-3, "second");
  assert.equal(c[1].ms, 2);
});

test("doppler: rejects bad input", () => {
  assert.throws(() => D.shiftHz(0, 1));
  assert.throws(() => D.shiftHz(-5, 1));
  assert.throws(() => D.shiftHz(NaN, 1));
  assert.throws(() => D.shiftHz(145e6, NaN));
  assert.throws(() => D.shiftHz(145e6, 400000));
  assert.throws(() => D.rangeRate({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }));
  assert.throws(() => D.rangeRate(null, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }));
});
