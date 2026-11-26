/* Ground Station Frequency Map: band names for a frequency, frequency parsing, and a short reference list of ground
   stations with the frequency bands their operators publicly say they use. No DOM.
   References:
   - Letter bands: IEEE Std 521-2019, "IEEE Standard Letter Designations for Radar-Frequency Bands": HF 3-30 MHz,
     VHF 30-300 MHz, UHF 300-1000 MHz, L 1-2 GHz, S 2-4 GHz, C 4-8 GHz, X 8-12 GHz, Ku 12-18 GHz, K 18-27 GHz,
     Ka 27-40 GHz, V 40-75 GHz, W 75-110 GHz, mm 110-300 GHz.
   - Band numbers: ITU Radio Regulations, Article 2 (No. 2.1), and Recommendation ITU-R V.431: band N runs from
     0.3 x 10^N Hz to 3 x 10^N Hz, lower limit excluded, upper limit included (VHF is band 8, 30-300 MHz; UHF band 9,
     300-3000 MHz; SHF band 10; EHF band 11).
   - The station bands are the ITU Radio Regulations Article 5 allocations that each kind of link uses (space
     operation, space research and Earth exploration-satellite, deep space, fixed-satellite), as listed in each
     entry. IEEE gives no rule for a frequency exactly on a boundary; this uses the ITU rule (lower excluded, upper
     included) for both systems. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).groundStationFrequency = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MHZ = 1e6, GHZ = 1e9;

  var IEEE = [
    { band: "HF", lo: 3 * MHZ, hi: 30 * MHZ },
    { band: "VHF", lo: 30 * MHZ, hi: 300 * MHZ },
    { band: "UHF", lo: 300 * MHZ, hi: 1 * GHZ },
    { band: "L", lo: 1 * GHZ, hi: 2 * GHZ },
    { band: "S", lo: 2 * GHZ, hi: 4 * GHZ },
    { band: "C", lo: 4 * GHZ, hi: 8 * GHZ },
    { band: "X", lo: 8 * GHZ, hi: 12 * GHZ },
    { band: "Ku", lo: 12 * GHZ, hi: 18 * GHZ },
    { band: "K", lo: 18 * GHZ, hi: 27 * GHZ },
    { band: "Ka", lo: 27 * GHZ, hi: 40 * GHZ },
    { band: "V", lo: 40 * GHZ, hi: 75 * GHZ },
    { band: "W", lo: 75 * GHZ, hi: 110 * GHZ },
    { band: "mm", lo: 110 * GHZ, hi: 300 * GHZ }
  ];
  var ITU = [
    { n: 4, name: "VLF", lo: 3e3, hi: 3e4 },
    { n: 5, name: "LF", lo: 3e4, hi: 3e5 },
    { n: 6, name: "MF", lo: 3e5, hi: 3e6 },
    { n: 7, name: "HF", lo: 3e6, hi: 3e7 },
    { n: 8, name: "VHF", lo: 3e7, hi: 3e8 },
    { n: 9, name: "UHF", lo: 3e8, hi: 3e9 },
    { n: 10, name: "SHF", lo: 3e9, hi: 3e10 },
    { n: 11, name: "EHF", lo: 3e10, hi: 3e11 },
    { n: 12, name: "THF", lo: 3e11, hi: 3e12 }
  ];

  function inBand(f, b) { return f > b.lo && f <= b.hi; }

  /** Band names for one frequency in Hz: {ieee, itu, ituNumber}; a field is null outside its table. */
  function classify(hz) {
    if (typeof hz !== "number" || !isFinite(hz) || hz <= 0) throw new Error("Frequency must be a positive number.");
    var ie = IEEE.filter(function (b) { return inBand(hz, b); })[0];
    var it = ITU.filter(function (b) { return inBand(hz, b); })[0];
    return { ieee: ie ? ie.band : null, itu: it ? it.name : null, ituNumber: it ? it.n : null };
  }

  /** IEEE letter bands that a range [lowHz, highHz] overlaps (a single frequency when they are equal). */
  function bandsOfRange(lowHz, highHz) {
    if (highHz === undefined || highHz === lowHz) {
      var c = classify(lowHz);
      return c.ieee ? [c.ieee] : [];
    }
    if (!(lowHz > 0) || !(highHz > lowHz) || !isFinite(highHz)) throw new Error("A range needs 0 < low < high.");
    return IEEE.filter(function (b) { return lowHz < b.hi && highHz > b.lo; }).map(function (b) { return b.band; });
  }

  var UNIT = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };
  /** "2.29 GHz", "2200-2290 MHz", "2,025 to 2,110 MHz", "8.4GHz" -> {lowHz, highHz}. A unit is required. */
  function parseFrequency(text) {
    var s = String(text || "").trim().replace(/,/g, "").replace(/[–—]/g, "-");
    var m = s.match(/^(\d+(?:\.\d+)?)\s*(?:(hz|khz|mhz|ghz)\s*)?(?:(?:-|to)\s*(\d+(?:\.\d+)?)\s*)?(hz|khz|mhz|ghz)$/i);
    if (!m) throw new Error("Write a frequency with its unit, such as 2.29 GHz or 2200-2290 MHz.");
    var u2 = UNIT[m[4].toLowerCase()];
    var u1 = m[2] ? UNIT[m[2].toLowerCase()] : u2;
    var lo = Number(m[1]) * u1;
    var hi = m[3] !== undefined ? Number(m[3]) * u2 : lo;
    if (m[2] && m[3] === undefined) throw new Error("Write a frequency with one unit, such as 2.29 GHz.");
    if (!(lo > 0)) throw new Error("Frequency must be greater than zero.");
    if (hi < lo) throw new Error("The top of the range is below the bottom.");
    return { lowHz: lo, highHz: hi };
  }

  /** One line of a user's station: "2200-2290 MHz down telemetry" -> {lowMHz, highMHz, dir, use, bands}. */
  function parseLink(line) {
    var s = String(line || "").trim();
    var m = s.match(/^(.*?(?:hz|khz|mhz|ghz))\b\s*(.*)$/i);
    if (!m) throw new Error("\"" + s.slice(0, 40) + "\": start with a frequency and its unit, such as 2200-2290 MHz.");
    var f = parseFrequency(m[1]);
    var rest = m[2].trim(), dir = "";
    var d = rest.match(/^(uplink|downlink|up|down|both)\b\s*(.*)$/i);
    if (d) {
      dir = /^up/i.test(d[1]) ? "up" : /^down/i.test(d[1]) ? "down" : "both";
      rest = d[2].trim();
    }
    return { lowMHz: f.lowHz / MHZ, highMHz: f.highHz / MHZ, dir: dir, use: rest.slice(0, 80),
      bands: bandsOfRange(f.lowHz, f.highHz) };
  }

  // Link bands shared by several stations (ITU Radio Regulations, Article 5, and the Space Frequency Coordination
  // Group's band plans). MHz; dir is the direction from the station: up = Earth to space, down = space to Earth.
  var S_UP = { lowMHz: 2025, highMHz: 2110, dir: "up", use: "Command (S-band, space operation and space research)" };
  var S_DOWN = { lowMHz: 2200, highMHz: 2290, dir: "down", use: "Telemetry and data (S-band, space operation and space research)" };
  var X_EESS = { lowMHz: 8025, highMHz: 8400, dir: "down", use: "Earth-observation data (X-band, Earth exploration-satellite)" };
  var DSN = [
    { lowMHz: 2110, highMHz: 2120, dir: "up", use: "Deep-space command (S-band)" },
    { lowMHz: 2290, highMHz: 2300, dir: "down", use: "Deep-space telemetry (S-band)" },
    { lowMHz: 7145, highMHz: 7190, dir: "up", use: "Deep-space command (called X-band in space use; 7.1-7.2 GHz is C on the IEEE scale)" },
    { lowMHz: 8400, highMHz: 8450, dir: "down", use: "Deep-space telemetry (X-band)" }
  ];

  // Positions are rounded to 0.01 degree (about 1 km): enough for a world map, not for pointing an antenna.
  var STATIONS = [
    { id: "dss14", name: "Goldstone, DSS-14 (70 m)", lat: 35.43, lon: -116.89, country: "United States",
      operator: "NASA Deep Space Network", kind: "Deep space", links: DSN },
    { id: "dss43", name: "Canberra, DSS-43 (70 m)", lat: -35.40, lon: 148.98, country: "Australia",
      operator: "NASA Deep Space Network (run by CSIRO)", kind: "Deep space", links: DSN },
    { id: "dss63", name: "Madrid, DSS-63 (70 m)", lat: 40.43, lon: -4.25, country: "Spain",
      operator: "NASA Deep Space Network (run by INTA)", kind: "Deep space", links: DSN },
    { id: "svalsat", name: "SvalSat, Svalbard", lat: 78.23, lon: 15.39, country: "Norway (Svalbard)",
      operator: "Kongsberg Satellite Services (KSAT)", kind: "Polar orbit support", links: [S_UP, S_DOWN, X_EESS] },
    { id: "mcmurdo", name: "McMurdo Ground Station", lat: -77.84, lon: 166.67, country: "Antarctica",
      operator: "NASA Near Space Network", kind: "Polar orbit support", links: [S_UP, S_DOWN, X_EESS] },
    { id: "esrange", name: "Esrange Satellite Station, Kiruna", lat: 67.88, lon: 21.07, country: "Sweden",
      operator: "Swedish Space Corporation (SSC)", kind: "Polar orbit support", links: [S_UP, S_DOWN, X_EESS] },
    { id: "wsc", name: "White Sands Complex", lat: 32.54, lon: -106.61, country: "United States",
      operator: "NASA Near Space Network (TDRS relay satellites)", kind: "Relay satellite ground terminal", links: [
        { lowMHz: 14600, highMHz: 15250, dir: "up", use: "Space-to-ground link to the TDRS satellites (Ku-band)" },
        { lowMHz: 13400, highMHz: 14050, dir: "down", use: "Space-to-ground link from the TDRS satellites (Ku-band)" }
      ] },
    { id: "wallops", name: "Wallops Ground Station", lat: 37.93, lon: -75.47, country: "United States",
      operator: "NASA Near Space Network", kind: "Near-Earth tracking", links: [S_UP, S_DOWN, X_EESS] },
    { id: "guam-afscn", name: "Guam Tracking Station", lat: 13.62, lon: 144.86, country: "United States (Guam)",
      operator: "U.S. Space Force, Satellite Control Network", kind: "Military satellite control", links: [
        { lowMHz: 1755, highMHz: 1850, dir: "up", use: "Command (SGLS, the Space-Ground Link Subsystem)" },
        { lowMHz: 2200, highMHz: 2300, dir: "down", use: "Telemetry (SGLS)" }
      ] },
    { id: "hbk", name: "Hartebeesthoek", lat: -25.89, lon: 27.71, country: "South Africa",
      operator: "South African National Space Agency (SANSA)", kind: "Near-Earth tracking", links: [S_UP, S_DOWN, X_EESS] },
    { id: "kourou", name: "Kourou station", lat: 5.25, lon: -52.80, country: "French Guiana (France)",
      operator: "European Space Agency (ESTRACK)", kind: "Near-Earth tracking", links: [S_UP, S_DOWN] },
    { id: "fucino", name: "Fucino Space Centre", lat: 41.98, lon: 13.60, country: "Italy",
      operator: "Telespazio", kind: "Commercial teleport", links: [
        { lowMHz: 14000, highMHz: 14500, dir: "up", use: "Satellite uplink (Ku-band, fixed-satellite service)" },
        { lowMHz: 10700, highMHz: 12750, dir: "down", use: "Satellite downlink (called Ku-band in satellite use; 10.7-12 GHz is X on the IEEE scale)" }
      ] }
  ];

  function withBands(st) {
    var links = st.links.map(function (l) {
      return { lowMHz: l.lowMHz, highMHz: l.highMHz, dir: l.dir, use: l.use, bands: bandsOfRange(l.lowMHz * MHZ, l.highMHz * MHZ) };
    });
    var bands = [];
    links.forEach(function (l) { l.bands.forEach(function (b) { if (bands.indexOf(b) < 0) bands.push(b); }); });
    bands.sort(function (a, b) { return order(a) - order(b); });
    return { id: st.id, name: st.name, lat: st.lat, lon: st.lon, country: st.country, operator: st.operator,
      kind: st.kind, custom: !!st.custom, links: links, bands: bands };
  }
  function order(b) { for (var i = 0; i < IEEE.length; i++) if (IEEE[i].band === b) return i; return 99; }

  /** The built-in list with each link's IEEE bands worked out. */
  function stations() { return STATIONS.map(withBands); }

  /** Checks a user's station: name, position and at least one link line. Returns it with bands worked out. */
  function makeStation(name, lat, lon, operator, linkText) {
    name = String(name || "").trim();
    if (!name) throw new Error("Give the station a name.");
    if (!isFinite(lat) || lat < -90 || lat > 90) throw new Error("Latitude must be between -90 and 90.");
    if (!isFinite(lon) || lon < -180 || lon > 180) throw new Error("Longitude must be between -180 and 180.");
    var lines = String(linkText || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) throw new Error("Add at least one frequency line.");
    var links = lines.map(parseLink);
    return withBands({ id: "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: name.slice(0, 80),
      lat: lat, lon: lon, country: "", operator: String(operator || "").trim().slice(0, 80) || "Not given",
      kind: "Added by you", custom: true, links: links });
  }

  /** Stations with a link in this IEEE band ("all" for every band) whose text matches the query. */
  function filter(list, band, query) {
    var q = String(query || "").trim().toLowerCase();
    return list.filter(function (s) {
      if (band && band !== "all" && s.bands.indexOf(band) < 0) return false;
      if (!q) return true;
      var hay = [s.name, s.country, s.operator, s.kind].concat(s.links.map(function (l) {
        return l.lowMHz + " " + l.highMHz + " " + l.use + " " + l.bands.join(" ");
      })).join(" ").toLowerCase();
      // a frequency in the query (e.g. "2250 MHz", "8.4 GHz") matches any link that contains it
      try {
        var f = parseFrequency(q);
        return s.links.some(function (l) { return f.lowHz <= l.highMHz * MHZ && f.highHz >= l.lowMHz * MHZ; });
      } catch (e) { return hay.indexOf(q) >= 0; }
    });
  }

  /** "2200-2290 MHz" or "8.42 GHz" for display. */
  function formatRange(lowMHz, highMHz) {
    var g = lowMHz >= 10000;
    var f = function (x) { return g ? String(Number((x / 1000).toFixed(3))) : String(Number(x.toFixed(3))); };
    return (lowMHz === highMHz ? f(lowMHz) : f(lowMHz) + "–" + f(highMHz)) + (g ? " GHz" : " MHz");
  }

  return { classify: classify, bandsOfRange: bandsOfRange, parseFrequency: parseFrequency, parseLink: parseLink,
    stations: stations, makeStation: makeStation, filter: filter, formatRange: formatRange,
    IEEE_BANDS: IEEE.map(function (b) { return b.band; }), IEEE: IEEE, ITU: ITU };
});
