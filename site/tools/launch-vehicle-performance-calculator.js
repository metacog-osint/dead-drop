/* Launch Vehicle Performance Calculator page. The maths is in ../lib/launch-vehicle-performance.js (tested in
   tests/launch-vehicle-performance.test.js). */
(function () {
  "use strict";
  var KEY = "launch-vehicle-performance";
  var FIELDS = ["vehicle", "p0", "refAlt", "lat", "refInc", "dry", "isp", "type", "alt", "inc"];
  var LVP = null, last = null;

  function fmtKg(x) { return isFinite(x) ? Math.round(x).toLocaleString("en-US") : "–"; }

  function target() {
    var type = TB.$("type").value;
    if (type === "circular") return { type: type, altKm: TB.num("alt"), incDeg: TB.num("inc") };
    if (type === "sso") return { type: type, altKm: TB.num("alt") };
    return { type: type };
  }

  function showTargetFields() {
    var type = TB.$("type").value;
    TB.$("circ-fields").hidden = !(type === "circular" || type === "sso");
    TB.$("inc-field").hidden = type !== "circular";
  }

  function fillVehicle() {
    var id = TB.$("vehicle").value;
    var v = LVP.VEHICLES.filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    TB.$("p0").value = v.leoKg;
    TB.$("lat").value = v.siteLatDeg;
    TB.$("refInc").value = v.siteLatDeg;
    TB.$("refAlt").value = 200;
    TB.$("dry").value = v.dryKg;
    TB.$("isp").value = v.ispS;
  }

  function compare(t) {
    var rows = LVP.VEHICLES.map(function (v) {
      var base = { p0Kg: v.leoKg, refAltKm: 200, refIncDeg: v.siteLatDeg, siteLatDeg: v.siteLatDeg, dryKg: v.dryKg, ispS: v.ispS };
      var here, gto;
      try { here = LVP.estimate(Object.assign({}, base, { target: t })); } catch (e) { here = null; }
      try { gto = LVP.estimate(Object.assign({}, base, { target: { type: "gto" } })); } catch (e) { gto = null; }
      return [v.name, v.status, fmtKg(v.leoKg), fmtKg(v.gtoKg), gto ? fmtKg(gto.payloadKg) : "–",
        here ? (here.reachable ? fmtKg(here.payloadKg) : "not reachable") : "–"];
    });
    TB.table("compare", ["Vehicle", "Status", "Maker, LEO (kg)", "Maker, GTO (kg)", "Model, GTO (kg)", "Model, this target (kg)"], rows);
  }

  function run() {
    TB.message("msg", "");
    var input = {};
    FIELDS.forEach(function (k) { input[k] = TB.$(k).value; });
    try {
      var t = target();
      var opts = { p0Kg: TB.num("p0"), refAltKm: TB.num("refAlt"), refIncDeg: TB.num("refInc"), siteLatDeg: TB.num("lat"),
        dryKg: TB.num("dry"), ispS: TB.num("isp"), target: t };
      var r = LVP.estimate(opts);
      TB.save(KEY, input);
      last = { input: opts, result: r };
      TB.results("results", [
        { k: "Payload estimate (rule of thumb)", v: r.reachable ? fmtKg(r.payloadKg) : "Not reachable", u: r.reachable ? "kg" : "",
          cls: r.reachable ? "ok" : "alarm", title: "Rocket equation on the upper stage; see the method notes" },
        { k: "Share of the reference payload", v: TB.fix(r.ratio * 100, 1), u: "%" },
        { k: "Extra delta-v over the reference", v: TB.fix(r.dvExtraKms * 1000, 0), u: "m/s" },
        { k: "Target inclination", v: TB.fix(r.targetIncDeg, 2), u: "°" },
        { k: "Launch inclination", v: TB.fix(r.launchIncDeg, 2), u: "°" },
        { k: "Upper stage exhaust speed", v: TB.fix(r.exhaustVelocityKms * 1000, 0), u: "m/s", title: "g0 × Isp" },
        { k: "Reference orbit, speed to add (ideal)", v: TB.fix(r.refGroundSpeedKms * 1000, 0), u: "m/s",
          title: "Relative to the ground, before gravity, drag and steering losses" }
      ]);
      TB.table("parts", ["Step", "Delta-v (m/s)"], r.parts.map(function (p) { return [p.what, TB.fix(p.dvKms * 1000, 1)]; })
        .concat([["Total extra", TB.fix(r.dvExtraKms * 1000, 1)]]));
      compare(t);
    } catch (e) {
      last = null;
      TB.message("msg", e.message, "error");
    }
  }

  TB.ready(function () {
    LVP = DD.launchVehiclePerformance;
    var sel = TB.$("vehicle");
    LVP.VEHICLES.forEach(function (v) { sel.appendChild(TB.el("option", { value: v.id, text: v.name + " · " + v.status })); });
    sel.appendChild(TB.el("option", { value: "custom", text: "Your own figures" }));
    var saved = TB.load(KEY);
    if (saved) FIELDS.forEach(function (k) { if (typeof saved[k] === "string" && saved[k] !== "") TB.$(k).value = saved[k]; });
    else fillVehicle();
    showTargetFields();
    sel.addEventListener("change", function () { fillVehicle(); run(); });
    TB.$("type").addEventListener("change", function () { showTargetFields(); run(); });
    TB.$("lat").addEventListener("change", function () { TB.$("refInc").value = Math.abs(TB.num("lat")) || 0; });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Estimate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
