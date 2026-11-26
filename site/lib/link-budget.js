/* Radio link budget: power at the receiver and the margin over its sensitivity, for a clear line-of-sight path.
   Free-space basic transmission loss from ITU-R Recommendation P.525 ("Calculation of free-space attenuation"),
   section 2.2: L_bf = 20 log10(4 pi d / lambda) = 32.45 + 20 log10 f(MHz) + 20 log10 d(km). The constant is
   computed here from the speed of light (32.4478 dB), which P.525 rounds to 32.4 and most texts to 32.45.
   The budget itself is the standard one (Sklar, Digital Communications, 2nd ed., chapter 5: the range equation and link budget analysis):
   P_rx = P_tx + G_tx - L_tx - L_fs - L_other + G_rx - L_rx, margin = P_rx - sensitivity. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).linkBudget = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var C_M_S = 299792458;                                          // m/s, speed of light (exact)
  var FSPL_CONST_DB = 20 * Math.log10(4 * Math.PI * 1e3 * 1e6 / C_M_S); // d in km (1e3 m), f in MHz (1e6 Hz)

  function log10(x) { return Math.log(x) / Math.LN10; }

  /** Free-space path loss in dB, frequency in MHz, distance in km (both > 0). */
  function fspl(freqMHz, distanceKm) {
    if (!(isFinite(freqMHz) && freqMHz > 0)) throw new Error("Frequency must be a number above 0.");
    if (!(isFinite(distanceKm) && distanceKm > 0)) throw new Error("Distance must be a number above 0.");
    return FSPL_CONST_DB + 20 * log10(freqMHz) + 20 * log10(distanceKm);
  }

  /** p: {txPowerDbm, txGainDbi, txLossDb, rxGainDbi, rxLossDb, rxSensitivityDbm, freqMHz, distanceKm, otherLossDb}.
   *  Losses are entered as positive numbers. Returns every figure the page shows. */
  function compute(p) {
    var keys = ["txPowerDbm", "txGainDbi", "txLossDb", "rxGainDbi", "rxLossDb", "rxSensitivityDbm", "freqMHz",
      "distanceKm", "otherLossDb"];
    keys.forEach(function (k) {
      if (typeof p[k] !== "number" || !isFinite(p[k])) throw new Error("Every input must be a number (" + k + ").");
    });
    ["txLossDb", "rxLossDb", "otherLossDb"].forEach(function (k) {
      if (p[k] < 0) throw new Error("Enter losses as positive numbers of dB.");
    });
    var loss = fspl(p.freqMHz, p.distanceKm);
    var eirpDbm = p.txPowerDbm + p.txGainDbi - p.txLossDb;
    var rxPowerDbm = eirpDbm - loss - p.otherLossDb + p.rxGainDbi - p.rxLossDb;
    var marginDb = rxPowerDbm - p.rxSensitivityDbm;
    return {
      eirpDbm: eirpDbm,
      eirpDbw: eirpDbm - 30,
      eirpW: Math.pow(10, (eirpDbm - 30) / 10),
      wavelengthM: C_M_S / (p.freqMHz * 1e6),
      fsplDb: loss,
      totalPathLossDb: loss + p.otherLossDb,
      rxPowerDbm: rxPowerDbm,
      marginDb: marginDb,
      // Free-space loss grows 20 dB per decade of distance, so the range at which the margin reaches 0 dB is
      // d * 10^(margin / 20), with every other term unchanged.
      zeroMarginRangeKm: p.distanceKm * Math.pow(10, marginDb / 20),
      marginClass: marginClass(marginDb)
    };
  }

  /** A rule of thumb only: below 0 dB the receiver is below its stated sensitivity; under 6 dB leaves little room
   *  for fading, pointing error and polarisation loss; 6 dB or more is the margin often planned for. */
  function marginClass(m) {
    if (!isFinite(m)) return "";
    if (m < 0) return "below";
    if (m < 6) return "thin";
    return "planned";
  }

  return { fspl: fspl, compute: compute, marginClass: marginClass, FSPL_CONST_DB: FSPL_CONST_DB, C_M_S: C_M_S };
});
