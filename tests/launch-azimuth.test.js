// Launch Azimuth Calculator. Reference: Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., launch-site
// geometry: cos i = cos(lat) sin(Az), so sin(Az) = cos i / cos(lat); the north-going launch flies Az, the south-going
// one 180 - Az. Rotating-Earth correction (velocity triangle): v_N = v cos Az, v_E = v sin Az - v_site,
// Az_rot = atan2(v_E, v_N), with v_site = omega N cos(lat) on WGS 84 (omega = 7.292115e-5 rad/s, a = 6378.137 km,
// e^2 = 6.69437999014e-3, N = a / sqrt(1 - e^2 sin^2 lat)) and v = sqrt(mu / (a + h)), mu = 398600.4418 km^3/s^2.
// Worked example by hand, Cape Canaveral lat 28.5 deg to the ISS inclination 51.6 deg at 400 km:
//   sin Az = cos 51.6 / cos 28.5 = 0.621148 / 0.878817 = 0.706800 -> Az = 44.975 deg (north-going), 135.025 (south-going)
//   N = 6383.003 km, v_site = 7.292115e-5 * 6383.003 * cos 28.5 = 0.409051 km/s
//   v = sqrt(398600.4418 / 6778.137) = 7.668558 km/s; v_N = 5.42484, v_E = 5.42014 - 0.40905 = 5.01108
//   Az_rot = atan2(5.01108, 5.42484) = 42.730 deg; speed relative to the ground = 7.38511 km/s;
//   rotation gain along the orbit = 0.409051 * 0.706800 = 0.289117 km/s.
// Retrograde, Vandenberg lat 34.6 deg to 97.5 deg at 600 km: sin Az = cos 97.5 / cos 34.6 = -0.130526 / 0.823136
//   = -0.158572 -> north-going 350.876 deg, south-going 189.124 deg; corrected south-going 191.967 deg.
// Southern site, Mahia lat -39.26 deg to 45 deg: sin Az = 0.707107 / 0.774232 = 0.913302 -> 65.957 and 114.043 deg.
// Destination point: Veness's worked example, 53 19'14"N 001 43'47"W, bearing 096 01'18", 124.8 km
//   -> 53 11'18"N 000 08'00"E (53.1883, 0.1333).
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../site/lib/launch-azimuth.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("azimuth: Cape Canaveral to 51.6 deg, inertial and rotating", () => {
  const r = A.compute(28.5, 51.6, 400);
  near(r.inertialNorthDeg, 44.975, 0.001, "inertial north-going");
  near(r.inertialSouthDeg, 135.025, 0.001, "inertial south-going");
  near(r.siteSpeedKms, 0.409051, 1e-5, "site speed");
  near(r.orbitalSpeedKms, 7.668558, 1e-5, "orbital speed");
  near(r.rotatingNorthDeg, 42.730, 0.001, "rotating north-going");
  near(r.rotatingSouthDeg, 180 - 42.730, 0.001, "rotating south-going mirrors the north-going one");
  near(r.groundSpeedNeededKms, 7.38511, 1e-4, "speed relative to the ground");
  near(r.rotationGainKms, 0.289117, 1e-5, "rotation gain");
  assert.equal(r.retrograde, false);
});

test("azimuth: inclination equal to latitude is a due-east launch", () => {
  const r = A.compute(28.5, 28.5, 200);
  near(r.inertialNorthDeg, 90, 1e-6, "north-going");
  near(r.inertialSouthDeg, 90, 1e-6, "south-going");
  near(r.rotatingNorthDeg, 90, 1e-6, "rotating");
  assert.equal(r.dueEastOrWest, true);
  // Equatorial site, equatorial orbits: due east (90 deg) and due west (270 deg).
  near(A.compute(0, 0, 400).inertialNorthDeg, 90, 1e-9, "equatorial prograde");
  near(A.compute(0, 180, 400).inertialNorthDeg, 270, 1e-9, "equatorial retrograde");
  // Polar orbit: due north or due south from anywhere.
  near(A.compute(45, 90, 400).inertialNorthDeg, 0, 1e-9, "polar north");
  near(A.compute(45, 90, 400).inertialSouthDeg, 180, 1e-9, "polar south");
});

test("azimuth: retrograde sun-synchronous from Vandenberg", () => {
  const r = A.compute(34.6, 97.5, 600);
  near(r.inertialNorthDeg, 350.876, 0.001, "north-going");
  near(r.inertialSouthDeg, 189.124, 0.001, "south-going");
  near(r.rotatingSouthDeg, 191.967, 0.001, "rotating south-going");
  assert.equal(r.retrograde, true);
  assert.ok(r.rotationGainKms < 0, "a retrograde orbit loses speed to Earth's rotation");
});

test("azimuth: southern hemisphere site", () => {
  const r = A.compute(-39.26, 45, 400);
  near(r.inertialNorthDeg, 65.957, 0.001, "north-going");
  near(r.inertialSouthDeg, 114.043, 0.001, "south-going");
});

test("azimuth: unreachable inclinations and bad input are refused", () => {
  assert.throws(() => A.compute(28.5, 20, 400), /cannot be reached/);
  assert.throws(() => A.compute(28.5, 160, 400), /cannot be reached/);   // above 180 - 28.5 = 151.5
  assert.throws(() => A.compute(91, 50, 400));
  assert.throws(() => A.compute(28.5, 181, 400));
  assert.throws(() => A.compute(90, 90, 400), /pole/);
  assert.throws(() => A.compute(NaN, 50, 400));
  assert.throws(() => A.compute(28.5, 50, 10));
});

test("destination point: Veness worked example", () => {
  const lat1 = 53 + 19 / 60 + 14 / 3600, lon1 = -(1 + 43 / 60 + 47 / 3600), brg = 96 + 1 / 60 + 18 / 3600;
  const [lat2, lon2] = A.destination(lat1, lon1, brg, 124.8);
  near(lat2, 53 + 11 / 60 + 18 / 3600, 5e-4, "latitude");
  near(lon2, 8 / 60, 5e-4, "longitude");
  const line = A.headingLine(0, 0, 90, 1000, 10);
  assert.equal(line.length, 11);
  near(line[10][1], 1000 / 6371 * 180 / Math.PI, 1e-9, "due east along the equator");
  assert.equal(A.compass(44.975), "NE");
  assert.equal(A.compass(359), "N");
});
