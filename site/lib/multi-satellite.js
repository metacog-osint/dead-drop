/* Multi-satellite tracker: where several satellites are now, the ground track each has just flown and is about to
   fly, and housekeeping for the tracked list. No DOM, no network, no orbit propagator: the caller passes
   propagate(ms) for each satellite, returning {position, velocity} in the TEME frame (km, km/s) or something falsy.
   Positions on the ground use ./ground-track.js (GMST rotation, Vallado section 3.5, and WGS 84 geodetic
   coordinates, Vallado Algorithm 12), and trails are split at the 180 deg meridian there. Ground speed is the speed
   of the point beneath the satellite over a sphere of radius 6371 km, from the great-circle distance between that
   point a second before and a second after (haversine formula: Chris Veness, "Calculate distance, bearing and more
   between latitude/longitude points", movable-type.co.uk). */
(function (root, factory) {
  var gt = (typeof module === "object" && module.exports) ? require("./ground-track.js") : (root.DD && root.DD.groundTrack);
  var api = factory(gt);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).multiSatellite = api;
})(typeof self !== "undefined" ? self : this, function (G) {
  "use strict";
  if (!G) throw new Error("multi-satellite.js needs ground-track.js loaded first.");
  var R_MEAN = 6371.0;            // km, mean Earth radius (IUGG), for ground speed
  var D2R = Math.PI / 180;

  // Eight colours that stay apart for most kinds of colour vision: the Okabe and Ito palette (2008) with its yellow,
  // hard to see on a light map, swapped for a wine red. Assigned in turn, so the first eight never share a colour.
  var PALETTE = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#56B4E9", "#E69F00", "#000000", "#882255"];
  function colour(i) { return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

  function finite3(v) { return !!v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z); }

  /** Great-circle distance between two points on the sphere, km (haversine). */
  function surfaceDistanceKm(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R_MEAN * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Where one satellite is at ms: {ms, latDeg, lonDeg, hKm, speedKmS (inertial), groundSpeedKmS}, or null when
   *  the propagator fails. */
  function position(propagate, ms) {
    var pv = propagate(ms);
    if (!pv || !finite3(pv.position)) return null;
    var g = G.subSatellitePoint(pv.position, ms);
    var out = { ms: ms, latDeg: g.latDeg, lonDeg: g.lonDeg, hKm: g.hKm,
      speedKmS: finite3(pv.velocity) ? Math.sqrt(pv.velocity.x * pv.velocity.x + pv.velocity.y * pv.velocity.y + pv.velocity.z * pv.velocity.z) : NaN,
      groundSpeedKmS: NaN };
    var a = propagate(ms - 1000), b = propagate(ms + 1000);
    if (a && b && finite3(a.position) && finite3(b.position)) {
      var ga = G.subSatellitePoint(a.position, ms - 1000), gb = G.subSatellitePoint(b.position, ms + 1000);
      out.groundSpeedKmS = surfaceDistanceKm(ga.latDeg, ga.lonDeg, gb.latDeg, gb.lonDeg) / 2;
    }
    return out;
  }

  /** The track flown in the last backMin minutes and the track to come in the next aheadMin minutes, each as map
   *  polylines split at the 180 deg meridian: {past: [[[lat, lon]...]...], ahead: [...]}. */
  function trail(propagate, nowMs, backMin, aheadMin, stepS) {
    if (!(backMin >= 0) || !(aheadMin >= 0)) throw new Error("The trail lengths must be zero or more minutes.");
    var step = stepS || 60;
    var past = backMin > 0 ? G.track(propagate, nowMs - backMin * 60000, backMin * 60, step) : [];
    var ahead = aheadMin > 0 ? G.track(propagate, nowMs, aheadMin * 60, step) : [];
    return { past: G.splitAntimeridian(past), ahead: G.splitAntimeridian(ahead) };
  }

  /** Adds parsed element sets ({catalogNumber, epochMs, ...}) to a tracked list. A satellite already in the list is
   *  replaced only by a newer element set. Returns {list, added, replaced, skipped} with a new list. */
  function merge(list, incoming) {
    var out = (list || []).slice(), added = 0, replaced = 0, skipped = 0;
    (incoming || []).forEach(function (e) {
      if (!e || !isFinite(e.catalogNumber) || !isFinite(e.epochMs)) { skipped++; return; }
      var i = -1;
      for (var k = 0; k < out.length; k++) if (out[k].catalogNumber === e.catalogNumber) { i = k; break; }
      if (i < 0) { out.push(e); added++; }
      else if (e.epochMs > out[i].epochMs) { out[i] = e; replaced++; }
      else skipped++;
    });
    return { list: out, added: added, replaced: replaced, skipped: skipped };
  }

  // Catalog numbers the page offers as one-click CelesTrak lookups.
  var PRESETS = [
    { label: "ISS", catalogNumber: 25544 },
    { label: "Hubble Space Telescope", catalogNumber: 20580 },
    { label: "Tiangong (Tianhe core module)", catalogNumber: 48274 }
  ];

  return { colour: colour, PALETTE: PALETTE, position: position, trail: trail, merge: merge,
    surfaceDistanceKm: surfaceDistanceKm, PRESETS: PRESETS, R_MEAN: R_MEAN };
});
