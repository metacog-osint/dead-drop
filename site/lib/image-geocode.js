/* Where a photo says it was taken: the GPS position in its EXIF block (read by image-metadata.js), written out in
   degrees, minutes and seconds, with the direction the camera faced drawn as a short line, and plain links to
   outside reverse-image search sites that the reader may choose to use.
   References: CIPA DC-008 (Exif 2.32), section 4.6.6, for the GPS tags. Chris Veness, "Calculate distance,
   bearing and more between latitude/longitude points" (movable-type.co.uk), destination point on a sphere:
   lat2 = asin(sin lat1 cos d + cos lat1 sin d cos brg), lon2 = lon1 + atan2(sin brg sin d cos lat1,
   cos d - sin lat1 sin lat2), with d = distance / R and R = 6371 km.
   Needs image-metadata.js (window.DD.imageMetadata in the browser, require under Node). */
(function (root, factory) {
  var meta = (typeof module === "object" && module.exports) ? require("./image-metadata.js") : root.DD.imageMetadata;
  var api = factory(meta);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).imageGeocode = api;
})(typeof self !== "undefined" ? self : this, function (meta) {
  "use strict";
  var R_EARTH = 6371.0;   // km, mean Earth radius (IUGG)
  var D2R = Math.PI / 180;

  /** Signed decimal degrees as degrees, minutes and seconds with the hemisphere letter, seconds to `dp` places.
   *  Rounding carries: 10.99999999 is 11° 00′ 00.00″, never 10° 59′ 60.00″. */
  function formatDms(value, axis, dp) {
    if (typeof value !== "number" || !isFinite(value)) return "";
    dp = dp === undefined ? 2 : dp;
    var hemi = axis === "lat" ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");
    var scale = Math.pow(10, dp);
    var totalSec = Math.round(Math.abs(value) * 3600 * scale) / scale;
    var d = Math.floor(totalSec / 3600 + 1e-12);
    var m = Math.floor((totalSec - d * 3600) / 60 + 1e-12);
    var s = totalSec - d * 3600 - m * 60;
    if (s < 0) s = 0;
    var sText = s.toFixed(dp);
    if (Number(sText) >= 60) { sText = (0).toFixed(dp); m += 1; }
    if (m >= 60) { m -= 60; d += 1; }
    var pad = function (x, w) { x = String(x); while (x.length < w) x = "0" + x; return x; };
    var sInt = sText.split(".")[0];
    return d + "° " + pad(m, 2) + "′ " + pad(sInt, 2) + (dp > 0 ? "." + sText.split(".")[1] : "") + "″ " + hemi;
  }

  /** The point `distKm` along a great circle leaving (lat, lon) on bearing `brgDeg` (clockwise from true north). */
  function destination(lat, lon, brgDeg, distKm) {
    var p1 = lat * D2R, l1 = lon * D2R, t = brgDeg * D2R, d = distKm / R_EARTH;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    var lonDeg = ((l2 / D2R + 540) % 360) - 180;
    return { lat: p2 / D2R, lon: lonDeg };
  }

  /** A short line from the camera toward where it pointed, only when the direction is referred to true north
   *  (a magnetic direction would need the local declination, which a photo does not record). */
  function directionLine(gps, lengthKm) {
    if (!gps || !gps.direction || gps.direction.ref !== "true") return null;
    var end = destination(gps.lat, gps.lon, gps.direction.deg, lengthKm || 0.3);
    return [[gps.lat, gps.lon], [end.lat, end.lon]];
  }

  /** Read a photo's tags: its position (or why there is none) and a few facts to show beside it. */
  function locate(tags) {
    var s = meta.summarise(tags || {});
    var out = { gps: s.gps, gpsError: s.gpsError, taken: s.dates.original, camera: [s.camera.Make, s.camera.Model].filter(Boolean).join(" "),
      clockMinusGpsMin: s.clockMinusGpsMin, dms: null, links: [] };
    if (s.gps) {
      out.dms = formatDms(s.gps.lat, "lat") + ", " + formatDms(s.gps.lon, "lon");
      out.links = meta.mapLinks(s.gps.lat, s.gps.lon);
    }
    return out;
  }

  /** Outside reverse-image search sites. These are plain links to each site's own upload page: this page sends
   *  them nothing. If the reader uploads the photo there, the photo, and its metadata unless stripped first, goes to
   *  that company. */
  var SEARCH_SITES = [
    { label: "Google Lens", url: "https://lens.google.com/", owner: "Google" },
    { label: "Bing Visual Search", url: "https://www.bing.com/visualsearch", owner: "Microsoft" },
    { label: "TinEye", url: "https://tineye.com/", owner: "TinEye (Idée Inc.)" },
    { label: "Yandex Images", url: "https://yandex.com/images/", owner: "Yandex" }
  ];

  return { formatDms: formatDms, destination: destination, directionLine: directionLine, locate: locate,
    SEARCH_SITES: SEARCH_SITES, R_EARTH: R_EARTH };
});
