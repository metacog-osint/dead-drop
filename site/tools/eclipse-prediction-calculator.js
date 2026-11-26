/* Eclipse Prediction Calculator page. The maths is in ../lib/eclipse-prediction.js
   (tested in tests/eclipse-prediction.test.js). */
(function () {
  "use strict";
  var KEY = "eclipse-prediction";
  var FIELDS = ["altitude", "mode", "beta", "inclination", "raan", "when"];
  var last = null;

  function nowUtcInput() {
    return new Date().toISOString().slice(0, 16);   // "YYYY-MM-DDTHH:MM", read as UTC
  }
  function showMode() {
    var orbit = TB.$("mode").value === "orbit";
    TB.$("f-orbit").hidden = !orbit;
    TB.$("f-beta").hidden = orbit;
  }
  function run() {
    TB.message("msg", "");
    var E = DD.eclipsePrediction;
    var input = { altitude: TB.num("altitude"), mode: TB.$("mode").value };
    try {
      var beta, betaNote = null;
      if (input.mode === "orbit") {
        input.inclination = TB.num("inclination");
        input.raan = TB.num("raan");
        input.whenUtc = TB.$("when").value;
        var s = input.whenUtc || "";
        var d = new Date(s.length === 16 ? s + ":00Z" : s + "Z");
        beta = E.betaAngle(input.inclination, input.raan, d);
        var sun = E.sunEcliptic(d);
        betaNote = { k: "Sun's ecliptic longitude", v: TB.fix(sun.longitudeDeg, 2), u: "°",
          title: "For " + TB.time(d, { year: true }) };
      } else {
        input.beta = TB.num("beta");
        beta = input.beta;
      }
      var r = E.compute(input.altitude, beta);
      var rows = E.table(input.altitude, 10);
      last = { input: input, betaDeg: beta, result: r, betaTable: rows };
      TB.save(KEY, {
        altitude: input.altitude, mode: input.mode, beta: TB.$("beta").value, inclination: TB.$("inclination").value,
        raan: TB.$("raan").value, when: TB.$("when").value
      });
      var items = [
        { k: "Eclipse each orbit", v: r.hasEclipse ? "Yes" : "No, sunlit all the way round", cls: r.hasEclipse ? "warn" : "ok" },
        { k: "Beta angle used", v: TB.fix(beta, 2), u: "°" },
        { k: "Time in shadow per orbit", v: TB.fix(r.eclipseMin, 2), u: "min" },
        { k: "Time in sunlight per orbit", v: TB.fix(r.sunlitMin, 2), u: "min" },
        { k: "Share of the orbit in shadow", v: TB.fix(r.eclipseFraction * 100, 1), u: "%" },
        { k: "Orbital period", v: TB.fix(r.periodMin, 2), u: "min" },
        { k: "Critical beta angle (no eclipse beyond)", v: "±" + TB.fix(r.criticalBetaDeg, 2), u: "°" },
        { k: "Longest eclipse at this altitude (beta 0)", v: TB.fix(r.maxEclipseMin, 2), u: "min" }
      ];
      if (betaNote) items.splice(2, 0, betaNote);
      TB.results("results", items);
      TB.table("table", ["Beta angle (°)", "Shadow per orbit (min)", "Share of orbit (%)"], rows.map(function (x) {
        return [TB.fix(x.betaDeg, x.betaDeg % 1 ? 2 : 0), TB.fix(x.eclipseMin, 2), TB.fix(x.eclipseFraction * 100, 1)];
      }));
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) {
      FIELDS.forEach(function (k) {
        if (saved[k] === undefined || saved[k] === null || saved[k] === "") return;
        if (k === "mode" && saved[k] !== "direct" && saved[k] !== "orbit") return;
        TB.$(k).value = saved[k];
      });
    }
    if (!TB.$("when").value) TB.$("when").value = nowUtcInput();
    showMode();
    TB.$("mode").addEventListener("change", showMode);
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
