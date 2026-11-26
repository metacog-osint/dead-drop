/* Doppler shift of a radio signal from a moving transmitter, such as a satellite.
   Sign convention: range rate (rho-dot) is the rate of change of the distance between transmitter and receiver,
   positive when the distance grows (receding), as in Vallado, Fundamentals of Astrodynamics and Applications,
   4th ed., chapter 4, the RAZEL algorithm (range, azimuth, elevation and their rates). The first-order Doppler shift is
   delta_f = -f * rho_dot / c (Rappaport, Wireless Communications, 2nd ed., section 5.2.1, where an approaching
   source raises the received frequency). Second-order (relativistic) terms are below 1e-9 of f at orbital speeds.
   Angle: alpha is the angle between the transmitter's velocity relative to the receiver and the line from the
   transmitter to the receiver, so rho_dot = -v cos(alpha): 0 deg heads straight at the receiver, 90 deg crosses,
   180 deg heads straight away.
   Circular-orbit helper: speed v = sqrt(mu / r) (Curtis, Orbital Mechanics for Engineering Students, section 2.6).
   In the orbit plane, the satellite's velocity is horizontal at the satellite, so its component along the line of
   sight is v sin(eta), where eta is the nadir angle at the satellite (Wertz & Larson, SMAD 3rd ed., section 5.2:
   sin(eta) = (R / r) cos(elevation)). Over a non-rotating Earth this peaks at the horizon: v R / r. The Earth's
   rotation moves the observer at up to omega_E R cos(latitude), so |rho_dot| <= v R / r + omega_E R cos(latitude)
   for any pass: a strict upper bound. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).dopplerShift = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var C_KM_S = 299792.458;       // km/s, speed of light (exact)
  var MU_EARTH = 398600.4418;    // km^3/s^2, WGS 84 gravitational parameter
  var R_EARTH = 6371.0;          // km, mean Earth radius (IUGG)
  var OMEGA_E = 7.292115e-5;     // rad/s, WGS 84 Earth rotation rate
  var D2R = Math.PI / 180;

  function need(x, what) { if (typeof x !== "number" || !isFinite(x)) throw new Error(what + " must be a number."); }

  /** Shift in Hz for a carrier of freqMHz and a range rate in km/s (positive = receding). */
  function shiftHz(freqMHz, rangeRateKmS) {
    need(freqMHz, "Frequency"); need(rangeRateKmS, "Range rate");
    if (freqMHz <= 0) throw new Error("Frequency must be above 0.");
    if (Math.abs(rangeRateKmS) >= C_KM_S) throw new Error("Speed must be below the speed of light.");
    return -freqMHz * 1e6 * rangeRateKmS / C_KM_S;
  }

  /** speedKmS: the transmitter's speed relative to the receiver; angleDeg: alpha as defined above. */
  function compute(freqMHz, speedKmS, angleDeg) {
    need(speedKmS, "Speed"); need(angleDeg, "Angle");
    if (speedKmS < 0) throw new Error("Speed cannot be negative; use the angle for direction.");
    var rangeRate = -speedKmS * Math.cos(angleDeg * D2R);
    // cos(90 deg) in floating point is 6e-17, not 0; show a crossing as exactly zero.
    if (Math.abs(rangeRate) < 1e-12 * Math.max(1, speedKmS)) rangeRate = 0;
    var df = shiftHz(freqMHz, rangeRate);
    if (df === 0) df = 0; // no negative zero
    return {
      rangeRateKmS: rangeRate,
      shiftHz: df,
      receivedMHz: freqMHz + df / 1e6,
      fullSpeedShiftHz: freqMHz * 1e6 * speedKmS / C_KM_S   // the size of the shift if all the speed were along the line of sight
    };
  }

  /** Circular orbit at altitudeKm. Optional elevationDeg gives the line-of-sight speed for an overhead pass at that
   *  elevation (non-rotating Earth); latitudeDeg (default 0, the worst case) sets the Earth-rotation allowance. */
  function circular(freqMHz, altitudeKm, elevationDeg, latitudeDeg) {
    need(freqMHz, "Frequency"); need(altitudeKm, "Altitude");
    if (freqMHz <= 0) throw new Error("Frequency must be above 0.");
    if (altitudeKm <= 0) throw new Error("Altitude must be above 0.");
    latitudeDeg = latitudeDeg === undefined || latitudeDeg === null ? 0 : latitudeDeg;
    need(latitudeDeg, "Latitude");
    if (Math.abs(latitudeDeg) > 90) throw new Error("Latitude must be between -90 and 90 degrees.");
    var r = R_EARTH + altitudeKm;
    var v = Math.sqrt(MU_EARTH / r);
    var losMax = v * R_EARTH / r;                                  // at the horizon, overhead pass, non-rotating Earth
    var rot = OMEGA_E * R_EARTH * Math.cos(latitudeDeg * D2R);       // observer's speed from the Earth's rotation
    var out = {
      orbitalSpeedKmS: v,
      periodMin: 2 * Math.PI * Math.sqrt(r * r * r / MU_EARTH) / 60,
      losMaxKmS: losMax,
      losMaxShiftHz: freqMHz * 1e6 * losMax / C_KM_S,
      rotationKmS: rot,
      boundKmS: losMax + rot,
      boundShiftHz: freqMHz * 1e6 * (losMax + rot) / C_KM_S
    };
    if (elevationDeg !== undefined && elevationDeg !== null) {
      need(elevationDeg, "Elevation");
      if (elevationDeg < 0 || elevationDeg > 90) throw new Error("Elevation must be between 0 and 90 degrees.");
      var sinEta = (R_EARTH / r) * Math.cos(elevationDeg * D2R);
      out.losAtElevationKmS = v * sinEta;
      out.shiftAtElevationHz = freqMHz * 1e6 * v * sinEta / C_KM_S;
    }
    return out;
  }

  return { shiftHz: shiftHz, compute: compute, circular: circular,
    C_KM_S: C_KM_S, MU_EARTH: MU_EARTH, R_EARTH: R_EARTH, OMEGA_E: OMEGA_E };
});
