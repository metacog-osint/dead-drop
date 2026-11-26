// RF Source Triangulation. References: Chris Veness, "Calculate distance, bearing and more between
// latitude/longitude points" (movable-type.co.uk), sections "Intersection of two paths" and "Cross-track distance";
// Stansfield, "Statistical theory of d.f. fixing", J. IEE 94 IIIA (1947) for the weighted bearing fix;
// Torrieri, "Statistical theory of passive location systems", IEEE Trans. AES 20(2) (1984) for TDOA.
// Worked examples (R = 6,371 km; one degree of arc = 6371 * pi / 180 = 111.19493 km):
// 1. Veness's own intersection example: 51.8853 N 0.2545 E on 108.547 deg and 49.0034 N 2.5735 E on 32.435 deg
//    meet at 50.9078 N 4.5084 E (checked by hand with the vector method: the cross product of the two great-circle
//    normals gives 50.90781 N, 4.50841 E).
// 2. Transmitter at 0 N 0 E. Receivers at 0 N 1 E, 1 N 0 E and 1 S 0 E see it on true bearings 270, 180 and 0 deg,
//    each 111.19493 km away. With a 1 deg bearing error (1 sigma), each line's sideways error at that range is
//    R sin(1 deg) * (pi / 180) = 6371 * 0.0174524 * 0.0174533 = 1.94062 km. The east receiver's line runs east-west and
//    fixes north-south: sigma_N = 1.94062 km. The two north-south lines fix east-west: sigma_E = 1.94062 / sqrt 2 =
//    1.37222 km. So the 1-sigma ellipse is 1.94062 by 1.37222 km with its long axis north-south (0 deg), and the 95%
//    ellipse is 2.44775 times that (sqrt(-2 ln 0.05)): 4.75014 by 3.35886 km.
// 3. TDOA: transmitter at 0 N 0.3 E; receivers 1 (reference) at 0 N 0 E, 2 at 0 N 1 E, 3 at 1 N 0 E, 4 at 0 N 1 W.
//    Distances: 0.3 deg = 33.35848 km, 0.7 deg = 77.83645 km, 1.3 deg = 144.55340 km, and to receiver 3
//    acos(cos 1 deg * cos 0.3 deg) = 1.044031 deg = 116.09042 km. With c = 0.299792458 km/us the arrival-time
//    differences from receiver 1 are 148.3625, 275.9641 and 370.9064 us.
// 4. Ambiguity: receivers 1, 2 and 4 alone lie on the equator, so a transmitter at 0.5 N 0.3 E and its mirror at
//    0.5 S 0.3 E give the same time differences, and both must be reported.
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../site/lib/rf-triangulation.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("spherical basics: distance and bearings on the equator and a meridian", () => {
  near(T.distanceKm(0, 0, 0, 1), 111.19493, 0.00001, "one degree");
  near(T.bearingDeg(0, 1, 0, 0), 270, 1e-9, "due west");
  near(T.bearingDeg(1, 0, 0, 0), 180, 1e-9, "due south");
  near(T.bearingDeg(-1, 0, 0, 0), 0, 1e-9, "due north");
  const p = T.destination(0, 0, 90, 111.19493);
  near(p.lat, 0, 1e-9, "destination lat"); near(p.lon, 1, 1e-6, "destination lon");
  near(T.crossTrackKm(0, 1, 270, 0.01, 0), 1.111949, 0.000001, "0.01 deg north of the equator");
  // Averaging longitudes 179 and -179 gives 0; the mean point is on the antimeridian.
  near(Math.abs(T.meanPoint([{ lat: 0, lon: 179 }, { lat: 0, lon: -179 }]).lon), 180, 1e-9, "antimeridian mean");
});

test("intersection: Veness worked example", () => {
  const p = T.intersection(51.8853, 0.2545, 108.547, 49.0034, 2.5735, 32.435);
  near(p.lat, 50.9078, 0.0001, "lat"); near(p.lon, 4.5084, 0.0001, "lon");
  assert.equal(T.intersection(0, 0, 0, 0, 1, 180), null, "headed to opposite sides of the baseline");
});

test("bearing fix: two crossing bearings, error from the stated sigma", () => {
  const f = T.aoaFix([{ lat: 0, lon: 1, bearing: 270 }, { lat: 1, lon: 0, bearing: 180 }], { sigmaDeg: 1 });
  near(f.lat, 0, 1e-7, "lat"); near(f.lon, 0, 1e-7, "lon");
  near(f.ellipse1.majorKm, 1.94062, 0.0001, "1-sigma axis"); near(f.ellipse1.minorKm, 1.94062, 0.0001, "circle");
  near(f.pairs[0].cutDeg, 90, 1e-6, "cut angle");
  // A single intersection used to report a "confidence radius" of 0 km and HIGH ACCURACY.
  assert.ok(f.ellipse95.majorKm > 4);
});

test("bearing fix: three bearings, ellipse by hand", () => {
  const rx = [{ lat: 0, lon: 1, bearing: 270 }, { lat: 1, lon: 0, bearing: 180 }, { lat: -1, lon: 0, bearing: 0 }];
  const f = T.aoaFix(rx, { sigmaDeg: 1 });
  near(f.lat, 0, 1e-7, "lat"); near(f.lon, 0, 1e-7, "lon");
  near(f.ellipse1.majorKm, 1.94062, 0.0001, "sigma N");
  near(f.ellipse1.minorKm, 1.37222, 0.0001, "sigma E");
  near(Math.min(f.ellipse1.orientDeg, 180 - f.ellipse1.orientDeg), 0, 0.01, "long axis north-south");
  near(f.ellipse95.majorKm, 4.75014, 0.0005, "95% major"); near(f.ellipse95.minorKm, 3.35886, 0.0005, "95% minor");
  near(f.chi2, 0, 1e-9, "consistent bearings"); assert.equal(f.dof, 1);
  // Magnetic bearings 10 deg low with a 10 deg east declination give the same fix.
  const g = T.aoaFix(rx.map(r => ({ ...r, bearing: r.bearing - 10 })), { sigmaDeg: 1, declinationDeg: 10 });
  near(g.lat, 0, 1e-7, "declination lat"); near(g.lon, 0, 1e-7, "declination lon");
  // Doubling sigma doubles the ellipse.
  near(T.aoaFix(rx, { sigmaDeg: 2 }).ellipse1.majorKm, 2 * 1.94062, 0.0002, "scales with sigma");
});

test("TDOA: arrival-time differences by hand, and the fix recovers the transmitter", () => {
  const rx = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 0 }, { lat: 0, lon: -1 }];
  const sim = T.simulate({ lat: 0, lon: 0.3 }, rx);
  near(sim[0].tdoaUs, 0, 1e-12, "reference");
  near(sim[1].tdoaUs, 148.3625, 0.0001, "receiver 2");
  near(sim[2].tdoaUs, 275.9641, 0.0001, "receiver 3");
  near(sim[3].tdoaUs, 370.9064, 0.0001, "receiver 4");
  const typed = rx.map((r, i) => ({ ...r, tdoaUs: [0, 148.3625, 275.9641, 370.9064][i] }));
  const f = T.tdoaFix(typed, { sigmaNs: 50 });
  assert.ok(T.distanceKm(f.lat, f.lon, 0, 0.3) < 0.01, `fix ${f.lat}, ${f.lon}`);
  assert.equal(f.alternates.length, 0);
  assert.equal(f.dof, 1);
  // 50 ns per receiver is 15 m of range; the fix error is tens of metres, not kilometres.
  assert.ok(f.ellipse1.majorKm > 0.005 && f.ellipse1.majorKm < 0.2, `ellipse ${f.ellipse1.majorKm}`);
  near(T.tdoaFix(typed, { sigmaNs: 100 }).ellipse1.majorKm, 2 * f.ellipse1.majorKm, 1e-4, "scales with sigma");
});

test("TDOA: three receivers in a line leave a mirror ambiguity", () => {
  const rx = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: -1 }];
  const sim = T.simulate({ lat: 0.5, lon: 0.3 }, rx);
  const f = T.tdoaFix(sim, { sigmaNs: 50 });
  const pts = [{ lat: f.lat, lon: f.lon }].concat(f.alternates);
  assert.ok(pts.some(p => T.distanceKm(p.lat, p.lon, 0.5, 0.3) < 0.01), "north solution");
  assert.ok(pts.some(p => T.distanceKm(p.lat, p.lon, -0.5, 0.3) < 0.01), "mirror solution");
  assert.ok(f.warnings.length > 0);
});

test("bad input is refused", () => {
  assert.throws(() => T.aoaFix([{ lat: 0, lon: 0, bearing: 0 }]), /at least two/);
  assert.throws(() => T.aoaFix([{ lat: 0, lon: 0, bearing: 0 }, { lat: 0, lon: 0, bearing: 90 }]), /same place/);
  assert.throws(() => T.aoaFix([{ lat: 0, lon: 1, bearing: 90 }, { lat: 1, lon: 0, bearing: 0 }]), /No two bearings/);
  assert.throws(() => T.aoaFix([{ lat: 95, lon: 0, bearing: 0 }, { lat: 0, lon: 1, bearing: 0 }]));
  assert.throws(() => T.aoaFix([{ lat: 0, lon: 1, bearing: NaN }, { lat: 1, lon: 0, bearing: 180 }]));
  assert.throws(() => T.aoaFix([{ lat: 0, lon: 1, bearing: 270 }, { lat: 1, lon: 0, bearing: 180 }], { sigmaDeg: 0 }));
  assert.throws(() => T.tdoaFix([{ lat: 0, lon: 0, tdoaUs: 0 }, { lat: 0, lon: 1, tdoaUs: 0 }]), /three/);
  // 1 degree is 111.19 km, which light crosses in 370.9 us; 500 us is impossible.
  assert.throws(() => T.tdoaFix([{ lat: 0, lon: 0, tdoaUs: 0 }, { lat: 0, lon: 1, tdoaUs: 500 }, { lat: 1, lon: 0, tdoaUs: 0 }]), /no place fits/);
});
