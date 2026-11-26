// Image Metadata Extractor. Reference: CIPA DC-008 (Exif 2.32), section 4.6.6 (GPS attributes) and 4.6.5 (Exif IFD).
// Decimal degrees = D + M/60 + S/3600, negative for S and W; GPSAltitudeRef 1 means below sea level; GPSDateStamp
// and GPSTimeStamp are UTC; DateTimeOriginal has no time zone; Flash is a bit field.
// Worked examples, by hand:
//   40 deg 26' 46.302" N = 40 + 26/60 + 46.302/3600 = 40 + 0.4333333 + 0.0128617 = 40.4461950
//   79 deg 58' 56.484" W = -(79 + 58/60 + 56.484/3600) = -(79 + 0.9666667 + 0.0156900) = -79.9823567
//   33 deg 51' 24" S, 151 deg 12' 54" E = -(33 + 0.85 + 0.0066667), 151 + 0.2 + 0.015 = -33.8566667, 151.215
//   Camera clock 2024-03-10 09:05:30, GPS 14:05:30 UTC: the clock reads 5 h = 300 min behind UTC.
//   Flash 89 = 64 + 16 + 8 + 1: fired (bit 0), bits 3-4 = 3 (auto), bits 1-2 = 0, bit 6 red-eye.
//   Flash 16 = bits 3-4 = 2: did not fire, compulsory suppression. Exposure 0.4 s is 2/5 s, not 1/3 s.
// Tag values are given the way Exif.js 2.3.0 returns them: RATIONALs as Number objects with numerator/denominator.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../site/lib/image-metadata.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const R = (n, d) => { const x = new Number(n / d); x.numerator = n; x.denominator = d; return x; };

test("EXIF GPS: degrees, minutes, seconds to signed decimal degrees", () => {
  const g = M.gpsFromTags({
    GPSLatitude: [R(40, 1), R(26, 1), R(46302, 1000)], GPSLatitudeRef: "N",
    GPSLongitude: [R(79, 1), R(58, 1), R(56484, 1000)], GPSLongitudeRef: "W"
  });
  near(g.lat, 40.446195, 1e-6, "lat");
  near(g.lon, -79.9823567, 1e-6, "lon");
  assert.deepEqual(g.warnings, []);
  const s = M.gpsFromTags({ GPSLatitude: [R(33, 1), R(51, 1), R(24, 1)], GPSLatitudeRef: "S\u0000",
    GPSLongitude: [R(151, 1), R(12, 1), R(54, 1)], GPSLongitudeRef: "E" });
  near(s.lat, -33.8566667, 1e-6, "south");
  near(s.lon, 151.215, 1e-9, "east");
});

test("EXIF GPS: altitude sign, UTC time stamp, direction, speed, datum", () => {
  const g = M.gpsFromTags({
    GPSLatitude: [R(31, 1), R(30, 1), R(0, 1)], GPSLatitudeRef: "N",
    GPSLongitude: [R(35, 1), R(30, 1), R(0, 1)], GPSLongitudeRef: "E",
    GPSAltitude: R(430, 1), GPSAltitudeRef: 1,
    GPSDateStamp: "2024:03:10", GPSTimeStamp: [R(14, 1), R(5, 1), R(30, 1)],
    GPSImgDirection: R(27150, 100), GPSImgDirectionRef: "T",
    GPSSpeed: R(10, 1), GPSSpeedRef: "N", GPSMapDatum: "TOKYO"
  });
  near(g.lat, 31.5, 1e-12, "lat"); near(g.lon, 35.5, 1e-12, "lon");
  assert.equal(g.altitudeM, -430);                      // ref 1: below sea level
  assert.equal(g.utc, "2024-03-10T14:05:30Z");
  assert.deepEqual(g.direction, { deg: 271.5, ref: "true" });
  near(g.speed.kmh, 18.52, 1e-9, "10 kn");              // 1 kn = 1.852 km/h exactly
  assert.ok(g.warnings.some((w) => /TOKYO/.test(w)), "non-WGS 84 datum flagged");
  assert.equal(M.gpsFromTags({ GPSLatitude: [R(1, 1)], GPSLongitude: [R(1, 1)], GPSAltitude: R(12, 1), GPSAltitudeRef: 0 }).altitudeM, 12);
});

test("EXIF GPS: missing references, null island and bad values", () => {
  const g = M.gpsFromTags({ GPSLatitude: [R(10, 1), R(0, 1), R(0, 1)], GPSLongitude: [R(20, 1), R(0, 1), R(0, 1)] });
  assert.equal(g.lat, 10); assert.equal(g.lon, 20);
  assert.ok(g.warnings.some((w) => /reference is missing/.test(w)));
  const z = M.gpsFromTags({ GPSLatitude: [R(0, 1), R(0, 1), R(0, 1)], GPSLatitudeRef: "N",
    GPSLongitude: [R(0, 1), R(0, 1), R(0, 1)], GPSLongitudeRef: "E" });
  assert.ok(z.warnings.some((w) => /no position fix/.test(w)));
  assert.equal(M.gpsFromTags({}), null);
  assert.throws(() => M.dmsToDecimal([R(10, 1), R(0, 1), R(0, 0)], "N", "lat"), /not a number/);
  assert.throws(() => M.dmsToDecimal([R(91, 1), R(0, 1), R(0, 1)], "N", "lat"), /out of range/);
  assert.throws(() => M.dmsToDecimal([R(10, 1), R(61, 1), R(0, 1)], "N", "lat"), /minutes and seconds/);
  assert.throws(() => M.dmsToDecimal([R(10, 1), R(0, 1), R(0, 1)], "E", "lat"), /not a latitude/);
  // A bad GPS block is reported by summarise, not thrown.
  assert.match(M.summarise({ GPSLatitude: [R(95, 1)], GPSLongitude: [R(0, 1)] }).gpsError, /out of range/);
});

test("EXIF dates: no time zone unless an offset is recorded; impossible dates rejected", () => {
  const d = M.parseExifDate("2024:03:10 09:05:30");
  assert.equal(d.text, "2024-03-10 09:05:30");
  assert.equal(d.zone, null); assert.equal(d.iso, null);
  const o = M.parseExifDate("2024:03:10 09:05:30", "-05:00");
  assert.equal(o.iso, "2024-03-10T09:05:30-05:00");
  assert.equal(M.parseExifDate("2024:02:29 12:00:00").day, 29);   // 2024 is a leap year
  assert.equal(M.parseExifDate("2023:02:29 12:00:00"), null);
  assert.equal(M.parseExifDate("0000:00:00 00:00:00"), null);
  assert.equal(M.parseExifDate("    :  :     :  :  "), null);
  assert.equal(M.parseExifDate("2024:03:10 24:00:00"), null);
  assert.equal(M.clockMinusGpsMinutes(d, "2024-03-10T14:05:30Z"), -300);
  assert.equal(M.gpsUtc("2024:13:01", [R(0, 1), R(0, 1), R(0, 1)]), null);
});

test("Flash bit field, and Exif.js's own words for it", () => {
  assert.deepEqual(M.flash(0), { fired: false, text: "Did not fire" });
  assert.equal(M.flash(1).fired, true);
  assert.equal(M.flash(16).text, "Did not fire, compulsory suppression mode");
  assert.equal(M.flash(24).fired, false);
  assert.equal(M.flash(89).text, "Fired, auto mode, red-eye reduction");
  assert.equal(M.flash(32).text, "No flash function");
  // Exif.js 2.3.0 hands over a string: the old page compared it with 0 and always said "Flash Fired".
  assert.equal(M.flash("Flash did not fire, compulsory flash mode").fired, false);
  assert.equal(M.flash("Flash fired, auto mode").fired, true);
  assert.equal(M.whiteBalance("Auto white balance"), "Auto white balance");
  assert.equal(M.whiteBalance(1), "Manual");
});

test("Exposure, orientation, colour space and file size wording", () => {
  assert.equal(M.exposure(R(1, 250)), "1/250 s");
  assert.equal(M.exposure(0.4), "0.4 s");          // 2/5 s; the old rounding called it 1/3 s
  assert.equal(M.exposure(R(10, 30)), "1/3 s");
  assert.equal(M.exposure(2), "2 s");
  assert.equal(M.exposure(0), "");
  assert.equal(M.orientation(6), "Rotate 90° clockwise");
  assert.equal(M.orientation(2), "Mirrored left to right");
  assert.equal(M.colorSpace(65535), "Uncalibrated (often Adobe RGB)");
  assert.equal(M.fileSize(2412345), "2.41 MB (2,412,345 bytes)");
  assert.equal(M.fileSize(999), "999 bytes");
});

test("summarise and the full tag list", () => {
  const tags = { Make: "Canon\u0000", Model: "EOS 5D", DateTimeOriginal: "2024:03:10 09:05:30",
    ExposureTime: R(1, 250), FNumber: R(56, 10), FocalLength: R(50, 1), ISOSpeedRatings: 400, Flash: 16,
    GPSLatitude: [R(40, 1), R(26, 1), R(46302, 1000)], GPSLatitudeRef: "N",
    GPSLongitude: [R(79, 1), R(58, 1), R(56484, 1000)], GPSLongitudeRef: "W",
    GPSDateStamp: "2024:03:10", GPSTimeStamp: [R(14, 1), R(5, 1), R(30, 1)],
    MakerNote: new Array(500).fill(0), thumbnail: {}, ExifIFDPointer: 200 };
  const s = M.summarise(tags);
  assert.equal(s.camera.Make, "Canon");
  assert.equal(s.settings.fNumber, 5.6);
  assert.equal(s.settings.exposure, "1/250 s");
  assert.equal(s.settings.flash.fired, false);
  near(s.gps.lat, 40.446195, 1e-6, "lat");
  assert.equal(s.clockMinusGpsMin, -300);
  const rows = M.tagRows(tags);
  assert.ok(!rows.some((r) => r[0] === "thumbnail" || r[0] === "MakerNote" || r[0] === "ExifIFDPointer"));
  assert.deepEqual(rows.find((r) => r[0] === "FNumber"), ["FNumber", "5.6"]);
  assert.equal(M.tagText(new Array(40).fill(1)), "(40 values not shown)");
  assert.deepEqual(M.summarise(null).gps, null);
});

test("Map links carry the position to six decimals, and nothing for a bad one", () => {
  const l = M.mapLinks(40.446195, -79.9823567);
  assert.equal(l[0].url, "https://www.openstreetmap.org/?mlat=40.446195&mlon=-79.982357#map=16/40.446195/-79.982357");
  assert.equal(l[1].url, "https://www.google.com/maps/search/?api=1&query=40.446195%2C-79.982357");
  assert.deepEqual(M.mapLinks(91, 0), []);
  assert.deepEqual(M.mapLinks(NaN, 0), []);
});
