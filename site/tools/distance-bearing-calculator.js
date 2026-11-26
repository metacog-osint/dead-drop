/* Distance and Bearing Calculator page. The maths is in ../lib/distance-bearing.js
   (tested in tests/distance-bearing.test.js). */
(function () {
  "use strict";
  var KEY = "distance-bearing";
  var last = null;
  // Approximate launch-site positions (decimal degrees), good to a few kilometres.
  var PLACES = [
    ["Kennedy Space Center LC-39A, United States", 28.6084, -80.6043],
    ["Vandenberg SFB SLC-4E, United States", 34.6321, -120.6107],
    ["Guiana Space Centre, Kourou, French Guiana", 5.2394, -52.7681],
    ["Baikonur Cosmodrome, Kazakhstan", 45.9658, 63.3050],
    ["Plesetsk Cosmodrome, Russia", 62.9256, 40.5778],
    ["Vostochny Cosmodrome, Russia", 51.8840, 128.3340],
    ["Jiuquan Satellite Launch Center, China", 40.9603, 100.2992],
    ["Taiyuan Satellite Launch Center, China", 38.8490, 111.6080],
    ["Wenchang Space Launch Site, China", 19.6144, 110.9509],
    ["Satish Dhawan Space Centre, India", 13.7199, 80.2304],
    ["Tanegashima Space Center, Japan", 30.3964, 130.9681],
    ["Naro Space Center, South Korea", 34.4320, 127.5355]
  ];
  var IDS = ["latA", "lonA", "latB", "lonB"];

  function fillPlaces(selId, latId, lonId) {
    var sel = TB.$(selId);
    sel.appendChild(TB.el("option", { value: "", text: "Choose a place, or type coordinates below" }));
    PLACES.forEach(function (p, i) { sel.appendChild(TB.el("option", { value: String(i), text: p[0] })); });
    sel.addEventListener("change", function () {
      if (sel.value === "") return;
      var p = PLACES[Number(sel.value)];
      TB.$(latId).value = p[1];
      TB.$(lonId).value = p[2];
      run();
    });
  }
  function ll(p) {
    return TB.fix(Math.abs(p.lat), 4) + "° " + (p.lat < 0 ? "S" : "N") + ", " +
      TB.fix(Math.abs(p.lon), 4) + "° " + (p.lon < 0 ? "W" : "E");
  }
  function run() {
    TB.message("msg", "");
    var input = {};
    IDS.forEach(function (k) { input[k] = TB.num(k); });
    try {
      var r = DD.distanceBearing.compute(input.latA, input.lonA, input.latB, input.lonB);
      last = { input: input, result: r };
      TB.save(KEY, input);
      var items = [
        { k: "Great-circle distance", v: TB.fix(r.distanceKm, 2), u: "km" },
        { k: "Distance", v: TB.fix(r.distanceNm, 2), u: "NM", title: "Nautical miles (1 NM = 1.852 km)" },
        { k: "Distance", v: TB.fix(r.distanceMi, 2), u: "mi", title: "Statute miles (1 mi = 1.609344 km)" }
      ];
      if (r.initialBearing !== null) {
        items.push({ k: "Initial bearing, A to B", v: TB.fix(r.initialBearing, 2), u: "° true (" + r.initialCardinal + ")" });
        items.push({ k: "Final bearing, arriving at B", v: TB.fix(r.finalBearing, 2), u: "° true (" + r.finalCardinal + ")" });
      }
      if (r.midpoint) items.push({ k: "Midpoint along the path", v: ll(r.midpoint) });
      items.push({ k: "Angle at the Earth's centre", v: TB.fix(r.centralAngleDeg, 4), u: "°" });
      TB.results("results", items);
      var note = TB.$("note");
      note.textContent = r.note || "";
      note.hidden = !r.note;
    } catch (e) {
      TB.message("msg", e.message, "error");
    }
  }
  TB.ready(function () {
    var saved = TB.load(KEY);
    if (saved) IDS.forEach(function (k) { if (isFinite(saved[k]) && saved[k] !== null) TB.$(k).value = saved[k]; });
    fillPlaces("placeA", "latA", "lonA");
    fillPlaces("placeB", "latB", "lonB");
    TB.$("form").addEventListener("submit", function (ev) { ev.preventDefault(); run(); });
    TB.$("swap").addEventListener("click", function () {
      var a = [TB.$("latA").value, TB.$("lonA").value];
      TB.$("latA").value = TB.$("latB").value; TB.$("lonA").value = TB.$("lonB").value;
      TB.$("latB").value = a[0]; TB.$("lonB").value = a[1];
      TB.$("placeA").value = ""; TB.$("placeB").value = "";
      run();
    });
    TB.$("copy").addEventListener("click", function () {
      if (!last) return TB.message("msg", "Calculate first.", "info");
      TB.copyJSON(last).then(function () { TB.message("msg", "Copied.", "info"); },
        function () { TB.message("msg", "This browser would not let the page use the clipboard.", "error"); });
    });
    run();
  });
})();
