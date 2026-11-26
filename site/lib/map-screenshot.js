/* Map Screenshot: view checks, ground scale and scale bar, and the saved file's name and type. No DOM.
   Reference: OpenStreetMap wiki, "Zoom levels": on the Web Mercator tile scheme (256-pixel tiles) one pixel covers
     metres per pixel = 156543.03392 * cos(latitude) / 2^zoom
   where 156543.03392 = 2 * pi * 6378137 / 256 (the WGS 84 equatorial radius in metres, around the equator, over one
   256-pixel tile). The figure holds along the parallel at that latitude; Web Mercator stretches the map by
   1 / cos(latitude), so it changes from the top of a view to the bottom. The on-screen scale ratio uses the CSS
   reference pixel, 1/96 inch (W3C, CSS Values and Units, absolute lengths). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).mapScreenshot = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var A_WGS84 = 6378137;                          // m, WGS 84 semi-major axis
  var M_PER_PX_Z0 = 2 * Math.PI * A_WGS84 / 256;  // 156543.03392... m per pixel, zoom 0, equator
  var MAX_LAT = 85.0511287798;                    // deg, Web Mercator's edge: atan(sinh(pi))
  var FOOT = 0.3048;                              // m, international foot (exact)
  var MILE_FT = 5280;
  var D2R = Math.PI / 180;

  function normLon(lon) {
    var x = ((lon + 180) % 360 + 360) % 360 - 180;
    return x === -180 && lon > 0 ? 180 : x;
  }

  /** Checks a map view. Latitude must lie inside Web Mercator's limits; longitude is wrapped to -180..180. */
  function checkView(lat, lon, zoom) {
    if (![lat, lon, zoom].every(function (v) { return typeof v === "number" && isFinite(v); })) {
      throw new Error("Latitude, longitude and zoom must all be numbers.");
    }
    if (Math.abs(lat) > MAX_LAT) throw new Error("Latitude must be within ±85.0511°, the edge of a Web Mercator map.");
    if (zoom < 0 || zoom > 19) throw new Error("Zoom must be between 0 and 19 for OpenStreetMap tiles.");
    return { lat: lat, lon: normLon(lon), zoom: zoom };
  }

  /** Ground distance covered by one CSS pixel at a latitude and zoom, in metres. */
  function metresPerPixel(lat, zoom) {
    if (!isFinite(lat) || !isFinite(zoom)) throw new Error("Latitude and zoom must be numbers.");
    if (Math.abs(lat) > MAX_LAT) throw new Error("Latitude is outside the Web Mercator map.");
    return M_PER_PX_Z0 * Math.cos(lat * D2R) / Math.pow(2, zoom);
  }

  /** The largest 1, 2 or 5 times a power of ten that is no more than x (x > 0). */
  function niceFloor(x) {
    if (!(x > 0) || !isFinite(x)) throw new Error("Need a positive length.");
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var f = x / p;
    // guard against log10 rounding just below a power of ten
    if (f >= 9.999999999) { p *= 10; f = x / p; }
    var n = f >= 5 ? 5 : f >= 2 ? 2 : 1;
    return n * p;
  }

  /** A scale bar no longer than maxPx CSS pixels, for a map at this latitude and zoom.
   *  units: "metric" (m or km) or "imperial" (ft or mi). Returns {value, unit, metres, px, label}. */
  function scaleBar(lat, zoom, maxPx, units) {
    if (!(maxPx > 0)) throw new Error("The bar needs a positive maximum length.");
    var mpp = metresPerPixel(lat, zoom);
    var maxM = mpp * maxPx;
    var value, unit, metres;
    if (units === "imperial") {
      var maxFt = maxM / FOOT;
      if (maxFt >= MILE_FT) { value = niceFloor(maxFt / MILE_FT); unit = "mi"; metres = value * MILE_FT * FOOT; }
      else { value = niceFloor(maxFt); unit = "ft"; metres = value * FOOT; }
    } else {
      if (maxM >= 1000) { value = niceFloor(maxM / 1000); unit = "km"; metres = value * 1000; }
      else { value = niceFloor(maxM); unit = "m"; metres = value; }
    }
    return { value: value, unit: unit, metres: metres, px: metres / mpp, label: value + " " + unit };
  }

  /** On-screen scale denominator (the N in 1:N) at the CSS reference pixel of 1/96 inch, or another pixel density. */
  function scaleDenominator(mpp, pxPerInch) {
    pxPerInch = pxPerInch || 96;
    return mpp * pxPerInch / 0.0254;
  }

  /** Ground scale at the top, centre and bottom of a view, and how much it changes across the view (in %). */
  function viewScale(latNorth, latSouth, zoom) {
    var n = Math.max(-MAX_LAT, Math.min(MAX_LAT, latNorth));
    var s = Math.max(-MAX_LAT, Math.min(MAX_LAT, latSouth));
    var top = metresPerPixel(n, zoom), bottom = metresPerPixel(s, zoom);
    var mid = metresPerPixel((n + s) / 2, zoom);
    var hi = Math.max(top, bottom, mid), lo = Math.min(top, bottom, mid);
    // a view that crosses the equator has its largest metres-per-pixel at the equator
    if (n > 0 && s < 0) hi = metresPerPixel(0, zoom);
    return { topMpp: top, centreMpp: mid, bottomMpp: bottom, changePct: (hi - lo) / hi * 100 };
  }

  function mimeType(format) {
    if (format === "png") return "image/png";
    if (format === "jpeg" || format === "jpg") return "image/jpeg";   // "image/jpg" is not a registered type
    throw new Error("Format must be png or jpeg.");
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  /** UTC time stamp for file names: 20261126T140305Z. */
  function stamp(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) throw new Error("Not a valid time.");
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }

  /** File name from the map title and the capture time (UTC): "harbour-approach-20261126T140305Z.png". */
  function fileName(title, date, format) {
    var slug = String(title || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
    var ext = mimeType(format) === "image/png" ? "png" : "jpg";
    return (slug || "map") + "-" + stamp(date) + "." + ext;
  }

  /** "38.00000° N, 77.00000° W" */
  function formatLatLon(lat, lon, dp) {
    dp = dp === undefined ? 5 : dp;
    return Math.abs(lat).toFixed(dp) + "° " + (lat < 0 ? "S" : "N") + ", " +
      Math.abs(lon).toFixed(dp) + "° " + (lon < 0 ? "W" : "E");
  }

  return { checkView: checkView, metresPerPixel: metresPerPixel, niceFloor: niceFloor, scaleBar: scaleBar,
    scaleDenominator: scaleDenominator, viewScale: viewScale, mimeType: mimeType, stamp: stamp, fileName: fileName,
    formatLatLon: formatLatLon, normLon: normLon, M_PER_PX_Z0: M_PER_PX_Z0, MAX_LAT: MAX_LAT };
});
