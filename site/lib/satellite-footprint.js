/* Satellite footprint: the patch of ground from which a satellite stands at or above a chosen minimum elevation
   angle. Spherical Earth. Reference: Wertz & Larson, Space Mission Analysis and Design, 3rd ed., section 5.2
   (Earth geometry viewed from space):
     sin(rho) = R / (R + h)                  rho: angular radius of the Earth seen from the satellite
     sin(eta) = sin(rho) * cos(el)           eta: nadir angle at the satellite to the footprint edge
     lambda   = 90 deg - el - eta            lambda: Earth central angle, centre of footprint to edge
     D        = R * sin(lambda) / sin(eta)   D: slant range to the footprint edge
     area     = 2 * pi * R^2 * (1 - cos(lambda))   the spherical cap the footprint covers */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).satelliteFootprint = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var R_EARTH = 6371.0;   // km, mean Earth radius (IUGG); the same sphere as the Slant Range Calculator
  var D2R = Math.PI / 180;

  /** altitudeKm: satellite altitude above the sphere; minElevationDeg: lowest usable elevation, 0 to 90. */
  function compute(altitudeKm, minElevationDeg) {
    if (!isFinite(altitudeKm) || !isFinite(minElevationDeg)) throw new Error("Every input must be a number.");
    if (altitudeKm <= 0) throw new Error("Altitude must be above zero.");
    if (altitudeKm > 1e6) throw new Error("Altitude must be under 1,000,000 km.");
    if (minElevationDeg < 0 || minElevationDeg >= 90) throw new Error("Minimum elevation must be from 0 up to (not including) 90 degrees.");
    var rs = R_EARTH + altitudeKm;
    var el = minElevationDeg * D2R;
    var sinRho = R_EARTH / rs;
    var rho = Math.asin(sinRho);
    var eta = Math.asin(sinRho * Math.cos(el));
    var lambda = Math.PI / 2 - el - eta;
    // Law of cosines in the triangle Earth centre, edge point, satellite (angle lambda at the centre).
    var slant = Math.sqrt(R_EARTH * R_EARTH + rs * rs - 2 * R_EARTH * rs * Math.cos(lambda));
    var capArea = 2 * Math.PI * R_EARTH * R_EARTH * (1 - Math.cos(lambda));
    var earthArea = 4 * Math.PI * R_EARTH * R_EARTH;
    return {
      earthAngularRadiusDeg: rho / D2R,
      nadirAngleDeg: eta / D2R,          // half-angle a sensor or antenna needs to reach the footprint edge
      centralAngleDeg: lambda / D2R,
      footprintRadiusKm: R_EARTH * lambda,             // along the surface, footprint centre to edge
      footprintDiameterKm: 2 * R_EARTH * lambda,        // along the surface, edge to edge
      edgeSlantRangeKm: slant,
      areaKm2: capArea,
      fractionOfEarth: capArea / earthArea
    };
  }
  return { compute: compute, R_EARTH: R_EARTH };
});
