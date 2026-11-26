/* Doppler shift on a satellite radio link from the range rate (how fast the distance between the observer and the
   satellite is changing). No DOM, no network.
   First-order Doppler: f_received = f_transmitted * (1 - rdot / c), so the shift is -f * rdot / c, positive while
   the satellite approaches (rdot < 0) and negative while it recedes. Reference: Montenbruck & Gill, Satellite
   Orbits (2000), section 6.2.3 (range-rate measurements); Vallado, Fundamentals of Astrodynamics and Applications,
   4th ed., section 4.4 (range rate in the observer's frame). The second-order (relativistic) term is about
   (v/c)^2 = 6e-10 of the frequency at 7.5 km/s, under 0.1 Hz at 145 MHz, and is left out.
   The range rate must be taken along the line from the observer to the satellite, with both in the Earth-fixed
   frame (the observer is then at rest). The speed of the satellite towards or away from the Earth's centre is a
   different quantity and is close to zero for a circular orbit. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).rfDoppler = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var C_KM_S = 299792.458;     // km/s, speed of light (exact)

  function finite3(v) { return v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z); }

  /** Range rate, km/s, from the satellite's Earth-fixed position and velocity and the observer's Earth-fixed
   *  position (all km and km/s). Positive when the distance is growing. */
  function rangeRate(rSat, vSat, rObs) {
    if (!finite3(rSat) || !finite3(vSat) || !finite3(rObs)) throw new Error("Positions and velocity must have numeric x, y and z.");
    var dx = rSat.x - rObs.x, dy = rSat.y - rObs.y, dz = rSat.z - rObs.z;
    var r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r < 1e-9) throw new Error("The satellite and the observer are at the same point.");
    return (dx * vSat.x + dy * vSat.y + dz * vSat.z) / r;
  }

  /** Downlink: the satellite transmits fHz; the shift heard on the ground, Hz. */
  function shiftHz(fHz, rangeRateKmS) {
    if (!isFinite(fHz) || !(fHz > 0)) throw new Error("The frequency must be a positive number.");
    if (!isFinite(rangeRateKmS)) throw new Error("The range rate must be a number.");
    if (Math.abs(rangeRateKmS) >= C_KM_S) throw new Error("The range rate cannot reach the speed of light.");
    return -fHz * rangeRateKmS / C_KM_S;
  }

  /** Downlink frequency heard on the ground, Hz. */
  function receivedHz(fHz, rangeRateKmS) { return fHz + shiftHz(fHz, rangeRateKmS); }

  /** Uplink: the frequency to transmit from the ground so that the satellite receives fHz, Hz. The satellite hears
   *  f_ground * (1 - rdot / c), so f_ground = f / (1 - rdot / c). */
  function uplinkTransmitHz(fHz, rangeRateKmS) {
    shiftHz(fHz, rangeRateKmS);   // validates
    return fHz / (1 - rangeRateKmS / C_KM_S);
  }

  /** Doppler over a list of samples [{ms, rangeRateKmS}]: adds shiftHz and receivedHz to each. */
  function curve(fHz, samples) {
    return samples.filter(function (s) { return s && isFinite(s.rangeRateKmS); }).map(function (s) {
      var d = shiftHz(fHz, s.rangeRateKmS);
      var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; });
      o.shiftHz = d; o.receivedHz = fHz + d;
      return o;
    });
  }

  return { rangeRate: rangeRate, shiftHz: shiftHz, receivedHz: receivedHz, uplinkTransmitHz: uplinkTransmitHz,
    curve: curve, C_KM_S: C_KM_S };
});
