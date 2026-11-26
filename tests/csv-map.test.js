// CSV to Map Plotter. References: RFC 4180 (CSV: quoted fields, "" for a quote inside one); Chris Veness,
// "Calculate distance, bearing and more between latitude/longitude points" (movable-type.co.uk): haversine
// distance, initial bearing and intermediate point on a sphere of radius 6371 km.
// Worked examples:
//   Veness: 50 deg 03' 59" N, 005 deg 42' 53" W to 58 deg 38' 38" N, 003 deg 04' 12" W: 968.9 km, initial
//   bearing 009 deg 07' 11" (9.11972 deg), midpoint 54 deg 21' 44" N, 004 deg 31' 50" W (54.36222, -4.53056).
//   One degree of arc = 2 pi R / 360 = 111.19493 km, so (0,0) -> (0,1) -> (1,1) is 222.38985 km, bearings 90 then 0.
//   28 deg 30' 15" = 28 + 30/60 + 15/3600 = 28.504167 deg.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../site/lib/csv-map.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const dms = (d, m, s) => d + m / 60 + s / 3600;

test("RFC 4180: quoted fields, doubled quotes, line breaks inside quotes, CRLF and a BOM", () => {
  const rows = C.parseCsv('﻿name,lat,lon,notes\r\n"Smith, John",28.5,-80.6,"He said ""hi"""\r\n\r\n"Two\nlines",1,2,\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].cells, ["Smith, John", "28.5", "-80.6", 'He said "hi"']);
  assert.deepEqual(rows[2].cells, ["Two\nlines", "1", "2", ""]);
  assert.equal(rows[2].line, 4);
  assert.throws(() => C.parseCsv('a,"open\n1,2'), /never closed/);
  assert.equal(C.detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(C.detectDelimiter("a\tb\tc"), "\t");
  assert.equal(C.detectDelimiter('"x,y";b;c'), ";");   // the comma is inside quotes
});

test("coordinates: decimal, hemisphere letters, degrees-minutes-seconds, and bad values", () => {
  near(C.parseCoord("28°30'15\"N", "lat"), 28.504167, 1e-6, "DMS");
  near(C.parseCoord("28 30 15 S", "lat"), -28.504167, 1e-6, "DMS south");
  near(C.parseCoord("28°30.25'N", "lat"), 28.504167, 1e-6, "degrees and decimal minutes");
  assert.equal(C.parseCoord("80.6W", "lon"), -80.6);
  assert.equal(C.parseCoord("W 80.6", "lon"), -80.6);
  assert.equal(C.parseCoord("-80.6", "lon"), -80.6);
  assert.equal(C.parseCoord("28,5", "lat"), 28.5);
  assert.ok(Number.isNaN(C.parseCoord("95", "lat")));
  assert.ok(Number.isNaN(C.parseCoord("181", "lon")));
  assert.ok(Number.isNaN(C.parseCoord("28.5E", "lat")));     // E is not a latitude
  assert.ok(Number.isNaN(C.parseCoord("-80.6W", "lon")));    // contradictory
  assert.ok(Number.isNaN(C.parseCoord("28 75 0 N", "lat"))); // 75 minutes
  assert.ok(Number.isNaN(C.parseCoord("abc", "lat")));
  assert.ok(Number.isNaN(C.parseCoord("", "lat")));
});

test("columns: header names in any order, or the old name,lat,lon,description layout", () => {
  const h = C.readPoints("Longitude,Site,Latitude,Elev\n-80.6,KSC,28.5,3\n-120.5,VSFB,34.7,100");
  assert.equal(h.columns.header, true);
  assert.deepEqual(h.points.map((p) => [p.name, p.lat, p.lon]), [["KSC", 28.5, -80.6], ["VSFB", 34.7, -120.5]]);
  assert.deepEqual(h.points[0].extra, { Elev: "3" });
  const old = C.readPoints("Kennedy,28.5,-80.6,Primary site\nWallops,37.9,-75.5,Suborbital");
  assert.equal(old.columns.header, false);
  assert.equal(old.points[1].name, "Wallops");
  assert.equal(old.points[1].description, "Suborbital");
  const ll = C.readPoints("28.5,-80.6,Kennedy\n37.9,-75.5,Wallops");
  assert.deepEqual([ll.points[0].name, ll.points[0].lat, ll.points[0].lon], ["Kennedy", 28.5, -80.6]);
  const semi = C.readPoints("name;lat;lon\nA;28,5;-80,6");
  assert.deepEqual([semi.points[0].lat, semi.points[0].lon], [28.5, -80.6]);
  assert.throws(() => C.readPoints("a,b\nc,d"), /No pair of latitude and longitude/);
  assert.throws(() => C.readPoints("   "), /no CSV text/);
});

test("bad rows are reported with their line number, not dropped silently", () => {
  const r = C.readPoints("name,lat,lon\nA,28.5,-80.6\nB,128.5,-80.6\nC,28.5,\nD,10,20");
  assert.equal(r.points.length, 2);
  assert.deepEqual(r.errors.map((e) => e.line), [3, 4]);
  assert.match(r.errors[0].reason, /latitude '128.5'/);
  assert.match(r.errors[1].reason, /longitude ''/);
});

test("distance and bearing along the points: Veness's worked example and one-degree legs", () => {
  const le = { name: "LE", lat: dms(50, 3, 59), lon: -dms(5, 42, 53) }, jog = { name: "JoG", lat: dms(58, 38, 38), lon: -dms(3, 4, 12) };
  const v = C.legs([le, jog]);
  near(v.totalKm, 968.9, 0.05, "distance");
  near(v.legs[0].bearing, dms(9, 7, 11), 1 / 3600, "initial bearing");
  const r = C.legs([{ name: "a", lat: 0, lon: 0 }, { name: "b", lat: 0, lon: 1 }, { name: "c", lat: 1, lon: 1 }]);
  near(r.totalKm, 222.38985, 1e-4, "two legs");
  near(r.legs[0].bearing, 90, 1e-9, "east"); near(r.legs[1].bearing, 0, 1e-9, "north");
  near(r.legs[0].totalKm, 111.19493, 1e-4, "running total");
  assert.equal(C.legs([le]).totalKm, 0);
  assert.ok(Number.isNaN(C.legs([le, le]).legs[0].bearing));
});

test("great-circle path: Veness's midpoint, and the short way across the 180° meridian", () => {
  const le = { lat: dms(50, 3, 59), lon: -dms(5, 42, 53) }, jog = { lat: dms(58, 38, 38), lon: -dms(3, 4, 12) };
  const p = C.greatCirclePath(le, jog, 1000);       // one step of about 969 km: start and end only
  assert.equal(p.length, 2);
  const mid = C.greatCirclePath(le, jog, 968.9 / 2 + 0.01);
  assert.equal(mid.length, 3);
  near(mid[1][0], dms(54, 21, 44), 1 / 3600, "midpoint lat");
  near(mid[1][1], -dms(4, 31, 50), 1 / 3600, "midpoint lon");
  const x = C.greatCirclePath({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }, 50);
  assert.ok(x.every((q) => q[1] >= 179 && q[1] <= 181.0000001), "longitudes run 179 to 181, not back across the map");
  assert.deepEqual(C.greatCirclePath({ lat: 5, lon: 5 }, { lat: 5, lon: 5 }, 50), [[5, 5], [5, 5]]);
});

test("GeoJSON output is longitude first", () => {
  const gj = C.toGeoJSON(C.readPoints("name,lat,lon,colour\nA,28.5,-80.6,red").points);
  assert.deepEqual(gj.features[0].geometry.coordinates, [-80.6, 28.5]);
  assert.equal(gj.features[0].properties.colour, "red");
});
