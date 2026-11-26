// KML/KMZ Visualizer. References: OGC KML 2.2 (OGC 07-147r2) sections 16.9 (coordinates are lon,lat[,alt]),
// 10.8 (Polygon outer and inner boundaries), 10.5 (LinearRing is closed); RFC 7946 (GeoJSON); Chris Veness,
// movable-type.co.uk (haversine); Chamberlain and Duquette, JPL Publication 07-03 (area on a sphere).
// Worked examples (R = 6371 km), by hand from closed forms, not from the code:
//   Veness: 50 deg 03' 59" N, 005 deg 42' 53" W to 58 deg 38' 38" N, 003 deg 04' 12" W is 968.9 km.
//   One degree of arc = 2 pi R / 360 = 111.19493 km.
//   A 1 deg x 1 deg cell from the equator: area = R^2 * dLon(rad) * (sin 1 deg - sin 0) = 40,589,641 * 0.01745329
//     * 0.01745241 = 12,363.68 km^2. Its perimeter: three sides along the equator and meridians (111.19493 km
//     each) plus the great circle along the top, 2R asin(cos 1 deg sin 0.5 deg) = 111.17799 km: 444.76277 km.
//   A 2 x 2 deg cell (R^2 * 0.0349066 * sin 2 deg = 49,447.20 km^2) with a hole from 0.5 to 1.5 deg
//     (R^2 * 0.0174533 * (sin 1.5 deg - sin 0.5 deg) = 12,362.27 km^2): 37,084.93 km^2.
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../site/lib/kml.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const dms = (d, m, s) => d + m / 60 + s / 3600;
const doc = (inner) => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Test</name>${inner}</Document></kml>`;

test("haversine: Veness's worked example and one degree of arc", () => {
  near(K.haversineKm(dms(50, 3, 59), -dms(5, 42, 53), dms(58, 38, 38), -dms(3, 4, 12)), 968.9, 0.05, "Land's End to John o' Groats");
  near(K.haversineKm(0, 0, 0, 1), 111.19493, 1e-4, "one degree");
  assert.equal(K.haversineKm(10, 10, 10, 10), 0);
});

test("coordinates are longitude first; spaces after commas tolerated; bad tuples rejected", () => {
  assert.deepEqual(K.parseCoordinates(" -80.6,28.5,0\n\t-120.5,34.7 "), [[-80.6, 28.5, 0], [-120.5, 34.7]]);
  assert.deepEqual(K.parseCoordinates("-80.6, 28.5"), [[-80.6, 28.5]]);
  assert.deepEqual(K.parseCoordinates(""), []);
  assert.throws(() => K.parseCoordinates("28.5"), /not longitude,latitude/);
  assert.throws(() => K.parseCoordinates("10,95"), /Latitude 95/);
  assert.throws(() => K.parseCoordinates("200,10"), /Longitude 200/);
  assert.throws(() => K.parseCoordinates("a,b"), /not a number/);
});

test("Point, LineString, folders and plain-text descriptions", () => {
  const r = K.parseKml(doc(`<Folder><name>Sites</name>
    <Placemark><name>Cape &amp; pad</name><description><![CDATA[<b>Primary</b> <img src=x onerror=alert(1)>]]></description>
      <Point><coordinates>-80.6,28.5,0</coordinates></Point></Placemark>
    <Placemark><name>Path</name><LineString><coordinates>0,0 1,0 1,1</coordinates></LineString></Placemark>
  </Folder><!-- a comment -->`));
  assert.equal(r.features.length, 2);
  const p = r.features[0];
  assert.equal(p.name, "Cape & pad");
  assert.equal(p.folder, "Test / Sites");
  assert.deepEqual(p.coordinates, [-80.6, 28.5, 0]);
  assert.equal(p.description, "<b>Primary</b> <img src=x onerror=alert(1)>");   // text, shown as text
  near(r.features[1].lengthKm, 2 * 111.19493, 1e-3, "two one-degree legs");
});

test("Polygon: area and perimeter of a 1 deg cell; holes subtracted; unclosed rings closed", () => {
  const cell = K.parseKml(doc(`<Placemark><name>Cell</name><Polygon><outerBoundaryIs><LinearRing>
    <coordinates>0,0 1,0 1,1 0,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`)).features[0];
  near(cell.areaKm2, 12363.68, 0.01, "area");
  near(cell.perimeterKm, 444.76277, 1e-4, "perimeter");
  assert.equal(cell.coordinates.length, 1);   // GeoJSON: an array of rings
  const holed = K.parseKml(doc(`<Placemark><name>Ring</name><Polygon>
    <outerBoundaryIs><LinearRing><coordinates>0,0 2,0 2,2 0,2</coordinates></LinearRing></outerBoundaryIs>
    <innerBoundaryIs><LinearRing><coordinates>0.5,0.5 1.5,0.5 1.5,1.5 0.5,1.5 0.5,0.5</coordinates></LinearRing></innerBoundaryIs>
  </Polygon></Placemark>`));
  const h = holed.features[0];
  near(h.areaKm2, 37084.93, 0.01, "area with hole");
  assert.equal(h.holes, 1);
  assert.deepEqual(h.coordinates[0][4], [0, 0]);   // closed
  assert.ok(holed.warnings.some((w) => /not closed/.test(w)));
  // Orientation does not matter: the same cell clockwise has the same area.
  near(K.ringAreaKm2([[0, 0], [0, 1], [1, 1], [1, 0]]), 12363.68, 0.01, "clockwise");
  // A cell straddling the antimeridian, 179.5 E to 179.5 W, is still 1 deg wide.
  near(K.ringAreaKm2([[179.5, 0], [-179.5, 0], [-179.5, 1], [179.5, 1]]), 12363.68, 0.01, "antimeridian");
});

test("MultiGeometry, gx:Track, network links and broken geometry", () => {
  const r = K.parseKml(doc(`<Placemark><name>Multi</name><MultiGeometry>
      <Point><coordinates>10,20</coordinates></Point><LineString><coordinates>10,20 11,20</coordinates></LineString>
    </MultiGeometry></Placemark>
    <Placemark><name>Drive</name><gx:Track><when>2024-01-01T00:00:00Z</when><gx:coord>0 0 10</gx:coord>
      <when>2024-01-01T00:01:00Z</when><gx:coord>0 1 10</gx:coord></gx:Track></Placemark>
    <Placemark><name>Bad</name><Point><coordinates>28.5,95</coordinates></Point></Placemark>
    <NetworkLink><Link><href>https://example.invalid/x.kml</href></Link></NetworkLink>`));
  assert.deepEqual(r.features.map((f) => f.type), ["Point", "LineString", "LineString"]);
  near(r.features[2].lengthKm, 111.19493, 1e-4, "track");
  assert.equal(r.placemarks, 3);
  assert.equal(r.networkLinks, 1);
  assert.ok(r.warnings.some((w) => /^Bad: latitude 95/.test(w)));
});

test("XML errors, non-KML, KMZ entry choice, and GeoJSON output", () => {
  assert.throws(() => K.parseKml("<kml><Placemark></kml>"), /does not match/);
  assert.throws(() => K.parseKml("<kml>"), /never closed/);
  assert.throws(() => K.parseKml("<svg></svg>"), /not KML/);
  assert.throws(() => K.parseKml(42), /No KML/);
  assert.equal(K.pickKmlEntry(["files/a.kml", "b.kml", "doc.kml"]), "doc.kml");
  assert.equal(K.pickKmlEntry(["files/a.kml", "b.kml"]), "b.kml");
  assert.equal(K.pickKmlEntry(["files/a.kml", "img.png"]), "files/a.kml");
  assert.equal(K.pickKmlEntry(["img.png"]), null);
  const f = K.parseKml(doc(`<Placemark><name>C</name><Polygon><outerBoundaryIs><LinearRing>
    <coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`)).features;
  const gj = K.toGeoJSON(f);
  assert.equal(gj.type, "FeatureCollection");
  assert.equal(gj.features[0].geometry.type, "Polygon");
  assert.deepEqual(gj.features[0].geometry.coordinates, [[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  assert.deepEqual(K.latLngs([[-80.6, 28.5]]), [[28.5, -80.6]]);
});

test("fromDom gives the same tree as parseXml (duck-typed DOM)", () => {
  const el = (name, kids, attrs) => ({ nodeType: 1, localName: name, attributes: attrs || [], childNodes: kids });
  const tx = (v) => ({ nodeType: 3, nodeValue: v });
  const dom = { nodeType: 9, documentElement: el("kml", [el("Placemark", [el("name", [tx("A")]),
    el("Point", [el("coordinates", [tx("1,2")])])])]) };
  const r = K.extract(K.fromDom(dom));
  assert.deepEqual(r.features[0].coordinates, [1, 2]);
  assert.equal(r.features[0].name, "A");
});
