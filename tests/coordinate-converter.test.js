// Coordinate Converter. References:
//  - DMS and DDM: 1 degree = 60 minutes = 3600 seconds (definition). Hand example: 80.6490 W:
//    0.6490 * 60 = 38.94 minutes, 0.94 * 60 = 56.40 seconds, so 80 38 56.40 W and 80 38.9400 W.
//    Rounding carry, by hand: 10 59 59.99999 N is 10.999999997 deg; to 0.01 s it is 39599.99999 s -> 39600.00 s
//    = 11 00 00.00 N (never "10 59 60.00"). 28.999999999 deg = 104399.9999964 s -> 104400.00 s = 29 00 00.00.
//    In DDM, 10.9999999 deg = 659.999994 minutes -> 660.0000 = 11 00.0000.
//  - UTM: Snyder, Map Projections: A Working Manual (USGS PP 1395, 1987), transverse Mercator series eqs. 8-9 to
//    8-11, and his worked example on p. 269: Clarke 1866 (a = 6,378,206.4 m, e^2 = 0.00676866), phi = 40 30 N,
//    lambda = 73 30 W, lambda0 = 75 W, k0 = 0.9996 gives x = 127,106.5 m, y = 4,484,124.4 m, k = 0.9997989.
//    WGS 84 meridian arc (Snyder eq. 3-21): 4,984,944.4 m from the equator to 45 N and 10,001,965.7 m to the pole
//    (the WGS 84 quarter meridian), so a point at 45 N on a central meridian has UTM northing
//    0.9996 * 4,984,944.378 = 4,982,950.40 m and easting 500,000 m.
//  - Zones and bands: NGA/DMA TM 8358.2 / 8358.1: zone = floor((lon + 180) / 6) + 1; 32V for 56-64 N, 3-12 E;
//    Svalbard 31X, 33X, 35X, 37X for 72-84 N; bands C to X in 8 deg steps from 80 S, X spanning 72-84 N.
//  - MGRS lettering for WGS 84 (TM 8358.1), by hand: column letters A-H for zones 1, 4, 7..., J-R for 2, 5, 8...,
//    S-Z for 3, 6, 9...; the n-th 100 km column east (100-200 km is the first) takes the n-th letter. Row letters
//    ABCDEFGHJKLMNPQRSTUV repeat every 2,000 km north of the equator, starting at A in odd zones, F in even ones.
//    45 N on zone 33's central meridian (15 E): easting 500,000 is the 5th column of S-Z = W; northing 4,982,950
//    is row 49, 49 mod 20 = 9 -> K; band T. So 33TWK 00000 82950.
//    45 N, 9 E (zone 32, even): column J-R, 5th = N; row (9 + 5) mod 20 = 14 -> Q. So 32TNQ 00000 82950.
//    45 S, 15 E: northing 10,000,000 - 4,982,950.40 = 5,017,049.60, row 50 mod 20 = 10 -> L. So 33GWL 00000 17049.
//    Digits are truncated: easting 534,327.9 and northing 3,160,629.99 in 17R give 17RNM 34327 60629.
const test = require("node:test");
const assert = require("node:assert/strict");
const cc = require("../site/lib/coordinate-converter.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("DMS and DDM by hand: 80.6490 W", () => {
  const d = cc.toDMS(-80.649, "lon");
  assert.equal(d.deg, 80); assert.equal(d.min, 38); near(d.sec, 56.4, 1e-9, "seconds");
  assert.equal(d.text, "80° 38' 56.40\" W");
  assert.equal(cc.toDDM(-80.649, "lon").text, "80° 38.9400' W");
  assert.equal(cc.toDD(-80.649, "lon").text, "-80.649000°");
  assert.equal(cc.toDD(-80.649, "lon").hemiText, "80.649000° W");
  assert.equal(cc.toDMS(5.0875, "lat").text, "5° 05' 15.00\" N");   // 0.0875 * 60 = 5.25 min, 0.25 * 60 = 15 s
});

test("rounding carries into minutes and degrees (no 60.00 seconds)", () => {
  const dd = cc.parseAngle("10 59 59.99999 N", "lat");
  near(dd, 10 + 59 / 60 + 59.99999 / 3600, 1e-12, "parsed");
  assert.equal(cc.toDMS(dd, "lat").text, "11° 00' 00.00\" N");
  assert.equal(cc.toDMS(28.999999999, "lat").text, "29° 00' 00.00\" N");
  assert.equal(cc.toDMS(-179.9999999, "lon").text, "180° 00' 00.00\" W");
  assert.equal(cc.toDDM(10.9999999, "lat").text, "11° 00.0000' N");
  assert.equal(cc.toDMS(10.99999, "lat", 0).text, "11° 00' 00\" N");   // 39599.964 s -> 39600 s
  // A tiny negative value that rounds to zero is not given a southern or western letter.
  assert.equal(cc.toDMS(-0.0000001, "lat").text, "0° 00' 00.00\" N");
  assert.equal(cc.toDD(-0.0000001, "lon").text, "0.000000°");
});

test("parsing DD, DDM and DMS in the common written forms", () => {
  near(cc.parseAngle("28.5721", "lat"), 28.5721, 1e-12, "DD");
  near(cc.parseAngle("-80.649", "lon"), -80.649, 1e-12, "signed DD");
  near(cc.parseAngle("80°38'56.4\"W", "lon"), -80.649, 1e-12, "DMS symbols");
  near(cc.parseAngle("80° 38′ 56.4″ W", "lon"), -80.649, 1e-12, "DMS primes");
  near(cc.parseAngle("W 80 38.94", "lon"), -80.649, 1e-12, "leading letter DDM");
  near(cc.parseAngle("80:38:56.4W", "lon"), -80.649, 1e-12, "colons");
  near(cc.parseAngle("s 33 51 35.9", "lat"), -(33 + 51 / 60 + 35.9 / 3600), 1e-12, "lower-case letter");
  // Round trip through the formatter: 2-decimal seconds hold the value to 0.005 s.
  const t = cc.toDMS(-33.859972, "lat").text;
  near(cc.parseAngle(t, "lat"), -33.859972, 0.005 / 3600, "round trip");
});

test("parsing rejects malformed or out-of-range input", () => {
  assert.throws(() => cc.parseAngle("", "lat"), /empty/);
  assert.throws(() => cc.parseAngle("91", "lat"), /between/);
  assert.throws(() => cc.parseAngle("181 E", "lon"), /between/);
  assert.throws(() => cc.parseAngle("28 34 19 E", "lat"), /N or S/);
  assert.throws(() => cc.parseAngle("80 38 W", "lat"), /N or S/);
  assert.throws(() => cc.parseAngle("28 60 00 N", "lat"), /minutes/);
  assert.throws(() => cc.parseAngle("28 30 60 N", "lat"), /seconds/);
  assert.throws(() => cc.parseAngle("28.5 30 N", "lat"), /last part/);
  assert.throws(() => cc.parseAngle("-28 N", "lat"), /not both/);
  assert.throws(() => cc.parseAngle("28 3o N", "lat"), /not a number/);
  assert.throws(() => cc.parseAngle("1 2 3 4", "lat"), /degrees/);
  assert.throws(() => cc.toDMS(100, "lat"), /between/);
  assert.throws(() => cc.toDMS(NaN, "lon"), /number/);
});

test("transverse Mercator: Snyder's worked example (Clarke 1866)", () => {
  const t = cc.tmForward(40.5, -73.5, -75, cc.ELLIPSOIDS.CLARKE1866, 0.9996);
  near(t.x, 127106.5, 0.05, "x");
  near(t.y, 4484124.4, 0.05, "y");
  near(t.k, 0.9997989, 5e-8, "scale factor");
});

test("WGS 84 meridian arc and UTM northing on a central meridian", () => {
  near(cc.tmForward(45, 15, 15).M, 4984944.4, 0.05, "arc to 45 N");
  near(cc.tmForward(90, 15, 15).M, 10001965.7, 0.05, "quarter meridian");
  const u = cc.toUTM(45, 15);
  assert.equal(u.zone, 33); assert.equal(u.band, "T"); assert.equal(u.hemisphere, "N");
  near(u.easting, 500000, 1e-6, "easting");
  near(u.northing, 4982950.40, 0.01, "northing");
  near(u.scale, 0.9996, 1e-12, "scale on the central meridian");
  // South of the equator the false northing is added: at 45 S the northing is 10,000,000 - 4,982,950.40.
  const s = cc.toUTM(-45, 15);
  assert.equal(s.hemisphere, "S"); assert.equal(s.band, "G");
  near(s.northing, 10000000 - 4982950.40, 0.01, "southern northing");
  // Equal distances east and west of the central meridian give eastings mirrored about 500,000 m.
  const e = cc.toUTM(45, 17), w = cc.toUTM(45, 13);
  near(e.easting - 500000, 500000 - w.easting, 1e-6, "mirror");
  near(e.northing, w.northing, 1e-6, "same northing");
});

test("UTM zones, exceptions and bands (TM 8358.1/8358.2)", () => {
  assert.equal(cc.utmZone(0, -180), 1);
  assert.equal(cc.utmZone(0, -177.0001), 1);
  assert.equal(cc.utmZone(0, -174), 2);
  assert.equal(cc.utmZone(28.5721, -80.649), 17);
  assert.equal(cc.utmZone(0, 180), 60);
  assert.equal(cc.utmZone(60, 5), 32);      // Norway: 32V widened west
  assert.equal(cc.utmZone(55.9, 5), 31);
  assert.equal(cc.utmZone(78, 8), 31);      // Svalbard
  assert.equal(cc.utmZone(78, 10), 33);
  assert.equal(cc.utmZone(78, 25), 35);
  assert.equal(cc.utmZone(78, 40), 37);
  assert.equal(cc.latBand(-80), "C");
  assert.equal(cc.latBand(0), "N");
  assert.equal(cc.latBand(-0.0001), "M");
  assert.equal(cc.latBand(28.57), "R");
  assert.equal(cc.latBand(72), "X");
  assert.equal(cc.latBand(84), "X");
  assert.equal(cc.latBand(85), null);
  assert.equal(cc.toUTM(60, 5).centralMeridian, 9);
  assert.throws(() => cc.toUTM(85, 0), /80° S to 84° N/);
  assert.throws(() => cc.toUTM(-81, 0), /80° S to 84° N/);
});

test("MGRS lettering and truncation, by hand (TM 8358.1)", () => {
  assert.equal(cc.toMGRS(cc.toUTM(45, 15)).text, "33TWK0000082950");
  assert.equal(cc.toMGRS(cc.toUTM(45, 9)).text, "32TNQ0000082950");
  assert.equal(cc.toMGRS(cc.toUTM(-45, 15)).text, "33GWL0000017049");
  const u = { zone: 17, band: "R", easting: 534327.9, northing: 3160629.99 };
  assert.equal(cc.toMGRS(u).text, "17RNM3432760629");
  assert.equal(cc.toMGRS(u).spaced, "17R NM 34327 60629");
  assert.equal(cc.toMGRS(u, 4).text, "17RNM34326062");
  assert.equal(cc.toMGRS(u, 1).text, "17RNM36");
  // The edge of a 100 km square: 599,999.99 m east is still column N (the 5th), digits 99999.
  assert.equal(cc.toMGRS({ zone: 17, band: "R", easting: 599999.99, northing: 3160629 }).text, "17RNM9999960629");
  assert.throws(() => cc.toMGRS(u, 6), /digits/);
  assert.throws(() => cc.toMGRS({ zone: 1, band: null, easting: 5e5, northing: 0 }), /80° S/);
});
