/* Link Budget Calculator page. The maths is in ../lib/link-budget.js (tested in tests/link-budget.test.js). */
(function () {
  "use strict";
  var KEY = "link-budget";
  var IDS = ["txPower", "txGain", "txLoss", "rxGain", "rxLoss", "rxSens", "freq", "distance", "otherLoss"];
  var last = null;
  var WORDS = {
    below: { text: "Below sensitivity", cls: "alarm" },
    thin: { text: "Thin margin", cls: "warn" },
    planned: { text: "Margin often planned for", cls: "ok" }
  };
  function sign(x, n) { return (x >= 0 ? "+" : "") + TB.fix(x, n); }
  function run() {
    TB.message("msg", "");
    var input = {};
    IDS.forEach(function (k) { input[k] = TB.num(k); });
    try {
      var r = DD.linkBudget.compute({
        txPowerDbm: input.txPower, txGainDbi: input.txGain, txLossDb: input.txLoss, rxGainDbi: input.rxGain,
        rxLossDb: input.rxLoss, rxSensitivityDbm: input.rxSens, freqMHz: input.freq, distanceKm: input.distance,
        otherLossDb: input.otherLoss
      });
      last = { input: input, result: r };
      TB.save(KEY, input);
      var w = WORDS[r.marginClass];
      TB.results("results", [
        { k: "Link margin", v: sign(r.marginDb, 2), u: "dB", cls: w.cls },
        { k: "Margin reading (rule of thumb)", v: w.text, cls: w.cls },
        { k: "Received power", v: TB.fix(r.rxPowerDbm, 2), u: "dBm" },
        { k: "EIRP", v: TB.fix(r.eirpDbm, 2), u: "dBm", title: "Effective isotropic radiated power" },
        { k: "EIRP", v: TB.fix(r.eirpDbw, 2), u: "dBW" },
        { k: "EIRP", v: TB.fix(r.eirpW, r.eirpW < 10 ? 3 : 1), u: "W" },
        { k: "Free-space path loss", v: TB.fix(r.fsplDb, 2), u: "dB" },
        { k: "Range at zero margin", v: TB.fix(r.zeroMarginRangeKm, 1), u: "km",
          title: "The distance at which the margin would fall to 0 dB, with every other term unchanged" },
        { k: "Wavelength", v: TB.fix(r.wavelengthM, r.wavelengthM < 1 ? 4 : 2), u: "m" }
      ]);
      TB.table("budget", ["Term", "dB"], [
        ["Transmit power (dBm)", TB.fix(input.txPower, 2)],
        ["+ transmit antenna gain", sign(input.txGain, 2)],
        ["− transmit cable loss", sign(-input.txLoss, 2)],
        ["= EIRP (dBm)", TB.fix(r.eirpDbm, 2)],
        ["− free-space path loss", sign(-r.fsplDb, 2)],
        ["− other path losses", sign(-input.otherLoss, 2)],
        ["+ receive antenna gain", sign(input.rxGain, 2)],
        ["− receive cable loss", sign(-input.rxLoss, 2)],
        ["= received power (dBm)", TB.fix(r.rxPowerDbm, 2)],
        ["− sensitivity (dBm)", TB.fix(input.rxSens, 2)],
        ["= link margin", sign(r.marginDb, 2)]
      ]);
    } catch (e) {
      last = null;
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) IDS.forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
