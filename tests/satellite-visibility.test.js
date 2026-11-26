// Satellite Visibility Calculator. References and worked examples:
// - Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., Example 3-5: on 1992 August 20, 12:14:00 UT1
//   (JD 2448855.009722), GMST = 152.578787810 deg (IAU-82, eq. 3-45). At J2000.0 (2000-01-01 12:00 UT1) the same
//   formula gives 67310.54841 s / 240 = 280.46061837 deg.
// - Vallado Example 5-1 (Algorithm 29): on 2006 April 2, 00:00 UT the Sun is at
//   0.9771945 i + 0.1924424 j + 0.0834308 k AU (mean equator and equinox of date).
// - WGS 84 (NIMA TR8350.2): a = 6378.137 km, f = 1/298.257223563, e^2 = 0.00669437999. At 45 N, 0 E, height 0:
//   N = a / sqrt(1 - e^2 sin^2 45) = 6388.8383 km, x = N cos 45 = 4517.5909 km, z = N (1 - e^2) sin 45 = 4487.3484 km.
// - Look angles by hand in the east-north-up frame (Vallado section 4.4): an observer on the equator at 0 E sits at
//   (6378.137, 0, 0) km with up = +x, east = +y, north = +z. A point 500 km straight up is at elevation 90 deg, range
//   500 km; (6378.137, 1000, 0) is due east on the horizon plane (az 90, el 0); (6378.137, 0, 1000) is due north
//   (az 0, el 0); (6378.137 + 1000, 0, -1000) is south at 45 deg elevation, range 1414.21 km.
// - Earth's shadow, by hand with the Sun on +x at 1 AU: a satellite 7000 km behind the Earth on the Sun line is in
//   the umbra. The umbra cone's radius 7000 km behind the Earth's centre is R - 7000 (R_sun - R) / AU = 6345.9 km,
//   the penumbra's R + 7000 (R_sun + R) / AU = 6411.0 km, so at 7000 km behind: 6300 km off the axis is umbra,
//   6380 km is penumbra and 6450 km is sunlit. The cylindrical model calls 6380 km sunlit (beyond R = 6378.137 km).
//   A geostationary satellite (r = 42164 km) on the night side but 10 deg off the Sun line is 7322 km off the axis,
//   outside the shadow: it is sunlit.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../site/lib/satellite-visibility.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const D2R = Math.PI / 180;
const R = 6378.137;

test("visibility: GMST, Vallado Example 3-5 and J2000.0", () => {
  const ms = Date.UTC(1992, 7, 20, 12, 14, 0);
  near(V.julianDate(ms), 2448855.009722, 1e-6, "JD");
  near(V.gmst(V.julianDate(ms)) / D2R, 152.578787810, 1e-7, "GMST 1992");
  near(V.gmst(2451545.0) / D2R, 280.46061837, 1e-7, "GMST J2000");
});

test("visibility: Sun position, Vallado Example 5-1", () => {
  const s = V.sunPosition(V.julianDate(Date.UTC(2006, 3, 2)));
  near(s.x / V.AU, 0.9771945, 2e-6, "x");
  near(s.y / V.AU, 0.1924424, 2e-6, "y");
  near(s.z / V.AU, 0.0834308, 2e-6, "z");
});

test("visibility: WGS 84 geodetic to Earth-fixed and back", () => {
  const r = V.geodeticToEcef(45, 0, 0);
  near(r.x, 4517.5909, 1e-4, "x");
  near(r.y, 0, 1e-9, "y");
  near(r.z, 4487.3484, 1e-4, "z");
  const g = V.ecefToGeodetic(r);
  near(g.latDeg, 45, 1e-9, "lat");
  near(g.hKm, 0, 1e-6, "h");
  const g2 = V.ecefToGeodetic(V.geodeticToEcef(-33.9, 151.2, 420));
  near(g2.latDeg, -33.9, 1e-9, "lat2");
  near(g2.lonDeg, 151.2, 1e-9, "lon2");
  near(g2.hKm, 420, 1e-6, "h2");
  near(V.ecefToGeodetic({ x: 0, y: 0, z: 7000 }).latDeg, 90, 1e-12, "pole");
});

test("visibility: look angles by hand from the equator at 0 E", () => {
  const obs = { latDeg: 0, lonDeg: 0, hKm: 0 };
  const up = V.lookAngles(obs, { x: R + 500, y: 0, z: 0 });
  near(up.elDeg, 90, 1e-9, "overhead el");
  near(up.rangeKm, 500, 1e-9, "overhead range");
  const east = V.lookAngles(obs, { x: R, y: 1000, z: 0 });
  near(east.azDeg, 90, 1e-9, "east az");
  near(east.elDeg, 0, 1e-9, "east el");
  const north = V.lookAngles(obs, { x: R, y: 0, z: 1000 });
  near(north.azDeg, 0, 1e-9, "north az");
  const south = V.lookAngles(obs, { x: R + 1000, y: 0, z: -1000 });
  near(south.azDeg, 180, 1e-9, "south az");
  near(south.elDeg, 45, 1e-9, "south el");
  near(south.rangeKm, 1414.2136, 1e-4, "south range");
  // Range rate: moving straight up from overhead at 2 km/s opens the range at 2 km/s.
  near(V.lookAngles(obs, { x: R + 500, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }).rangeRateKmS, 2, 1e-12, "range rate");
});

test("visibility: TEME to Earth-fixed rotation", () => {
  // Turning the frame through 90 deg puts a TEME +y vector on the Earth-fixed +x axis.
  const r = V.temeToEcef({ x: 0, y: 7000, z: 100 }, 90 * D2R);
  near(r.x, 7000, 1e-9, "x");
  near(r.y, 0, 1e-9, "y");
  near(r.z, 100, 1e-12, "z");
});

test("visibility: observe() with a fixed synthetic satellite at J2000.0", () => {
  // At J2000.0 Greenwich faces right ascension 280.4606 deg, so a TEME point at that angle is over 0 N 0 E.
  const th = 280.46061837 * D2R;
  const prop = () => ({ position: { x: (R + 500) * Math.cos(th), y: (R + 500) * Math.sin(th), z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
  const o = V.observe(prop, Date.UTC(2000, 0, 1, 12), { latDeg: 0, lonDeg: 0, hKm: 0 });
  near(o.elDeg, 90, 1e-4, "elevation");
  near(o.rangeKm, 500, 1e-3, "range");
  near(o.subLatDeg, 0, 1e-6, "sub-point lat");
  near(o.subLonDeg, 0, 1e-4, "sub-point lon");
  near(o.heightKm, 500, 1e-3, "height");
  // 12:00 UTC on 1 January at 0 E: the Sun is up (about 67 deg, 90 - 23 deg declination), so not visible to the eye.
  assert.ok(o.sunElDeg > 60 && o.sunElDeg < 70, `sun el ${o.sunElDeg}`);
  assert.equal(o.visible, false);
  assert.equal(o.reason, "the sky is too bright");
  assert.equal(V.observe(() => ({ position: false }), 0, { latDeg: 0, lonDeg: 0, hKm: 0 }), null);
});

test("visibility: Earth's shadow, cylindrical and conical, by hand", () => {
  const sun = { x: V.AU, y: 0, z: 0 };
  assert.equal(V.shadowCylindrical({ x: -7000, y: 0, z: 0 }, sun), "umbra");
  assert.equal(V.shadowCylindrical({ x: 7000, y: 0, z: 0 }, sun), "sunlit");
  assert.equal(V.shadowCylindrical({ x: -7000, y: 6380, z: 0 }, sun), "sunlit");
  assert.equal(V.shadowConical({ x: -7000, y: 0, z: 0 }, sun).state, "umbra");
  assert.equal(V.shadowConical({ x: -7000, y: 6300, z: 0 }, sun).state, "umbra");
  const pen = V.shadowConical({ x: -7000, y: 6380, z: 0 }, sun);
  assert.equal(pen.state, "penumbra");
  assert.ok(pen.fraction > 0 && pen.fraction < 1);
  assert.ok(V.shadowConical({ x: -7000, y: 6400, z: 0 }, sun).fraction > pen.fraction);
  assert.equal(V.shadowConical({ x: -7000, y: 6450, z: 0 }, sun).state, "sunlit");
  assert.equal(V.shadowConical({ x: 7000, y: 0, z: 0 }, sun).state, "sunlit");
  // Geostationary, night side, 10 deg off the Sun line: 42164 sin 10 = 7322 km off the axis, so sunlit.
  // (The old tool's "sunward side only" test called every night-side satellite dark.)
  const geo = { x: -42164 * Math.cos(10 * D2R), y: 42164 * Math.sin(10 * D2R), z: 0 };
  assert.equal(V.shadowCylindrical(geo, sun), "sunlit");
  assert.equal(V.shadowConical(geo, sun).state, "sunlit");
});

test("visibility: verdict rules", () => {
  assert.equal(V.verdict(30, "sunlit", -10, 0).visible, true);
  assert.equal(V.verdict(30, "penumbra", -10, 0).visible, true);
  assert.equal(V.verdict(30, "umbra", -10, 0).reason, "in the Earth's shadow");
  assert.equal(V.verdict(-1, "sunlit", -10, 0).reason, "below the horizon");
  assert.equal(V.verdict(5, "sunlit", -10, 10).visible, false);
  assert.equal(V.verdict(30, "sunlit", -3, 0).reason, "the sky is too bright");
  assert.equal(V.verdict(30, "sunlit", -6, 0).visible, true);
});

test("visibility: compass names and UTC input parsing", () => {
  assert.equal(V.compass(0), "N");
  assert.equal(V.compass(359), "N");
  assert.equal(V.compass(22.5), "NNE");
  assert.equal(V.compass(180), "S");
  assert.equal(V.compass(-90), "W");
  assert.equal(V.parseUtcInput("2024-10-24T12:00"), Date.UTC(2024, 9, 24, 12));
  assert.equal(V.parseUtcInput("2024-10-24T12:00:30"), Date.UTC(2024, 9, 24, 12, 0, 30));
  assert.ok(Number.isNaN(V.parseUtcInput("24/10/2024")));
  assert.equal(V.toUtcInput(Date.UTC(2024, 9, 24, 12, 0, 30, 900)), "2024-10-24T12:00:30");
});

test("visibility: rejects bad input", () => {
  assert.throws(() => V.geodeticToEcef(91, 0, 0));
  assert.throws(() => V.geodeticToEcef(NaN, 0, 0));
  assert.throws(() => V.lookAngles({ latDeg: 0, lonDeg: 0, hKm: 0 }, { x: R, y: 0, z: 0 }));
  assert.throws(() => V.lookAngles({ latDeg: 0, lonDeg: 0, hKm: 0 }, { x: "a", y: 0, z: 0 }));
  assert.throws(() => V.shadowConical(null, { x: 1, y: 0, z: 0 }));
});
