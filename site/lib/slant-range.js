/* Slant range from an observer to a satellite, given the satellite's altitude and its elevation above the
   observer's horizon. Spherical Earth. Reference: Wertz & Larson, Space Mission Analysis and Design, 3rd ed.,
   section 5.2 (Earth geometry viewed from space): sin(eta) = (R_obs / R_sat) * cos(el), lambda = 90 deg - el - eta,
   range = R_sat * sin(lambda) / cos(el). The same range also follows from the law of cosines, used here. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).slantRange = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH = 6371.0;      // km, mean Earth radius (IUGG)
  var C_KM_S = 299792.458;   // km/s, speed of light (exact)
  var D2R = Math.PI / 180;

  /** altitudeKm: satellite altitude above the sphere; elevationDeg: 0 (horizon) to 90 (overhead);
   *  observerAltKm: the observer's height above the sphere. Returns every figure the page shows. */
  function compute(altitudeKm, elevationDeg, observerAltKm) {
    observerAltKm = observerAltKm || 0;
    if (![altitudeKm, elevationDeg, observerAltKm].every(isFinite)) throw new Error("Every input must be a number.");
    if (elevationDeg < 0 || elevationDeg > 90) throw new Error("Elevation must be between 0 and 90 degrees.");
    if (altitudeKm <= observerAltKm) throw new Error("The satellite must be higher than the observer.");
    var ro = R_EARTH + observerAltKm;
    var rs = R_EARTH + altitudeKm;
    var el = elevationDeg * D2R;
    var nadir = Math.asin((ro / rs) * Math.cos(el));            // eta: angle at the satellite, off nadir
    var central = Math.PI / 2 - el - nadir;                       // lambda: Earth central angle
    var range = Math.sqrt(ro * ro + rs * rs - 2 * ro * rs * Math.cos(central));
    var horizonRange = Math.sqrt(rs * rs - ro * ro);              // range at 0 deg elevation
    var oneWayMs = range / C_KM_S * 1000;
    return {
      slantRangeKm: range,
      groundRangeKm: R_EARTH * central,                          // arc along the surface, sub-observer to sub-satellite
      horizonRangeKm: horizonRange,
      centralAngleDeg: central / D2R,
      nadirAngleDeg: nadir / D2R,
      oneWayDelayMs: oneWayMs,
      roundTripDelayMs: 2 * oneWayMs
    };
  }
  return { compute: compute, R_EARTH: R_EARTH, C_KM_S: C_KM_S };
});
