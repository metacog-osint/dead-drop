/* Shadow chronolocation: the times of day at which the Sun stood where a shadow says it stood, for a known place and
   date. Pure functions: no DOM, no network. The Sun's position comes from ./sun-position.js (Meeus, Astronomical
   Algorithms, ch. 25, term for term the NOAA Solar Calculator), loaded read-only.
   - A vertical object of height h on level ground casts a shadow of length L when the Sun's elevation (its height
     above the horizon) is e = atan(h / L). The light that casts the shadow has been bent by the atmosphere, so e is
     the apparent elevation, refraction included, and that is what is matched.
   - The shadow points directly away from the Sun, so the Sun's azimuth (compass direction from true north,
     clockwise) is the shadow's azimuth plus 180 degrees.
   - The Sun reaches any one elevation twice a day, once climbing and once sinking, so an elevation alone gives two
     candidate times, roughly symmetric about solar noon. The azimuth tells them apart.
   - Method: the Sun's apparent elevation (or azimuth) is worked out every minute through the local solar day, and
     each crossing of the target value is refined by bisection to under a second. Solar noon and solar midnight are
     added to the scan so that a crossing close to the day's highest or lowest point is not missed.
   - Sensitivity: minutes of time per degree of elevation (or azimuth) error is 1 / (rate of change) at the
     candidate, from a central difference over one minute. The effect of a 5 % error in the measured ratio h / L is
     found exactly, by solving again for atan(0.95 h / L) and atan(1.05 h / L) on the same side of noon.
   Worked practice: the same method as the shadow-based chronolocation in Bellingcat's published open-source
   investigation guides, which use SunCalc for the Sun; the Sun's position here follows NOAA's Solar Calculator. */
(function (root, factory) {
  var sun = (typeof module === "object" && module.exports) ? require("./sun-position.js") : (root.DD && root.DD.sunPosition);
  var api = factory(sun);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).shadowChronolocation = api;
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, MIN = 60000, DAY = 86400000;

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function wrap180(x) { x = norm360(x); return x >= 180 ? x - 360 : x; }

  /** Apparent Sun elevation, degrees, that makes a vertical object of height h cast a shadow of length L on level
   *  ground (h and L in the same unit). */
  function elevationFromShadow(h, L) {
    if (!isNum(h) || !(h > 0)) throw new Error("The object's height must be a number above 0.");
    if (!isNum(L) || !(L > 0)) throw new Error("The shadow's length must be a number above 0.");
    return Math.atan(h / L) * R2D;
  }

  /** Shadow length per unit of height at apparent Sun elevation e (degrees). */
  function shadowPerHeight(e) { return e > 0 ? 1 / Math.tan(e * D2R) : Infinity; }

  /** The Sun's azimuth from the direction a shadow points (both degrees from true north, clockwise). */
  function sunAzimuthFromShadow(shadowAz) {
    if (!isNum(shadowAz) || shadowAz < 0 || shadowAz > 360) throw new Error("The shadow's direction must be from 0 to 360 degrees.");
    return norm360(shadowAz + 180);
  }

  /** The local solar day for a calendar date "YYYY-MM-DD" at longitude lon (east positive): local mean midnight to
   *  midnight, as UTC milliseconds, and the solar noon within it. */
  function dayWindow(date, lat, lon) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || "").trim());
    if (!m) throw new Error("Enter the date as YYYY-MM-DD.");
    var y = +m[1], mo = +m[2], d = +m[3];
    var day0 = Date.UTC(y, mo - 1, d);
    var chk = new Date(day0);
    if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) throw new Error("Not a real date: " + date);
    S.position(day0, lat, lon);   // checks latitude and longitude
    var start = day0 - lon * 240000;
    var ev = S.events(day0 + (720 - 4 * lon) * MIN, lat, lon);
    return { date: date, day0: day0, startMs: start, endMs: start + DAY, solarNoon: ev.solarNoon,
      noonElevation: ev.noonElevation, solarMidnight: ev.solarNoon + (ev.solarNoon - DAY / 2 < start ? DAY / 2 : -DAY / 2) };
  }

  /** Times in [w.startMs, w.endMs] where fn(t) changes sign. fn returns NaN where it is not defined. Pairs whose
   *  values are both larger than `jump` in size are skipped (an angle wrapping through +-180). */
  function crossings(fn, w, jump) {
    var ts = [];
    for (var t = w.startMs; t <= w.endMs; t += MIN) ts.push(t);
    [w.solarNoon, w.solarMidnight].forEach(function (x) { if (x > w.startMs && x < w.endMs) ts.push(x); });
    ts.sort(function (a, b) { return a - b; });
    var vs = ts.map(fn), out = [];
    for (var i = 1; i < ts.length; i++) {
      var va = vs[i - 1], vb = vs[i];
      if (!isFinite(va) || !isFinite(vb)) continue;
      if (jump && (Math.abs(va) > jump || Math.abs(vb) > jump)) continue;
      if (!((va < 0 && vb >= 0) || (va > 0 && vb <= 0))) continue;
      var lo = ts[i - 1], hi = ts[i], flo = va;
      for (var j = 0; j < 40 && hi - lo > 1; j++) {
        var mid = (lo + hi) / 2, fm = fn(mid);
        if (!isFinite(fm)) break;
        if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      out.push({ ms: Math.round((lo + hi) / 2), rising: vb > va });
    }
    return out;
  }

  function elevAt(ms, lat, lon) { return S.position(ms, lat, lon).elevation; }

  /** Rate of change of the apparent elevation (degrees per minute) and of the azimuth at ms. */
  function rates(ms, lat, lon) {
    var a = S.position(ms - MIN / 2, lat, lon), b = S.position(ms + MIN / 2, lat, lon);
    return { elevation: b.elevation - a.elevation, azimuth: wrap180(b.azimuth - a.azimuth) };
  }

  function elevationTimes(eTarget, w, lat, lon) {
    return crossings(function (t) { return elevAt(t, lat, lon) - eTarget; }, w);
  }

  /** Of a list of crossings, the nearest on the same branch (climbing or sinking) as cand, or null. */
  function sameBranch(list, cand) {
    var best = null;
    list.forEach(function (c) {
      if (c.rising !== cand.rising) return;
      if (!best || Math.abs(c.ms - cand.ms) < Math.abs(best.ms - cand.ms)) best = c;
    });
    return best;
  }

  /** The candidate times. input: { lat, lon, date: "YYYY-MM-DD", heightM, shadowM, shadowAzimuth }. Give heightM and
   *  shadowM together, shadowAzimuth, or all three. */
  function solve(input) {
    var lat = input.lat, lon = input.lon;
    var hasRatio = input.heightM !== undefined && input.heightM !== null || input.shadowM !== undefined && input.shadowM !== null;
    var hasAz = input.shadowAzimuth !== undefined && input.shadowAzimuth !== null;
    if (!hasRatio && !hasAz) throw new Error("Give the object's height and shadow length, the shadow's direction, or both.");
    var w = dayWindow(input.date, lat, lon);
    var out = { window: w, elevationMatches: [], azimuthMatches: [], notes: [] };
    var minElev = Infinity, maxElev = -Infinity;
    for (var t = w.startMs; t <= w.endMs; t += 10 * MIN) {
      var e = elevAt(t, lat, lon); if (e < minElev) minElev = e; if (e > maxElev) maxElev = e;
    }
    maxElev = Math.max(maxElev, w.noonElevation);
    out.maxElevation = maxElev; out.minElevation = minElev;

    if (hasRatio) {
      var eT = elevationFromShadow(input.heightM, input.shadowM);
      var ratio = input.heightM / input.shadowM;
      out.ratio = ratio;
      out.targetElevation = eT;
      out.elevation5pct = { low: Math.atan(0.95 * ratio) * R2D, high: Math.atan(1.05 * ratio) * R2D };
      var loList = elevationTimes(out.elevation5pct.low, w, lat, lon), hiList = elevationTimes(out.elevation5pct.high, w, lat, lon);
      elevationTimes(eT, w, lat, lon).forEach(function (c) {
        var p = S.position(c.ms, lat, lon), r = rates(c.ms, lat, lon);
        var lo = sameBranch(loList, c), hi = sameBranch(hiList, c);
        out.elevationMatches.push({
          ms: c.ms, rising: c.rising, azimuth: p.azimuth, elevation: p.elevation,
          eqTimeMin: p.eqTimeMin, hourAngle: p.hourAngle,
          degPerMin: r.elevation, minPerDegree: 1 / Math.abs(r.elevation),
          // Shadow 5 % shorter (ratio 5 % higher) means a higher Sun; 5 % longer, a lower Sun.
          ratioPlus5: hi ? { ms: hi.ms, shiftMin: (hi.ms - c.ms) / MIN } : { ms: w.solarNoon, shiftMin: (w.solarNoon - c.ms) / MIN, capped: true },
          ratioMinus5: lo ? { ms: lo.ms, shiftMin: (lo.ms - c.ms) / MIN } : null,
          azimuthResidual: hasAz ? wrap180(p.azimuth - sunAzimuthFromShadow(input.shadowAzimuth)) : null
        });
      });
      if (!out.elevationMatches.length) {
        if (eT > maxElev) out.notes.push("The Sun never climbs to " + eT.toFixed(2) + "° on this day here: its highest is " +
          maxElev.toFixed(2) + "° at solar noon. Check the date, the place and the measurements.");
        else if (eT < minElev) out.notes.push("The Sun never sinks as low as " + eT.toFixed(2) + "° on this day here: its lowest is " +
          minElev.toFixed(2) + "°.");
      }
    }

    if (hasAz) {
      var azSun = sunAzimuthFromShadow(input.shadowAzimuth);
      out.sunAzimuth = azSun;
      crossings(function (t) {
        var p = S.position(t, lat, lon);
        return p.elevation > 0 ? wrap180(p.azimuth - azSun) : NaN;   // a shadow needs the Sun above the horizon
      }, w, 90).forEach(function (c) {
        var p = S.position(c.ms, lat, lon), r = rates(c.ms, lat, lon);
        out.azimuthMatches.push({
          ms: c.ms, azimuth: p.azimuth, elevation: p.elevation, eqTimeMin: p.eqTimeMin, hourAngle: p.hourAngle,
          degPerMin: r.azimuth, minPerDegree: 1 / Math.abs(r.azimuth),
          shadowPerHeight: shadowPerHeight(p.elevation),
          elevationResidual: hasRatio ? p.elevation - out.targetElevation : null
        });
      });
      if (!out.azimuthMatches.length) out.notes.push("The Sun is never at azimuth " + azSun.toFixed(1) +
        "° while it is up on this day here, so no shadow points to " + norm360(input.shadowAzimuth).toFixed(1) + "°.");
    }

    if (hasRatio && hasAz && out.elevationMatches.length) {
      var best = out.elevationMatches.reduce(function (a, b) { return Math.abs(b.azimuthResidual) < Math.abs(a.azimuthResidual) ? b : a; });
      var nearAz = null;
      out.azimuthMatches.forEach(function (m) { if (!nearAz || Math.abs(m.ms - best.ms) < Math.abs(nearAz.ms - best.ms)) nearAz = m; });
      out.best = { ms: best.ms, azimuthResidual: best.azimuthResidual,
        azimuthTimeMs: nearAz ? nearAz.ms : null, gapMin: nearAz ? (nearAz.ms - best.ms) / MIN : null,
        agrees: Math.abs(best.azimuthResidual) <= AGREE_DEG };
    }
    return out;
  }
  // Rule of thumb, not a standard: a shadow's direction read off an image is seldom better than a few degrees, so
  // an azimuth more than 10 degrees away from the elevation's answer is flagged as a disagreement.
  var AGREE_DEG = 10;

  /** Apparent (sundial) solar time at longitude lon for an instant: minutes after local apparent midnight. */
  function apparentSolarMinutes(ms, lon, eqTimeMin) {
    var utcMin = ((ms % DAY) + DAY) % DAY / MIN;
    return norm360((utcMin + eqTimeMin + 4 * lon) / 4) * 4;
  }

  return { elevationFromShadow: elevationFromShadow, shadowPerHeight: shadowPerHeight,
    sunAzimuthFromShadow: sunAzimuthFromShadow, dayWindow: dayWindow, solve: solve,
    apparentSolarMinutes: apparentSolarMinutes, AGREE_DEG: AGREE_DEG, wrap180: wrap180 };
});
