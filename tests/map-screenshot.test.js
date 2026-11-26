// Map Screenshot. Reference: OpenStreetMap wiki, "Zoom levels": on 256-pixel Web Mercator tiles,
//   metres per pixel = 156543.03392 * cos(lat) / 2^zoom, with 156543.03392 = 2 * pi * 6378137 / 256
//   (WGS 84 equatorial radius a = 6378137 m). The wiki's table gives 156,543.03 m at zoom 0 and 0.597 m at zoom 18
//   on the equator. Scale ratio uses the CSS reference pixel, 1 px = 1/96 in = 0.0254/96 m (W3C CSS Values and Units).
// Worked examples by hand:
//   2 * pi * 6378137 = 40,075,016.686 m; / 256 = 156,543.0339 m per pixel at zoom 0.
//   Equator, zoom 18: 156,543.0339 / 262,144 = 0.597164 m.
//   Latitude 38 deg, zoom 8: cos 38 = 0.7880108; 156,543.0339 / 256 = 611.49623; x 0.7880108 = 481.866 m.
//   Latitude 60 deg, zoom 10: cos 60 = 0.5; 156,543.0339 * 0.5 / 1024 = 76.4370 m.
//   Scale ratio at zoom 18 on the equator: 0.597164 * 96 / 0.0254 = 2,256.998, so about 1:2,257.
//   Scale bar at 38 deg, zoom 8, at most 200 px: 200 * 481.866 = 96,373 m = 96.37 km; the largest 1-2-5 length
//   under it is 50 km, which is 50,000 / 481.866 = 103.76 px long.
//   Same view in feet and miles: 96,373 m / 1609.344 = 59.88 mi, so 50 mi = 80,467.2 m = 166.99 px.
const test = require("node:test");
const assert = require("node:assert/strict");
const MS = require("../site/lib/map-screenshot.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("map screenshot: the zoom-0 constant is the WGS 84 equator over one 256-pixel tile", () => {
  near(MS.M_PER_PX_Z0, 156543.03392, 1e-5, "constant");
  near(MS.metresPerPixel(0, 0), 156543.03, 0.01, "OSM wiki zoom 0");
  near(MS.metresPerPixel(0, 18), 0.597164, 1e-6, "OSM wiki zoom 18");
});

test("map screenshot: metres per pixel away from the equator", () => {
  near(MS.metresPerPixel(38, 8), 481.866, 0.001, "38 deg zoom 8");
  near(MS.metresPerPixel(-38, 8), 481.866, 0.001, "southern hemisphere is the same");
  near(MS.metresPerPixel(60, 10), 76.4370, 0.0001, "60 deg zoom 10");
  near(MS.metresPerPixel(38, 9) * 2, MS.metresPerPixel(38, 8), 1e-9, "one zoom step halves it");
});

test("map screenshot: scale ratio at the CSS reference pixel", () => {
  near(MS.scaleDenominator(0.597164), 2256.998, 0.01, "1:2,257");
  near(MS.scaleDenominator(1, 192), 7559.055, 0.001, "other pixel density");
});

test("map screenshot: scale bar picks a round length that fits", () => {
  const m = MS.scaleBar(38, 8, 200, "metric");
  assert.equal(m.label, "50 km");
  near(m.px, 103.76, 0.01, "bar length");
  const i = MS.scaleBar(38, 8, 200, "imperial");
  assert.equal(i.label, "50 mi");
  near(i.metres, 80467.2, 1e-6, "50 mi in metres");
  near(i.px, 166.99, 0.01, "imperial bar length");
  // Short bars switch to metres and feet: zoom 18 on the equator, 200 px = 119.43 m -> 100 m; 391.8 ft -> 200 ft.
  assert.equal(MS.scaleBar(0, 18, 200, "metric").label, "100 m");
  assert.equal(MS.scaleBar(0, 18, 200, "imperial").label, "200 ft");
  [1, 2, 5, 10, 20, 50].forEach((x) => assert.equal(MS.niceFloor(x), x));
  assert.equal(MS.niceFloor(0.0731), 0.05);
  assert.equal(MS.niceFloor(999), 500);
  assert.equal(MS.niceFloor(1999.9), 1000);
});

test("map screenshot: ground scale across a view", () => {
  // From 30 to 50 deg N at zoom 4: cos 30 = 0.866025, cos 50 = 0.642788, so the change is
  // (0.866025 - 0.642788) / 0.866025 = 25.78 %.
  const v = MS.viewScale(50, 30, 4);
  near(v.changePct, 25.78, 0.01, "change");
  assert.ok(v.bottomMpp > v.topMpp, "the side nearer the equator has more ground per pixel");
  // A view across the equator: largest at the equator. 10 S to 20 N: (1 - cos 20) / 1 = 6.03 %.
  near(MS.viewScale(20, -10, 5).changePct, 6.03, 0.01, "across the equator");
});

test("map screenshot: file names and image types", () => {
  const t = Date.UTC(2026, 10, 26, 14, 3, 5);
  assert.equal(MS.fileName("Harbour approach, north", t, "png"), "harbour-approach-north-20261126T140305Z.png");
  assert.equal(MS.fileName("", t, "jpeg"), "map-20261126T140305Z.jpg");
  assert.equal(MS.fileName("Café / Zürich", t, "jpg"), "cafe-zurich-20261126T140305Z.jpg");
  assert.equal(MS.mimeType("jpeg"), "image/jpeg");
  assert.equal(MS.mimeType("jpg"), "image/jpeg", "never the unregistered image/jpg");
  assert.equal(MS.mimeType("png"), "image/png");
  assert.throws(() => MS.mimeType("gif"));
  assert.throws(() => MS.fileName("x", "not a date", "png"));
});

test("map screenshot: view checks and bad input", () => {
  assert.deepEqual(MS.checkView(38, 200, 8), { lat: 38, lon: -160, zoom: 8 });
  assert.equal(MS.checkView(0, 180, 3).lon, 180);
  assert.equal(MS.checkView(0, -180, 3).lon, -180);
  assert.throws(() => MS.checkView(86, 0, 5), /85\.0511/);
  assert.throws(() => MS.checkView(0, 0, 20));
  assert.throws(() => MS.checkView(NaN, 0, 5));
  assert.throws(() => MS.metresPerPixel(90, 1));
  assert.throws(() => MS.scaleBar(0, 5, 0, "metric"));
  assert.equal(MS.formatLatLon(-33.86, 151.21, 2), "33.86° S, 151.21° E");
});
