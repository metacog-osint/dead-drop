/* Multi-Time-Zone Converter page. The maths is in ../lib/timezone.js (tested in tests/timezone.test.js). */
(function () {
  "use strict";
  var KEY = "timezone-converter";
  var tz = DD.timezone;
  var last = null;
  var showAll = { sites: false, zones: false };

  function zoneList() {
    var suite = (window.TicTime && TicTime.zones) || tz.SUITE_ZONES;
    var seen = {}, out = [];
    suite.concat(tz.EXTRA_ZONES).forEach(function (z) { if (!seen[z[0]]) { seen[z[0]] = 1; out.push(z); } });
    return out;
  }
  function fillZones(sel) {
    zoneList().forEach(function (z) {
      sel.appendChild(TB.el("option", { value: z[0], text: z[1] + (z[0] === "UTC" ? "" : " (" + z[0] + ")") }));
    });
    sel.appendChild(TB.el("option", { value: "other", text: "Other IANA zone…" }));
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
  function nowIn(zone) {
    var w = tz.wallTime(zone, Date.now());
    return tz.wallString(w).replace(" ", "T");
  }
  function dayText(n) { return n === 0 ? "same day" : (n > 0 ? "+" : "") + n + (Math.abs(n) === 1 ? " day" : " days"); }

  function rowsFor(list) {
    return list.map(function (d) {
      return [d.label, d.date, d.time + " " + d.abbr, d.zone, d.offset + (d.dst ? " (DST)" : ""), dayText(d.dayOffset)];
    });
  }
  function draw(id, rows) {
    TB.table(id, ["Place", "Local date", "Local time", "IANA zone", "Offset", "Date vs. input"], rows);
    var btn = TB.$(id + "All");
    btn.hidden = rows.length <= 10;
    btn.textContent = showAll[id] ? "Show fewer" : "Show all " + rows.length;
    TB.$(id).className = showAll[id] ? "" : "scroll";
  }

  function run() {
    TB.message("msg", "");
    TB.message("note", "");
    var input = { when: TB.$("when").value, zone: chosenZone() };
    try {
      if (!tz.validZone(input.zone)) throw new Error("Not a time zone name this browser knows: " + (input.zone || "(empty)"));
      var sites = tz.convert(input.when, input.zone, tz.SITES);
      var zones = tz.convert(input.when, input.zone, zoneList().map(function (z) { return { zone: z[0], label: z[1] }; }));
      last = { input: input, utc: sites.utc, status: sites.status, note: sites.note,
        alternativeUtc: sites.alternativeUtc, sites: sites.rows, zones: zones.rows };
      TB.save(KEY, input);
      var items = [
        { k: "UTC", v: sites.utc.replace("T", " ").replace("Z", " Z") },
        { k: "Input zone at that moment", v: sites.source.abbr + " (" + sites.source.offset + ")" },
        { k: "In your time setting", v: TB.time(sites.utcMs, { year: true, seconds: true }) },
        { k: "Unix time", v: String(Math.floor(sites.utcMs / 1000)), u: "s" }
      ];
      if (sites.status !== "ok") items.push({ k: "Input time", v: sites.status === "skipped" ? "Skipped by a clock change" : "Repeated by a clock change", cls: "warn" });
      var next = tz.nextTransition(input.zone, sites.utcMs);
      items.push({ k: "Next clock change in input zone", v: next ? TB.time(next.atMs, { year: true }) + ", " +
        tz.offsetLabel(next.fromMinutes) + " to " + tz.offsetLabel(next.toMinutes) : "None within 400 days" });
      TB.results("results", items);
      if (sites.note) TB.message("note", sites.note, "info");
      draw("sites", rowsFor(sites.rows.map(function (d) {
        if (d.note) d.label = d.label + " (" + d.note + ")";
        return d;
      })));
      draw("zones", rowsFor(zones.rows));
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }

  TB.ready(function () {
    fillZones(TB.$("zone"));
    var saved = TB.load(KEY);
    if (saved && saved.zone && tz.validZone(saved.zone)) setZone(saved.zone); else setZone("UTC");
    TB.$("when").value = saved && saved.when ? saved.when : nowIn(chosenZone());
    TB.$("zone").addEventListener("change", function () { TB.$("otherRow").hidden = TB.$("zone").value !== "other"; });
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("now").addEventListener("click", function () {
      var z = chosenZone();
      if (!tz.validZone(z)) return TB.message("msg", "Pick a time zone first.", "error");
      TB.$("when").value = nowIn(z);
      run();
    });
    ["sites", "zones"].forEach(function (id) {
      TB.$(id + "All").addEventListener("click", function () { showAll[id] = !showAll[id]; run(); });
    });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Convert first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    if (window.TicTime && TicTime.onChange) TicTime.onChange(function () { if (last) run(); });
    run();
  });
})();
