// Reverse Image Geocoder. References: CIPA DC-008 (Exif 2.32) section 4.6.6 for the GPS tags; Chris Veness,
// "Calculate distance, bearing and more between latitude/longitude points" (movable-type.co.uk), destination point.
// Worked examples:
//   Veness's own destination example: from 53 deg 19' 14" N, 001 deg 43' 47" W on bearing 096 deg 01' 18" for
//   124.8 km, the end point is 53 deg 11' 18" N, 000 deg 08' 00" E (53.188333, 0.133333).
//   Decimal to DMS by hand: 40.446195 -> 0.446195 * 60 = 26.7717' -> 0.7717 * 60 = 46.30" -> 40 deg 26' 46.30" N.
//   79.9823567 W -> 0.9823567 * 60 = 58.9414' -> 0.9414 * 60 = 56.48" -> 79 deg 58' 56.48" W.
//   10.9999999 deg: 10 deg 59' 59.99964", which rounds to 60.00" and must carry to 11 deg 00' 00.00".
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../site/lib/image-geocode.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const R = (n, d) => { const x = new Number(n / d); x.numerator = n; x.denominator = d; return x; };
const dms = (d, m, s) => d + m / 60 + s / 3600;

test("destination point: Veness's worked example", () => {
  const p = G.destination(dms(53, 19, 14), -dms(1, 43, 47), dms(96, 1, 18), 124.8);
  near(p.lat, dms(53, 11, 18), 1 / 3600, "lat within 1 arc-second");
  near(p.lon, dms(0, 8, 0), 1 / 3600, "lon within 1 arc-second");
  // Due north 111.195 km is one degree of latitude on a 6371 km sphere (2 * pi * 6371 / 360).
  near(G.destination(0, 0, 0, 2 * Math.PI * 6371 / 360).lat, 1, 1e-9, "one degree north");
  // Crossing the antimeridian wraps the longitude into -180..180.
  assert.ok(G.destination(0, 179.9, 90, 50).lon < -179);
});

test("decimal degrees to degrees, minutes, seconds", () => {
  assert.equal(G.formatDms(40.446195, "lat"), "40° 26′ 46.30″ N");
  assert.equal(G.formatDms(-79.9823567, "lon"), "79° 58′ 56.48″ W");
  assert.equal(G.formatDms(10.9999999, "lat"), "11° 00′ 00.00″ N");
  assert.equal(G.formatDms(-0.5, "lat"), "0° 30′ 00.00″ S");
  assert.equal(G.formatDms(151.215, "lon", 0), "151° 12′ 54″ E");
  assert.equal(G.formatDms(NaN, "lat"), "");
});

test("locate: position, links and the camera-direction line", () => {
  const tags = { Make: "Apple", Model: "iPhone 12",
    GPSLatitude: [R(40, 1), R(26, 1), R(46302, 1000)], GPSLatitudeRef: "N",
    GPSLongitude: [R(79, 1), R(58, 1), R(56484, 1000)], GPSLongitudeRef: "W",
    GPSImgDirection: R(90, 1), GPSImgDirectionRef: "T" };
  const r = G.locate(tags);
  near(r.gps.lat, 40.446195, 1e-6, "lat");
  assert.equal(r.dms, "40° 26′ 46.30″ N, 79° 58′ 56.48″ W");
  assert.equal(r.camera, "Apple iPhone 12");
  assert.equal(r.links.length, 2);
  const line = G.directionLine(r.gps, 0.3);
  near(line[1][0], 40.446195, 1e-5, "due east keeps the latitude (nearly)");
  assert.ok(line[1][1] > line[0][1], "east is a larger longitude");
  // 0.3 km east at 40.446 deg N is 0.3 / (111.195 * cos 40.446) = 0.003530 deg of longitude.
  near(line[1][1] - line[0][1], 0.3 / (111.19493 * Math.cos(40.446195 * Math.PI / 180)), 2e-6, "longitude step");
  // A magnetic bearing is not drawn: the photo does not say the local declination.
  assert.equal(G.directionLine({ lat: 0, lon: 0, direction: { deg: 90, ref: "magnetic" } }), null);
});

test("locate: no GPS, bad GPS, and the outside search sites are plain links", () => {
  assert.equal(G.locate({ Make: "Canon" }).gps, null);
  assert.equal(G.locate(null).links.length, 0);
  assert.match(G.locate({ GPSLatitude: [R(10, 1), R(0, 1), R(0, 0)], GPSLongitude: [R(1, 1)] }).gpsError, /not a number/);
  G.SEARCH_SITES.forEach((s) => {
    assert.match(s.url, /^https:\/\/[^?#]+$/, "no query string: nothing is passed to the site");
  });
});
