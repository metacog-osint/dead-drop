// Ground Station Frequency Map. References: IEEE Std 521-2019 letter bands (VHF 30-300 MHz, UHF 300-1000 MHz,
// L 1-2 GHz, S 2-4, C 4-8, X 8-12, Ku 12-18, K 18-27, Ka 27-40 GHz); ITU Radio Regulations Art. 2 (No. 2.1) and
// ITU-R V.431: band N is 0.3 x 10^N to 3 x 10^N Hz, lower limit excluded, upper included (VHF 8, UHF 9, SHF 10,
// EHF 11). Station links: ITU RR Art. 5 allocations, e.g. deep space 2110-2120 / 2290-2300 MHz and
// 7145-7190 / 8400-8450 MHz; space operation and research 2025-2110 (up) and 2200-2290 MHz (down); Earth
// exploration-satellite 8025-8400 MHz (down).
// Worked examples read off those tables by hand:
//   137.5 MHz: IEEE VHF (30-300 MHz); ITU band 8 VHF.
//   401 MHz: IEEE UHF (300-1000 MHz); ITU band 9 UHF.
//   1.5 GHz: IEEE L (1-2 GHz) but ITU band 9 UHF (300-3000 MHz). The two systems overlap, which is why a filter
//     that offers "UHF (300-3000 MHz)" beside "L (1-2 GHz)" puts one signal in two bands.
//   2.29 GHz: IEEE S; ITU band 9 UHF.  8.425 GHz: IEEE X; ITU band 10 SHF.  13.775 GHz: IEEE Ku; SHF.
//   32 GHz: IEEE Ka; ITU band 11 EHF.
//   Boundaries (upper limit included): 300 MHz is VHF in both; 3 GHz is ITU band 9 and IEEE S; 2 GHz is IEEE L;
//   30 GHz is ITU band 10 SHF and IEEE Ka.
//   The satellite TV downlink 10.7-12.75 GHz overlaps IEEE X (to 12 GHz) and Ku (from 12 GHz).
//   The deep-space "X-band" uplink 7145-7190 MHz is IEEE C (4-8 GHz).
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../site/lib/ground-station-frequency.js");

test("ground stations: IEEE and ITU band of a frequency", () => {
  assert.deepEqual(G.classify(137.5e6), { ieee: "VHF", itu: "VHF", ituNumber: 8 });
  assert.deepEqual(G.classify(401e6), { ieee: "UHF", itu: "UHF", ituNumber: 9 });
  assert.deepEqual(G.classify(1.5e9), { ieee: "L", itu: "UHF", ituNumber: 9 });
  assert.deepEqual(G.classify(2.29e9), { ieee: "S", itu: "UHF", ituNumber: 9 });
  assert.deepEqual(G.classify(8.425e9), { ieee: "X", itu: "SHF", ituNumber: 10 });
  assert.equal(G.classify(13.775e9).ieee, "Ku");
  assert.deepEqual(G.classify(32e9), { ieee: "Ka", itu: "EHF", ituNumber: 11 });
  assert.equal(G.classify(5.7e9).ieee, "C");
  assert.equal(G.classify(20e9).ieee, "K");
  assert.equal(G.classify(10e6).ieee, "HF");
});

test("ground stations: band edges follow the ITU rule, lower excluded and upper included", () => {
  assert.deepEqual(G.classify(300e6), { ieee: "VHF", itu: "VHF", ituNumber: 8 });
  assert.equal(G.classify(300.001e6).ieee, "UHF");
  assert.deepEqual(G.classify(3e9), { ieee: "S", itu: "UHF", ituNumber: 9 });
  assert.equal(G.classify(3.000001e9).itu, "SHF");
  assert.equal(G.classify(2e9).ieee, "L");
  assert.equal(G.classify(30e9).itu, "SHF");
  assert.equal(G.classify(30e9).ieee, "Ka");
  assert.equal(G.classify(2e3).itu, null, "below VLF");
  assert.equal(G.classify(1e6).ieee, null, "below the IEEE table");
});

test("ground stations: bands a range overlaps", () => {
  assert.deepEqual(G.bandsOfRange(10.7e9, 12.75e9), ["X", "Ku"]);
  assert.deepEqual(G.bandsOfRange(12e9, 12.5e9), ["Ku"], "a range starting on the edge is not in the band below");
  assert.deepEqual(G.bandsOfRange(1755e6, 1850e6), ["L"]);
  assert.deepEqual(G.bandsOfRange(2025e6, 2110e6), ["S"]);
  assert.deepEqual(G.bandsOfRange(8.4e9), ["X"]);
  assert.throws(() => G.bandsOfRange(2e9, 1e9));
});

test("ground stations: parsing frequencies and link lines", () => {
  assert.deepEqual(G.parseFrequency("2.29 GHz"), { lowHz: 2.29e9, highHz: 2.29e9 });
  assert.deepEqual(G.parseFrequency("2200-2290 MHz"), { lowHz: 2200e6, highHz: 2290e6 });
  assert.deepEqual(G.parseFrequency("2,025 to 2,110 MHz"), { lowHz: 2025e6, highHz: 2110e6 });
  assert.deepEqual(G.parseFrequency("8.4GHz"), { lowHz: 8.4e9, highHz: 8.4e9 });
  assert.deepEqual(G.parseFrequency("137 kHz"), { lowHz: 137e3, highHz: 137e3 });
  assert.deepEqual(G.parseFrequency("900 MHz – 1.2 GHz"), { lowHz: 900e6, highHz: 1.2e9 });
  assert.throws(() => G.parseFrequency("2290"), /unit/);
  assert.throws(() => G.parseFrequency("abc MHz"));
  assert.throws(() => G.parseFrequency("2300-2200 MHz"));
  const l = G.parseLink("2200-2290 MHz downlink telemetry");
  assert.deepEqual(l, { lowMHz: 2200, highMHz: 2290, dir: "down", use: "telemetry", bands: ["S"] });
  assert.equal(G.parseLink("8.4GHz up").dir, "up");
  assert.equal(G.parseLink("401 MHz").dir, "");
  assert.throws(() => G.parseLink("telemetry only"));
});

test("ground stations: the built-in list", () => {
  const list = G.stations();
  assert.ok(list.length >= 10);
  const ids = new Set();
  list.forEach((s) => {
    assert.ok(!ids.has(s.id), "unique id " + s.id); ids.add(s.id);
    assert.ok(s.lat >= -90 && s.lat <= 90 && s.lon >= -180 && s.lon <= 180, s.name + " position");
    assert.ok(s.links.length > 0, s.name + " has links");
    s.links.forEach((l) => {
      assert.ok(l.highMHz > l.lowMHz, s.name + " range order");
      assert.ok(l.dir === "up" || l.dir === "down", s.name + " direction");
      assert.ok(l.bands.length > 0, s.name + " band");
    });
  });
  // The 70 m DSN dishes work in S and X; Ka-band is on the 34 m dishes, so DSS-14 must not list it. The deep-space
  // "X-band" uplink, 7145-7190 MHz, lies in IEEE C (4-8 GHz), so the IEEE bands are S, C and X.
  const dss14 = list.find((s) => s.id === "dss14");
  assert.deepEqual(dss14.bands, ["S", "C", "X"]);
  assert.ok(!dss14.bands.includes("Ka"));
  assert.deepEqual(dss14.links.map((l) => [l.lowMHz, l.highMHz, l.dir]),
    [[2110, 2120, "up"], [2290, 2300, "down"], [7145, 7190, "up"], [8400, 8450, "down"]]);
  // The Air Force (now Space Force) control network commands in L-band and receives in S-band.
  assert.deepEqual(list.find((s) => s.id === "guam-afscn").bands, ["L", "S"]);
  assert.deepEqual(list.find((s) => s.id === "fucino").bands, ["X", "Ku"]);
  assert.deepEqual(list.find((s) => s.id === "wsc").bands, ["Ku"]);
});

test("ground stations: filtering and user stations", () => {
  const list = G.stations();
  assert.equal(G.filter(list, "all", "").length, list.length);
  const ku = G.filter(list, "Ku", "").map((s) => s.id).sort();
  assert.deepEqual(ku, ["fucino", "wsc"]);
  assert.deepEqual(G.filter(list, "all", "8420 MHz").map((s) => s.id).sort(), ["dss14", "dss43", "dss63"]);
  assert.ok(G.filter(list, "all", "ksat").some((s) => s.id === "svalsat"));
  assert.equal(G.filter(list, "VHF", "").length, 0);
  const mine = G.makeStation("Test site", 45, -93, "Me", "435-438 MHz down\n145.8 MHz up");
  assert.deepEqual(mine.bands, ["VHF", "UHF"]);
  assert.ok(mine.custom);
  assert.equal(G.filter([mine], "UHF", "").length, 1, "a user station shows under its real band");
  assert.throws(() => G.makeStation("", 0, 0, "", "2 GHz"));
  assert.throws(() => G.makeStation("x", 95, 0, "", "2 GHz"));
  assert.throws(() => G.makeStation("x", 0, 0, "", ""));
  assert.equal(G.formatRange(2200, 2290), "2200–2290 MHz");
  assert.equal(G.formatRange(14600, 15250), "14.6–15.25 GHz");
});
