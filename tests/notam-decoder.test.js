// NOTAM Decoder. References: ICAO PANS-AIM (Doc 10066) Appendix 3 and Doc 8126 (NOTAM format: header, Q line,
// items A-G), ICAO Doc 8400 PANS-ABC (NOTAM Code subjects and conditions, abbreviations); Chris Veness,
// movable-type.co.uk, for the haversine distance and destination point on a 6,371 km sphere.
//
// The sample NOTAMs below are written for this test; the series, numbers and places are made up but realistic.
// Worked numbers, by hand:
// - Q line "4530N01000E025": 45 deg 30 min N = 45.5, 010 deg 00 min E = 10.0, radius 25 NM.
// - Polygon vertex "452000N0094000E": 45 + 20/60 = 45.333333 N, 9 + 40/60 = 9.666667 E;
//   "454000N0102000E": 45.666667 N, 10.333333 E. The fifth point repeats the first, so 4 vertices.
// - "500210N0083412E": 50 + 2/60 + 10/3600 = 50.036111 N; 8 + 34/60 + 12/3600 = 8.570000 E.
// - "2830.50N08035.25W": 28 + 30.50/60 = 28.508333 N; -(80 + 35.25/60) = -80.587500.
// - "N453012E0123045" and "453012N0123045E": 45 + 30/60 + 12/3600 = 45.503333; 12 + 30/60 + 45/3600 = 12.5125.
// - "453012.5N0123045.5E": 45.503472, 12.512639. "3352S15112E": -33.866667, 151.2.
// - One arc minute of latitude on the 6,371 km sphere: 6,371,000 x pi / 10,800 = 1,853.25 m = 1.000675 NM.
// - 25 NM due north of 45.5 N: 25 x 1852 / 6,371,000 = 0.00726731 rad = 0.416386 deg, so 45.916386 N.
// - "2612010800" is 1 Dec 2026 08:00 UTC; "2613011200" has month 13, which does not exist.
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../site/lib/notam-decoder.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

const POLYGON = `(D0412/26 NOTAMN
Q) LIMM/QRDCA/IV/BO/W/000/150/4530N01000E025
A) LIMM B) 2612010800 C) 2612051600
D) DAILY 0800-1600
E) TEMPORARY DANGER AREA ACT WI AREA 452000N0094000E-454000N0094000E-
454000N0102000E-452000N0102000E-452000N0094000E.
MISSILE FIRING.
F) SFC G) FL150)`;

const PERM = `(A2345/26 NOTAMN
Q) EDGG/QOBCE/IV/M/A/000/005/5002N00834E005
A) EDDF B) 2611260900 C) PERM
E) CRANE ERECTED PSN 500210N0083412E, HGT 210FT AGL, ELEV 560FT AMSL. OBST LGT.)`;

const CIRCLE_EST = `(C0789/26 NOTAMR C0780/26
Q) KZJX/QWULW/IV/BO/W/000/040/2830N08035W010
A) KZJX B) 2612031400 C) 2612032000 EST
E) UNMANNED ACFT ACT WI 5NM RADIUS OF 2830.50N08035.25W.
F) SFC G) 4000FT AMSL)`;

const BAD = `(B0100/26 NOTAMN A0099/26
Q) KZNY/QXYZZ/IV/NBQ/E/400/200/4060N07350W015
A) KZNY B) 2613011200 C) 2612011300 EST
E) AIRSPACE NOTE. PSN 406000N0735000W.`;

test("polygon NOTAM: header, Q line, items and a 4-vertex polygon", () => {
  const r = N.parse(POLYGON, Date.UTC(2026, 11, 2, 12, 0));
  assert.deepEqual(r.errors, []);
  assert.equal(r.header.id, "D0412/26");
  assert.equal(r.header.type, "N");
  assert.equal(r.q.fir, "LIMM");
  assert.equal(r.q.qcode.subject, "Danger area");
  assert.equal(r.q.qcode.condition, "Activated");
  assert.equal(r.q.qcode.subjectGroup, "Airspace restrictions (navigation warnings)");
  assert.equal(r.q.traffic.length, 2);
  assert.deepEqual(r.q.scope, ["Navigation warning"]);
  assert.equal(r.q.lowerFL, 0);
  assert.equal(r.q.upperFL, 150);
  near(r.q.centre.lat, 45.5, 1e-9, "Q lat");
  near(r.q.centre.lon, 10.0, 1e-9, "Q lon");
  assert.equal(r.q.radiusNm, 25);
  assert.deepEqual(r.a, ["LIMM"]);
  assert.equal(r.b.iso, "2026-12-01T08:00:00Z");
  assert.equal(r.c.iso, "2026-12-05T16:00:00Z");
  assert.equal(r.d, "DAILY 0800-1600");
  assert.equal(r.f.text, "Surface");
  assert.match(r.g.text, /^Flight level 150/);
  assert.equal(r.status, "in force");
  const polys = r.geometry.features.filter((f) => f.kind === "polygon");
  assert.equal(polys.length, 1);
  assert.equal(polys[0].points.length, 4);
  near(polys[0].points[0].lat, 45.333333, 1e-6, "v0 lat");
  near(polys[0].points[0].lon, 9.666667, 1e-6, "v0 lon");
  near(polys[0].points[2].lat, 45.666667, 1e-6, "v2 lat");
  near(polys[0].points[2].lon, 10.333333, 1e-6, "v2 lon");
  assert.equal(r.warnings.length, 0, r.warnings.join(" | "));
});

test("PERM NOTAM: permanent end, a single obstacle point and abbreviations", () => {
  const r = N.parse(PERM, Date.UTC(2027, 0, 1));
  assert.deepEqual(r.errors, []);
  assert.equal(r.c.perm, true);
  assert.equal(r.c.iso, null);
  assert.equal(r.status, "in force");
  assert.equal(r.q.qcode.subject, "Obstacle");
  assert.equal(r.q.qcode.condition, "Erected");
  assert.deepEqual(r.q.purpose, [N.PURPOSE.M]);
  assert.deepEqual(r.q.scope, ["Aerodrome"]);
  const pts = r.geometry.features.filter((f) => f.kind === "point");
  assert.equal(pts.length, 1);
  near(pts[0].points[0].lat, 50.036111, 1e-6, "lat");
  near(pts[0].points[0].lon, 8.570000, 1e-6, "lon");
  const abbr = r.abbreviations.map((a) => a.abbr);
  for (const a of ["PSN", "HGT", "FT", "AGL", "ELEV", "AMSL", "OBST", "LGT"]) assert.ok(abbr.includes(a), a);
});

test("replacing NOTAM: EST end, decimal-minute centre with a radius, F and G limits", () => {
  const r = N.parse(CIRCLE_EST, Date.UTC(2026, 11, 3, 21, 0));
  assert.deepEqual(r.errors, []);
  assert.equal(r.header.type, "R");
  assert.equal(r.header.refersTo, "C0780/26");
  assert.equal(r.c.est, true);
  assert.equal(r.status, "past its estimated end");
  assert.equal(r.q.qcode.subject, "Unmanned aircraft");
  assert.equal(r.q.qcode.condition, "Will take place");
  const c = r.geometry.features.filter((f) => f.kind === "circle");
  assert.equal(c.length, 1);
  near(c[0].centre.lat, 28.508333, 1e-6, "lat");
  near(c[0].centre.lon, -80.5875, 1e-6, "lon");
  assert.equal(c[0].radiusNm, 5);
  assert.equal(r.g.text, "4,000 ft above mean sea level");
  assert.equal(r.warnings.length, 0, r.warnings.join(" | "));
});

test("bad NOTAM: every broken field is reported, nothing invented", () => {
  const r = N.parse(BAD);
  const all = r.errors.join(" | ");
  assert.match(all, /does not refer to another NOTAM/);
  assert.match(all, /purpose letter "Q"/);
  assert.match(all, /lower limit FL400 is above the upper limit FL200/);
  assert.match(all, /minutes 60/);
  assert.match(all, /month 13/);
  assert.equal(r.q.centre, undefined);
  assert.equal(r.geometry.qCircle, null);
  assert.equal(r.geometry.features.length, 0);
  const w = r.warnings.join(" | ");
  assert.match(w, /subject "XY" is not in the NOTAM Code/);
  assert.match(w, /condition "ZZ" is not in the NOTAM Code/);
  assert.match(w, /Coordinate "406000N0735000W" skipped/);
  assert.match(w, /no closing/);
  assert.equal(r.q.qcode.subjectGroup, null);
});

test("structural errors: short Q line, missing items, C before B, 2400, wrong format", () => {
  const r = N.parse("A0001/26 NOTAMN\nQ) EGTT/QMRLC/IV/NBO/A/000\nA) EGLL B) 2612011200 C) 2612011100\nE) RWY 09L/27R CLSD.");
  const all = r.errors.join(" | ");
  assert.match(all, /expected 8 fields/);
  assert.match(all, /not after item B/);
  assert.equal(r.q.qcode.subject, "Runway");
  assert.equal(r.q.qcode.condition, "Closed");
  const r2 = N.parse("A0002/26 NOTAMN\nQ) EGTT/QMRLC/IV/NBO/A/000/999/5129N00028W005\nA) EGLL B) 2612012400 C) 2612311200");
  assert.match(r2.errors.join(" | "), /2359, not 2400/);
  assert.match(r2.errors.join(" | "), /Item E\) is missing/);
  assert.match(N.parse("A0003/26 NOTAMR\nQ) EGTT/QMRLC/IV/NBO/A/000/999/5129N00028W005\nA) EGLL B) 2612011200 C) 2612021200\nE) X").errors.join(), /must name the NOTAM it replaces/);
  assert.throws(() => N.parse("!FDC 6/1234 ZNY NY..AIRSPACE"), /US domestic-format/);
  assert.throws(() => N.parse("   "));
  assert.throws(() => N.parseDateTime("2611310000"), /day 31/);
});

test("coordinate formats in item E", () => {
  const f = (s) => N.findCoordinates(s).points;
  const a = f("N453012E0123045");
  near(a[0].lat, 45.503333, 1e-6, "hemisphere first lat"); near(a[0].lon, 12.5125, 1e-9, "hemisphere first lon");
  const b = f("PSN 453012N0123045E.");
  near(b[0].lat, 45.503333, 1e-6, "dms lat"); near(b[0].lon, 12.5125, 1e-9, "dms lon");
  const c = f("4530N01230E");
  near(c[0].lat, 45.5, 1e-9, "dm lat"); near(c[0].lon, 12.5, 1e-9, "dm lon");
  const d = f("4530.50N01230.25E");
  near(d[0].lat, 45.508333, 1e-6, "decimal min lat"); near(d[0].lon, 12.504167, 1e-6, "decimal min lon");
  const e = f("453012.5N0123045.5E");
  near(e[0].lat, 45.503472, 1e-6, "decimal sec lat"); near(e[0].lon, 12.512639, 1e-6, "decimal sec lon");
  const s = f("3352S15112E 4530N 01230E");
  near(s[0].lat, -33.866667, 1e-6, "south"); near(s[0].lon, 151.2, 1e-9, "east");
  assert.equal(s.length, 2, "a space between latitude and longitude is allowed");
  assert.equal(f("RWY 09/27 0800-1600 FL150 45301N012300E").length, 0, "odd digit counts are not coordinates");
  assert.equal(N.findCoordinates("9130N01000E").problems.length, 1, "latitude over 90");
  assert.equal(N.findCoordinates("4530N18100E").problems.length, 1, "longitude over 180");
});

test("geometry: lines, km radius, a run of separate points, Q-circle check", () => {
  const g = N.extractGeometry("ROUTE BTN 4500N01000E AND 4600N01100E. OBST AT 4400N00900E. CIRCLE RADIUS 10KM CENTRE 4300N00800E.");
  assert.deepEqual(g.features.map((x) => x.kind), ["line", "point", "circle"]);
  near(g.features[2].radiusNm, 10000 / 1852, 1e-9, "10 km in NM");
  const r = N.parse("A0004/26 NOTAMN\nQ) LIMM/QWELW/IV/BO/W/000/100/4530N01000E005\nA) LIMM B) 2612011200 C) 2612021200\nE) EXERCISE AT 4700N01000E.");
  assert.match(r.warnings.join(" | "), /beyond its 5 NM radius/);
});

test("distance and circle on the sphere", () => {
  near(N.distanceNm({ lat: 0, lon: 0 }, { lat: 1 / 60, lon: 0 }), 1.000675, 1e-6, "one arc minute");
  const ring = N.circlePolygon(45.5, 10, 25, 72);
  assert.equal(ring.length, 72);
  near(ring[0].lat, 45.916386, 1e-6, "north point");
  near(ring[0].lon, 10, 1e-9, "north point lon");
  for (const p of ring) near(N.distanceNm({ lat: 45.5, lon: 10 }, p), 25, 1e-6, "radius");
});

test("Q code tables: groups, specials and unknowns", () => {
  assert.equal(N.decodeQCode("QKKKK").subject, "Checklist");
  assert.match(N.decodeQCode("QXXXX").subject, /Plain language/);
  assert.match(N.decodeQCode("QRTTT").condition, /Trigger NOTAM/);
  assert.equal(N.decodeQCode("QNVAS").subject, "VOR");
  assert.equal(N.decodeQCode("QNVAS").condition, "Unserviceable");
  assert.equal(N.decodeQCode("QNVAS").conditionGroup, "Availability");
  assert.equal(N.decodeQCode("QGWAU").subjectGroup, "GNSS services");
  assert.equal(N.decodeQCode("Q12").subject, null);
  for (const k of Object.keys(N.SUBJECTS)) assert.ok(N.SUBJECT_GROUPS[k[0]], k);
  for (const k of Object.keys(N.CONDITIONS)) assert.ok(N.CONDITION_GROUPS[k[0]], k);
});
