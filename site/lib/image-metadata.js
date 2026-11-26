/* Reading the EXIF block of a photo: GPS position, dates, camera and exposure settings. The page reads the file's
   bytes with Exif.js (exif-js 2.3.0) in the browser; this file only turns the tag values Exif.js returns into
   figures and words, so it loads in Node without Exif.js.
   Reference: JEITA / CIPA DC-008, Exchangeable image file format for digital still cameras (Exif) 2.32:
   section 4.6.6 (GPS attribute information): GPSLatitude and GPSLongitude are three RATIONALs, degrees, minutes,
   seconds; GPSLatitudeRef 'N'/'S' and GPSLongitudeRef 'E'/'W' give the sign; GPSAltitudeRef 0 is above and 1 below
   sea level; GPSTimeStamp and GPSDateStamp are UTC. Section 4.6.5 (Exif IFD): DateTimeOriginal and DateTime are
   "YYYY:MM:DD HH:MM:SS" on the camera's clock with no time zone (an offset is only in the separate OffsetTime tags
   added in Exif 2.31); Flash is a bit field (bit 0 fired, bits 1-2 return light, bits 3-4 mode, bit 5 no flash
   function, bit 6 red-eye). Orientation values 1 to 8 are from TIFF 6.0 / Exif 2.32 section 4.6.4, named as
   ExifTool names them. Decimal degrees = degrees + minutes / 60 + seconds / 3600. Also used by image-geocode.js. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).imageMetadata = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** One EXIF RATIONAL as a number. Exif.js gives a Number object carrying .numerator and .denominator; plain
   *  numbers, numeric strings and {numerator, denominator} objects also work. A zero denominator gives NaN. */
  function rational(x) {
    if (x === null || x === undefined || x === "") return NaN;
    if (typeof x === "object" && "numerator" in x && "denominator" in x) {
      var n = Number(x.numerator), d = Number(x.denominator);
      return (d === 0 || !isFinite(n) || !isFinite(d)) ? NaN : n / d;
    }
    var v = Number(x);
    return isFinite(v) ? v : NaN;
  }

  /** An EXIF ASCII value as a clean string: trailing NULs and spaces removed. */
  function str(x) {
    if (x === null || x === undefined) return "";
    return String(x).replace(/\u0000+/g, "").trim();
  }

  /** Degrees, minutes, seconds (one to three RATIONALs) and the hemisphere letter to signed decimal degrees.
   *  axis is "lat" or "lon". Returns {value, refMissing}. Throws on a bad value or a letter for the wrong axis. */
  function dmsToDecimal(dms, ref, axis) {
    var parts = Array.isArray(dms) ? dms : [dms];
    if (parts.length < 1 || parts.length > 3) throw new Error("A GPS coordinate needs one to three numbers.");
    var v = parts.map(rational);
    if (!v.every(isFinite)) throw new Error("The GPS coordinate holds a value that is not a number (for example 0/0).");
    var d = v[0], m = v[1] || 0, s = v[2] || 0;
    if (m < 0 || s < 0 || m >= 60 || s >= 60) throw new Error("GPS minutes and seconds must be from 0 to under 60.");
    var mag = Math.abs(d) + m / 60 + s / 3600;
    var r = str(ref).toUpperCase().charAt(0);
    var okRefs = axis === "lat" ? "NS" : "EW";
    var sign;
    if (!r) sign = d < 0 ? -1 : 1;
    else if (okRefs.indexOf(r) < 0) throw new Error("'" + r + "' is not a " + (axis === "lat" ? "latitude (N or S)" : "longitude (E or W)") + " reference.");
    else sign = (r === "S" || r === "W") ? -1 : 1;
    var value = sign * mag;
    var max = axis === "lat" ? 90 : 180;
    if (Math.abs(value) > max) throw new Error((axis === "lat" ? "Latitude" : "Longitude") + " " + value.toFixed(6) + " is out of range.");
    return { value: value, refMissing: !r };
  }

  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = "0" + s; return s; }
  function daysIn(y, mo) { return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]; }

  /** An EXIF date-time "YYYY:MM:DD HH:MM:SS" (also accepts '-' in the date and a fraction of a second).
   *  It is the camera clock's reading and carries no time zone, so zone is null unless an offset such as "+02:00"
   *  (the Exif 2.31 OffsetTime tags) is passed in. Returns null for a blank or impossible date. */
  function parseExifDate(s, offset) {
    var t = str(s);
    var m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?$/.exec(t);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +m[6];
    if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || se > 59) return null;
    var text = m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] + ":" + m[6];
    var out = { text: text, year: y, month: mo, day: d, hour: h, minute: mi, second: se, zone: null, iso: null };
    var off = str(offset);
    var om = /^([+\-])(\d{2}):(\d{2})$/.exec(off);
    if (om && +om[2] <= 14 && +om[3] <= 59) {
      out.zone = off;
      out.iso = text.replace(" ", "T") + off;   // an instant only when the camera recorded its offset
    }
    return out;
  }

  /** GPSDateStamp ("YYYY:MM:DD") and GPSTimeStamp (three RATIONALs, hours, minutes, seconds), both UTC, as an ISO
   *  string ending in Z. Null when either is missing or impossible. */
  function gpsUtc(dateStamp, timeStamp) {
    var dm = /^(\d{4})[:\-](\d{2})[:\-](\d{2})$/.exec(str(dateStamp));
    if (!dm || !Array.isArray(timeStamp) || timeStamp.length !== 3) return null;
    var hms = timeStamp.map(rational);
    if (!hms.every(isFinite)) return null;
    var y = +dm[1], mo = +dm[2], d = +dm[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || hms[0] < 0 || hms[0] > 23 || hms[1] < 0 || hms[1] > 59 || hms[2] < 0 || hms[2] >= 61) return null;
    var ms = Date.UTC(y, mo - 1, d, Math.floor(hms[0]), Math.floor(hms[1]), 0) + Math.round(hms[2] * 1000);
    return new Date(ms).toISOString().replace(/\.000Z$/, "Z");
  }

  /** Everything the GPS block says: position, altitude with its sign, UTC time, direction, datum, warnings.
   *  Null when the photo has no latitude and longitude. */
  function gpsFromTags(tags) {
    tags = tags || {};
    if (tags.GPSLatitude === undefined || tags.GPSLongitude === undefined) return null;
    var lat = dmsToDecimal(tags.GPSLatitude, tags.GPSLatitudeRef, "lat");
    var lon = dmsToDecimal(tags.GPSLongitude, tags.GPSLongitudeRef, "lon");
    var warnings = [];
    if (lat.refMissing || lon.refMissing) warnings.push("The N/S or E/W reference is missing, so the hemisphere is a guess (taken as north and east).");
    if (lat.value === 0 && lon.value === 0) warnings.push("0, 0 is in the Gulf of Guinea: devices often write it when they had no position fix.");
    var g = { lat: lat.value, lon: lon.value, altitudeM: null, utc: null, direction: null, speed: null, datum: null, warnings: warnings };
    var alt = rational(tags.GPSAltitude);
    if (isFinite(alt)) {
      var aref = Array.isArray(tags.GPSAltitudeRef) ? tags.GPSAltitudeRef[0] : tags.GPSAltitudeRef;
      g.altitudeM = Number(aref) === 1 ? -alt : alt;   // 1 = below sea level
    }
    g.utc = gpsUtc(tags.GPSDateStamp, tags.GPSTimeStamp);
    var dir = rational(tags.GPSImgDirection);
    if (isFinite(dir)) {
      var dref = str(tags.GPSImgDirectionRef).toUpperCase().charAt(0);
      g.direction = { deg: ((dir % 360) + 360) % 360, ref: dref === "M" ? "magnetic" : dref === "T" ? "true" : "unknown" };
    }
    var sp = rational(tags.GPSSpeed);
    if (isFinite(sp)) {
      var sref = str(tags.GPSSpeedRef).toUpperCase().charAt(0) || "K";
      var kmh = sref === "M" ? sp * 1.609344 : sref === "N" ? sp * 1.852 : sp;   // K km/h, M mph, N knots
      g.speed = { value: sp, unit: sref === "M" ? "mph" : sref === "N" ? "kn" : "km/h", kmh: kmh };
    }
    var datum = str(tags.GPSMapDatum);
    if (datum) {
      g.datum = datum;
      if (!/^WGS[\s\-]?84$/i.test(datum)) warnings.push("The position is on the " + datum + " datum, not WGS 84: on a WGS 84 map it can be off by tens to hundreds of metres.");
    }
    return g;
  }

  /** Minutes the camera clock reads ahead of the GPS (UTC) time, if both are there: a hint at the offset the clock
   *  was set to, not a recorded time zone. Either clock can be wrong. */
  function clockMinusGpsMinutes(dateParts, gpsIso) {
    if (!dateParts || !gpsIso) return null;
    var cam = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, dateParts.hour, dateParts.minute, dateParts.second);
    var gps = Date.parse(gpsIso);
    if (!isFinite(gps)) return null;
    return Math.round((cam - gps) / 60000);
  }

  /** Exposure time in seconds as a photographer reads it: "1/250 s", "0.4 s", "2 s". */
  function exposure(x) {
    var v = rational(x);
    if (!isFinite(v) || v <= 0) return "";
    if (x && typeof x === "object" && Number(x.numerator) === 1 && Number(x.denominator) > 1) return "1/" + Number(x.denominator) + " s";
    if (v < 1) {
      var r = 1 / v, n = Math.round(r);
      if (Math.abs(r - n) / r < 0.01) return "1/" + n + " s";
      return Number(v.toPrecision(3)) + " s";
    }
    return Number(v.toPrecision(4)) + " s";
  }

  var FLASH_RETURN = ["", "", "return light not detected", "return light detected"];
  var FLASH_MODE = ["", "compulsory firing", "compulsory suppression", "auto"];
  /** The Flash tag. A number is decoded bit by bit; a string (Exif.js already turns the number into words) is
   *  kept. Returns {fired: true | false | null, text}. */
  function flash(x) {
    if (x === undefined || x === null || x === "") return null;
    if (typeof x === "string" || (typeof x === "object" && !(x instanceof Number))) {
      var s = str(x);
      var fired = /^flash fired/i.test(s) ? true : /^(flash did not fire|no flash)/i.test(s) ? false : null;
      return { fired: fired, text: s };
    }
    var v = Number(x);
    if (!isFinite(v) || v < 0 || v > 127 || Math.floor(v) !== v) return { fired: null, text: "Unknown value " + x };
    if (v & 32) return { fired: false, text: "No flash function" };
    var parts = [(v & 1) ? "Fired" : "Did not fire"];
    var mode = FLASH_MODE[(v >> 3) & 3], ret = FLASH_RETURN[(v >> 1) & 3];
    if (mode) parts.push(mode + " mode");
    if (ret) parts.push(ret);
    if (v & 64) parts.push("red-eye reduction");
    return { fired: !!(v & 1), text: parts.join(", ") };
  }

  function whiteBalance(x) {
    if (x === undefined || x === null || x === "") return "";
    if (typeof x === "string") return str(x);
    var v = Number(x);
    return v === 0 ? "Auto" : v === 1 ? "Manual" : "Unknown value " + x;
  }
  function colorSpace(x) {
    if (x === undefined || x === null || x === "") return "";
    var v = Number(x);
    return v === 1 ? "sRGB" : v === 2 ? "Adobe RGB (camera's own marking)" : v === 65535 ? "Uncalibrated (often Adobe RGB)" : "Unknown value " + x;
  }
  var ORIENT = { 1: "Normal (no rotation)", 2: "Mirrored left to right", 3: "Rotate 180°", 4: "Mirrored top to bottom",
    5: "Mirror and rotate 270° clockwise", 6: "Rotate 90° clockwise", 7: "Mirror and rotate 90° clockwise", 8: "Rotate 270° clockwise" };
  function orientation(x) {
    if (x === undefined || x === null || x === "") return "";
    return ORIENT[Number(x)] || "Unknown value " + x;
  }

  /** File size in decimal units with the exact byte count: "2.41 MB (2,412,345 bytes)". */
  function fileSize(bytes) {
    if (typeof bytes !== "number" || !isFinite(bytes) || bytes < 0) return "";
    var exact = String(Math.round(bytes)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " bytes";
    if (bytes < 1000) return exact;
    if (bytes < 1e6) return (bytes / 1e3).toFixed(1) + " kB (" + exact + ")";
    return (bytes / 1e6).toFixed(2) + " MB (" + exact + ")";
  }

  /** One tag value as short text for the full tag list. Long byte arrays (maker notes, thumbnails) are summarised. */
  function tagText(v) {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v) || (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(v))) {
      if (v.length > 16) return "(" + v.length + " values not shown)";
      return Array.prototype.map.call(v, tagText).join(", ");
    }
    if (typeof v === "object" && "numerator" in v && "denominator" in v) {
      var r = rational(v);
      return isFinite(r) ? String(Number(r.toPrecision(8))) : v.numerator + "/" + v.denominator;
    }
    if (typeof v === "object") return "(structured value not shown)";
    var s = str(v);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  }

  /** Every tag as [name, text] rows, sorted by name; skips the thumbnail and Exif.js's unnamed tags. */
  function tagRows(tags) {
    return Object.keys(tags || {}).filter(function (k) { return k !== "thumbnail" && k !== "undefined" && k !== "MakerNote" && !/Pointer$/.test(k); })
      .sort().map(function (k) { return [k, tagText(tags[k])]; });
  }

  /** The figures the page shows, from an Exif.js tag object. gps is null when there is no position; a bad GPS
   *  block gives gpsError instead of throwing. */
  function summarise(tags) {
    tags = tags || {};
    var out = { camera: {}, dates: {}, settings: {}, image: {}, gps: null, gpsError: null, clockMinusGpsMin: null };
    ["Make", "Model", "Software", "Artist", "Copyright"].forEach(function (k) { var s = str(tags[k]); if (s) out.camera[k] = s; });
    out.dates.original = parseExifDate(tags.DateTimeOriginal, tags.OffsetTimeOriginal);
    out.dates.digitized = parseExifDate(tags.DateTimeDigitized, tags.OffsetTimeDigitized);
    out.dates.modified = parseExifDate(tags.DateTime, tags.OffsetTime);
    var iso = Array.isArray(tags.ISOSpeedRatings) ? tags.ISOSpeedRatings[0] : tags.ISOSpeedRatings;
    if (iso !== undefined && isFinite(Number(iso))) out.settings.iso = Number(iso);
    if (tags.ExposureTime !== undefined) out.settings.exposure = exposure(tags.ExposureTime);
    var f = rational(tags.FNumber); if (isFinite(f) && f > 0) out.settings.fNumber = Number(f.toPrecision(3));
    var fl = rational(tags.FocalLength); if (isFinite(fl) && fl > 0) out.settings.focalLengthMm = Number(fl.toPrecision(4));
    var fl35 = Number(tags.FocalLengthIn35mmFilm); if (isFinite(fl35) && fl35 > 0) out.settings.focalLength35mm = fl35;
    var fx = flash(tags.Flash); if (fx) out.settings.flash = fx;
    var wb = whiteBalance(tags.WhiteBalance); if (wb) out.settings.whiteBalance = wb;
    var o = orientation(tags.Orientation); if (o) out.image.orientation = o;
    var cs = colorSpace(tags.ColorSpace); if (cs) out.image.colorSpace = cs;
    var px = Number(tags.PixelXDimension), py = Number(tags.PixelYDimension);
    if (px > 0 && py > 0) out.image.exifPixels = px + " × " + py;
    try { out.gps = gpsFromTags(tags); } catch (e) { out.gpsError = e.message; }
    if (out.gps) out.clockMinusGpsMin = clockMinusGpsMinutes(out.dates.original, out.gps.utc);
    return out;
  }

  /** Plain links that open the position on a public map in a new tab. Following one sends the coordinates to that
   *  site in the link; nothing is sent unless the reader clicks. */
  function mapLinks(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    var a = lat.toFixed(6), o = lon.toFixed(6);
    return [
      { label: "OpenStreetMap", url: "https://www.openstreetmap.org/?mlat=" + a + "&mlon=" + o + "#map=16/" + a + "/" + o },
      { label: "Google Maps", url: "https://www.google.com/maps/search/?api=1&query=" + a + "%2C" + o }
    ];
  }

  return { mapLinks: mapLinks, rational: rational, str: str, dmsToDecimal: dmsToDecimal, parseExifDate: parseExifDate, gpsUtc: gpsUtc,
    gpsFromTags: gpsFromTags, clockMinusGpsMinutes: clockMinusGpsMinutes, exposure: exposure, flash: flash,
    whiteBalance: whiteBalance, colorSpace: colorSpace, orientation: orientation, fileSize: fileSize,
    tagText: tagText, tagRows: tagRows, summarise: summarise };
});
