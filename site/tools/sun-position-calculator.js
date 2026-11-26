/* Sun Position Calculator page. The maths is in ../lib/sun-position.js (tested in tests/sun-position.test.js);
   the input time's zone is read with ../lib/timezone.js (tests/timezone.test.js). */
(function () {
  "use strict";
  var KEY = "sun-position";
  var tz = DD.timezone, S = DD.sunPosition;
  var last = null, showAll = false;
  var SITES = [
    ["Kennedy Space Center, Florida", 28.5721, -80.6490], ["Vandenberg SFB, California", 34.6321, -120.6278],
    ["Baikonur, Kazakhstan", 45.9658, 63.3050], ["Jiuquan, China", 40.9603, 100.2992],
    ["Wenchang, China", 19.6144, 110.9509], ["Satish Dhawan, India", 13.7199, 80.2304],
    ["Kourou, French Guiana", 5.2360, -52.7686]
  ];

  function zoneList() {
    var suite = (window.TicTime && TicTime.zones) || tz.SUITE_ZONES;
    var seen = {}, out = [];
    suite.concat(tz.EXTRA_ZONES).forEach(function (z) { if (!seen[z[0]]) { seen[z[0]] = 1; out.push(z); } });
    return out;
  }
  function chosenZone() {
    var v = TB.$("zone").value;
    return v === "other" ? TB.$("other").value.trim() : v;
  }
  function setZone(z) {
    var known = zoneList().some(function (x) { return x[0] === z; });
    TB.$("zone").value = known ? z : "other";
    TB.$("other").value = known ? "" : z;
    TB.$("otherRow").hidden = known;
  }
  function nowIn(zone) { return tz.wallString(tz.wallTime(zone, Date.now())).replace(" ", "T"); }
  function inZone(zone, ms) { var d = tz.describe(zone, ms); return d.date + " " + d.time.slice(0, 5) + " " + d.abbr; }
  function deg(x, n) { return TB.fix(x, n) + "°"; }

  function render() {
    var L = last, p = L.position, ev = L.events, zone = L.input.zone, lat = L.input.lat, lon = L.input.lon;
    TB.$("moment").textContent = "Moment: " + tz.isoZ(L.utcMs) + " (" + inZone(zone, L.utcMs) + ")" +
      (L.zoneNote ? ". " + L.zoneNote : "");
    var phaseText = { "day": "Day: the Sun is up", "civil twilight": "Civil twilight", "nautical twilight": "Nautical twilight",
      "astronomical twilight": "Astronomical twilight", "night": "Night: full darkness" }[p.phase];
    TB.results("results", [
      { k: "Elevation (with refraction)", v: deg(p.elevation, 2), cls: p.elevation > 0 ? "ok" : null },
      { k: "Azimuth from true north", v: deg(p.azimuth, 2) + " " + S.compass(p.azimuth) },
      { k: "Sky", v: phaseText },
      { k: "Geometric elevation", v: deg(p.geometricElevation, 2), title: "Without the atmosphere's bending of light" },
      { k: "Refraction", v: TB.fix(p.refraction * 60, 1), u: "arcmin" },
      { k: "Shadow length per metre of height", v: p.elevation > 0 ? TB.fix(1 / Math.tan(p.elevation * Math.PI / 180), 2) : "–", u: p.elevation > 0 ? "m" : "",
        title: "On level ground, for a vertical object; pointing away from the Sun" },
      { k: "Declination", v: deg(p.declination, 3) },
      { k: "Equation of time", v: TB.fix(p.eqTimeMin, 2), u: "min", title: "Sundial time minus mean clock time" },
      { k: "Sun overhead at", v: TB.fix(p.subsolarLat, 2) + "°, " + TB.fix(p.subsolarLon, 2) + "°", title: "The subsolar point, latitude and longitude" },
      { k: "Distance to the Sun", v: TB.fix(p.distanceKm / 1e6, 3), u: "million km" }
    ]);
    var rows = [];
    function add(name, ms, never) {
      if (ms === null || ms === undefined) {
        rows.push([name, never === "above" ? "Does not happen: the Sun stays above this level all day" :
          "Does not happen: the Sun stays below this level all day", "", ""]);
        return;
      }
      rows.push([name, TB.time(ms, { year: true }), inZone(zone, ms), deg(S.position(ms, lat, lon).azimuth, 1)]);
    }
    add("Astronomical dawn (Sun 18° below)", ev.astronomical.start, ev.astronomical.never);
    add("Nautical dawn (12° below)", ev.nautical.start, ev.nautical.never);
    add("Civil dawn (6° below)", ev.civil.start, ev.civil.never);
    add("Sunrise", ev.sunrise.start, ev.sunrise.never);
    rows.push(["Solar noon, Sun at " + deg(ev.noonElevation, 1) + " elevation", TB.time(ev.solarNoon, { year: true }),
      inZone(zone, ev.solarNoon), deg(ev.noonAzimuth, 1)]);
    add("Sunset", ev.sunrise.end, ev.sunrise.never);
    add("Civil dusk", ev.civil.end, ev.civil.never);
    add("Nautical dusk", ev.nautical.end, ev.nautical.never);
    add("Astronomical dusk", ev.astronomical.end, ev.astronomical.never);
    rows.push(["Day length (sunrise to sunset)", S.hoursMinutes(ev.dayLengthMin), "", ""]);
    TB.table("events", ["Event", "Time (your setting)", "Time in " + zone, "Azimuth"], rows);
    var tr = S.track(L.utcMs, lat, lon, 60).map(function (r) {
      return [TB.time(r.ms, { year: true }), inZone(zone, r.ms), deg(r.elevation, 1), deg(r.azimuth, 1) + " " + S.compass(r.azimuth), r.phase];
    });
    TB.table("track", ["Time (your setting)", "Time in " + zone, "Elevation", "Azimuth", "Sky"], tr);
    var btn = TB.$("showall");
    btn.hidden = tr.length <= 10;
    btn.textContent = showAll ? "Show fewer" : "Show all " + tr.length;
    TB.$("track").className = showAll ? "" : "scroll";
  }

  function run() {
    TB.message("msg", "");
    var input = { lat: TB.num("lat"), lon: TB.num("lon"), when: TB.$("when").value, zone: chosenZone() };
    try {
      if (!tz.validZone(input.zone)) throw new Error("Not a time zone name this browser knows: " + (input.zone || "(empty)"));
      var v = tz.parseLocal(input.when);
      var r = tz.localToUtc(input.zone, v.y, v.mo, v.d, v.h, v.mi, v.s);
      var position = S.position(r.utcMs, input.lat, input.lon);
      var events = S.events(r.utcMs, input.lat, input.lon);
      last = { input: input, utcMs: r.utcMs, utc: tz.isoZ(r.utcMs), zoneNote: r.note, position: position, events: events };
      TB.save(KEY, input);
      render();
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }

  TB.ready(function () {
    var sel = TB.$("zone");
    zoneList().forEach(function (z) {
      sel.appendChild(TB.el("option", { value: z[0], text: z[1] + (z[0] === "UTC" ? "" : " (" + z[0] + ")") }));
    });
    sel.appendChild(TB.el("option", { value: "other", text: "Other IANA zone…" }));
    SITES.forEach(function (s) {
      var b = TB.el("button", { type: "button", text: s[0] });
      b.addEventListener("click", function () { TB.$("lat").value = s[1]; TB.$("lon").value = s[2]; run(); });
      TB.$("sites").appendChild(b);
    });
    var saved = TB.load(KEY);
    if (saved) {
      ["lat", "lon"].forEach(function (k) { if (isFinite(saved[k])) TB.$(k).value = saved[k]; });
    }
    setZone(saved && saved.zone && tz.validZone(saved.zone) ? saved.zone : "UTC");
    TB.$("when").value = saved && saved.when ? saved.when : nowIn(chosenZone());
    sel.addEventListener("change", function () { TB.$("otherRow").hidden = sel.value !== "other"; });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("now").addEventListener("click", function () {
      var z = chosenZone();
      if (!tz.validZone(z)) return TB.message("msg", "Pick a time zone first.", "error");
      TB.$("when").value = nowIn(z);
      run();
    });
    TB.$("showall").addEventListener("click", function () { showAll = !showAll; if (last) render(); });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && TicTime.onChange) TicTime.onChange(function () { if (last) render(); });
    run();
  });
})();
