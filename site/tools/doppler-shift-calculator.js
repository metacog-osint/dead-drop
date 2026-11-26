/* Doppler Shift Calculator page. The maths is in ../lib/doppler-shift.js (tested in tests/doppler-shift.test.js). */
(function () {
  "use strict";
  var KEY = "doppler-shift";
  var IDS = ["freq", "speed", "angle", "altitude", "elevation", "latitude"];
  var last = null;
  function hz(x) { return (x > 0 ? "+" : "") + TB.fix(x, Math.abs(x) < 100 ? 2 : 1); }
  function optional(v) { return isFinite(v) ? v : null; }
  function run() {
    TB.message("msg", "");
    var input = {};
    IDS.forEach(function (k) { input[k] = TB.num(k); });
    try {
      var r = DD.dopplerShift.compute(input.freq, input.speed, input.angle);
      var o = null;
      if (isFinite(input.altitude)) {
        o = DD.dopplerShift.circular(input.freq, input.altitude, optional(input.elevation), optional(input.latitude));
      }
      last = { input: input, knownMotion: r, circularOrbit: o };
      TB.save(KEY, input);
      TB.results("results", [
        { k: "Doppler shift", v: hz(r.shiftHz), u: "Hz" },
        { k: "Doppler shift", v: (r.shiftHz > 0 ? "+" : "") + TB.fix(r.shiftHz / 1000, 3), u: "kHz" },
        { k: "Received frequency", v: TB.fix(r.receivedMHz, 6), u: "MHz" },
        { k: "Range rate", v: TB.fix(r.rangeRateKmS, 3), u: "km/s", title: "Positive when the distance grows" },
        { k: "Shift if all the speed were along the line of sight", v: "±" + TB.fix(r.fullSpeedShiftHz, 1), u: "Hz" }
      ]);
      var orbit = TB.$("orbit");
      if (!o) {
        TB.clear(orbit);
        orbit.appendChild(TB.el("p", { class: "empty", text: "Enter an orbit altitude to see these figures." }));
      } else {
        var items = [
          { k: "Orbital speed", v: TB.fix(o.orbitalSpeedKmS, 3), u: "km/s" },
          { k: "Orbital period", v: TB.fix(o.periodMin, 1), u: "min" },
          { k: "Largest line-of-sight speed, overhead pass", v: TB.fix(o.losMaxKmS, 3), u: "km/s",
            title: "At the horizon, non-rotating Earth" },
          { k: "Largest shift, overhead pass", v: "±" + TB.fix(o.losMaxShiftHz, 1), u: "Hz" }
        ];
        if (o.losAtElevationKmS !== undefined) {
          items.push({ k: "Line-of-sight speed at " + TB.fix(input.elevation, 1) + "° elevation", v: TB.fix(o.losAtElevationKmS, 3), u: "km/s" });
          items.push({ k: "Shift at " + TB.fix(input.elevation, 1) + "° elevation", v: "±" + TB.fix(o.shiftAtElevationHz, 1), u: "Hz",
            title: "Positive while the satellite rises, negative while it sets" });
        }
        items.push({ k: "Upper bound on the shift, any pass", v: "±" + TB.fix(o.boundShiftHz, 1), u: "Hz",
          title: "Includes your speed from the Earth's rotation at the latitude entered", cls: "ok" });
        TB.results(orbit, items);
        if (input.altitude > 20000) {
          TB.message("msg", "At this altitude the overhead-pass figures do not describe a real pass: the Earth's rotation dominates. Use the bound only.", "info");
        }
      }
    } catch (e) {
      last = null;
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) IDS.forEach(function (k) {
      if (isFinite(saved[k])) TB.$(k).value = saved[k];
      else if (saved[k] === null) TB.$(k).value = "";
    });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
