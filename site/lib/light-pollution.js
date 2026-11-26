/* Light Pollution Map: sky-brightness conversions and the Bortle class from naked-eye limiting magnitude. No DOM.
   References:
   - Sky brightness in magnitudes per square arcsecond (what a Sky Quality Meter, SQM, reads) to luminance:
     L [cd/m^2] = 10.8e4 * 10^(-0.4 * m). P. Cinzano, "Night sky photometry with Sky Quality Meter", ISTIL Internal
     Report 9 (2005), the conversion used across the light-pollution literature.
   - Natural (unpolluted) zenith sky: 22.0 mag/arcsec^2, about 174 microcandela per square metre. F. Falchi et al.,
     "The new world atlas of artificial night sky brightness", Science Advances 2, e1600377 (2016).
   - Bortle classes and their naked-eye limiting magnitudes: J. E. Bortle, "Introducing the Bortle Dark-Sky Scale",
     Sky & Telescope, February 2001. Bortle defined the classes by what an observer sees, not by a meter reading, so
     no SQM-to-Bortle conversion is offered here. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).lightPollution = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var K_CD = 10.8e4;           // cd/m^2 at 0 mag/arcsec^2 (Cinzano 2005)
  var NATURAL_SQM = 22.0;      // mag/arcsec^2, natural zenith sky (Falchi et al. 2016)

  // Bortle (2001): class, his name for it, and the naked-eye limiting magnitude (NELM) range he gives.
  var BORTLE = [
    { cls: 1, name: "Excellent dark-sky site", nelm: "7.6 to 8.0", min: 7.6 },
    { cls: 2, name: "Typical truly dark site", nelm: "7.1 to 7.5", min: 7.1 },
    { cls: 3, name: "Rural sky", nelm: "6.6 to 7.0", min: 6.6 },
    { cls: 4, name: "Rural/suburban transition", nelm: "6.1 to 6.5", min: 6.1 },
    { cls: 5, name: "Suburban sky", nelm: "5.6 to 6.0", min: 5.6 },
    { cls: 6, name: "Bright suburban sky", nelm: "5.1 to 5.5", min: 5.1 },
    { cls: 7, name: "Suburban/urban transition", nelm: "4.6 to 5.0", min: 4.6 },
    { cls: 8, name: "City sky", nelm: "4.1 to 4.5", min: 4.1 },
    { cls: 9, name: "Inner-city sky", nelm: "4.0 or brighter", min: -Infinity }
  ];

  function num(x, what) {
    if (typeof x !== "number" || !isFinite(x)) throw new Error(what + " must be a number.");
    return x;
  }

  /** Sky brightness (mag/arcsec^2) to luminance (cd/m^2). Larger magnitudes are darker skies. */
  function sqmToCdm2(m) {
    num(m, "Sky brightness");
    if (m < 0 || m > 30) throw new Error("Sky brightness must be between 0 and 30 mag/arcsec².");
    return K_CD * Math.pow(10, -0.4 * m);
  }

  /** Luminance (cd/m^2) to sky brightness (mag/arcsec^2). */
  function cdm2ToSqm(L) {
    num(L, "Luminance");
    if (!(L > 0)) throw new Error("Luminance must be greater than zero.");
    return -2.5 * Math.log10(L / K_CD);
  }

  /** How many times brighter the sky is than the natural sky (1 = natural). */
  function ratioToNatural(m, naturalSqm) {
    num(m, "Sky brightness");
    naturalSqm = naturalSqm === undefined ? NATURAL_SQM : num(naturalSqm, "Natural sky brightness");
    return Math.pow(10, -0.4 * (m - naturalSqm));
  }

  /** Every figure the converter shows for one reading. */
  function fromSqm(m) {
    var L = sqmToCdm2(m);
    var ratio = ratioToNatural(m);
    return {
      sqm: m,
      cdm2: L,
      mcdm2: L * 1e3,
      ucdm2: L * 1e6,
      ratioToNatural: ratio,
      artificialPctOfNatural: (ratio - 1) * 100   // negative when the reading is darker than 22.0
    };
  }

  /** Bortle class from the faintest star magnitude seen with the naked eye near the zenith. A value between two of
   *  Bortle's ranges (e.g. 7.55) goes to the brighter-sky class. */
  function bortleFromNelm(nelm) {
    num(nelm, "Limiting magnitude");
    if (nelm < 0 || nelm > 8.5) throw new Error("Naked-eye limiting magnitude must be between 0 and 8.5.");
    for (var i = 0; i < BORTLE.length; i++) if (nelm >= BORTLE[i].min - 1e-9) return BORTLE[i];
    return BORTLE[BORTLE.length - 1];
  }

  /** Checks a map position and wraps longitude to -180..180. */
  function checkLatLon(lat, lon) {
    num(lat, "Latitude"); num(lon, "Longitude");
    if (lat < -90 || lat > 90) throw new Error("Latitude must be between -90 and 90.");
    var x = ((lon + 180) % 360 + 360) % 360 - 180;
    if (x === -180 && lon > 0) x = 180;
    return { lat: lat, lon: x };
  }

  /** Cleans a saved site list read back from the browser: keeps entries with a name and a valid position. */
  function cleanSites(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (s) {
      if (!s || typeof s.name !== "string" || !s.name.trim()) return;
      try {
        var p = checkLatLon(Number(s.lat), Number(s.lon));
        out.push({ name: s.name.trim().slice(0, 80), lat: p.lat, lon: p.lon,
          savedUtc: typeof s.savedUtc === "string" ? s.savedUtc : null });
      } catch (e) { /* drop a bad entry */ }
    });
    return out;
  }

  return { sqmToCdm2: sqmToCdm2, cdm2ToSqm: cdm2ToSqm, ratioToNatural: ratioToNatural, fromSqm: fromSqm,
    bortleFromNelm: bortleFromNelm, checkLatLon: checkLatLon, cleanSites: cleanSites,
    BORTLE: BORTLE, K_CD: K_CD, NATURAL_SQM: NATURAL_SQM };
});
