// Launch Site Database. Reference: Chris Veness, "Calculate distance, bearing and more between latitude/longitude
// points" (movable-type.co.uk), haversine formula on a sphere of R = 6371 km:
//   a = sin^2(dlat/2) + cos(lat1) cos(lat2) sin^2(dlon/2), c = 2 atan2(sqrt(a), sqrt(1 - a)), d = R c.
// Worked examples:
//   Veness's own example, Land's End (50 03 59 N, 005 42 53 W) to John o' Groats (58 38 38 N, 003 04 12 W): 968.9 km.
//   By hand: one degree along the equator = 6371 * pi / 180 = 111.195 km; equator to pole = 6371 * pi / 2 =
//   10,007.5 km; antipodes = 6371 * pi = 20,015.1 km.
//   By hand, Kennedy LC-39A (28.6083 N, 80.6041 W) to Cape Canaveral SLC-40 (28.5619 N, 80.5772 W):
//   dlat = 0.0464 deg = 5.159 km; dlon = 0.0269 deg * cos(28.585 deg) = 0.02362 deg = 2.627 km;
//   flat-Earth check sqrt(5.159^2 + 2.627^2) = 5.79 km, which the haversine must match at this short range.
// The list is also checked for sanity: every latitude in -90..90, longitude in -180..180, unique ids, known codes,
// and no two sites within 5 km of each other (a sign of a duplicate entry).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../site/lib/launch-sites.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const dms = (d, m, s) => d + m / 60 + s / 3600;

test("haversine: Veness's worked example and hand checks", () => {
  near(L.haversineKm(dms(50, 3, 59), -dms(5, 42, 53), dms(58, 38, 38), -dms(3, 4, 12)), 968.9, 0.1, "Land's End to John o' Groats");
  near(L.haversineKm(0, 0, 0, 1), 111.195, 0.001, "1 degree on the equator");
  near(L.haversineKm(0, 0, 90, 0), 10007.5, 0.1, "equator to pole");
  near(L.haversineKm(10, 20, -10, -160), 20015.1, 0.1, "antipodes");
  near(L.haversineKm(28.6083, -80.6041, 28.5619, -80.5772), 5.79, 0.01, "LC-39A to SLC-40");
  assert.equal(L.haversineKm(45, 170, 45, 170), 0);
  near(L.haversineKm(0, 179.5, 0, -179.5), 111.195, 0.001, "across the date line");
  assert.throws(() => L.haversineKm(91, 0, 0, 0));
  assert.throws(() => L.haversineKm(0, 0, 0, 181));
  assert.throws(() => L.haversineKm(NaN, 0, 0, 0));
});

test("site list sanity", () => {
  const sites = L.SITES;
  assert.equal(sites.length, 49);
  assert.deepEqual(L.checkList(sites), []);
  for (const s of sites) {
    assert.ok(s.lat >= -90 && s.lat <= 90, s.id + " lat");
    assert.ok(s.lon >= -180 && s.lon <= 180, s.id + " lon");
  }
  assert.equal(new Set(sites.map(s => s.id)).size, sites.length, "unique ids");
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    const d = L.haversineKm(sites[i].lat, sites[i].lon, sites[j].lat, sites[j].lon);
    assert.ok(d > 5, `${sites[i].id} and ${sites[j].id} are ${d.toFixed(1)} km apart`);
  }
  // Spot checks of corrected positions (see the method notes).
  const by = Object.fromEntries(sites.map(s => [s.id, s]));
  near(by["taiyuan-satellite-launch-center"].lat, 38.85, 0.05, "Taiyuan is in Kelan County, not Taiyuan city");
  near(by["plesetsk-cosmodrome"].lon, 40.58, 0.05, "Plesetsk longitude");
  near(by["vostochny-cosmodrome"].lat, 51.88, 0.05, "Vostochny latitude");
  assert.equal(by["baikonur-cosmodrome"].country, "Kazakhstan");
  // The checker catches bad lists.
  const bad = [{ ...sites[0] }, { ...sites[0] }, { ...sites[1], id: "x", lat: 95 }, { ...sites[2], id: "y", status: "open" }];
  const problems = L.checkList(bad).join(" | ");
  assert.match(problems, /duplicate id/);
  assert.match(problems, /position out of range/);
  assert.match(problems, /unknown status/);
  // No link to the old app's host anywhere in the list.
  const text = fs.readFileSync(path.join(__dirname, "../site/lib/launch-sites.js"), "utf8");
  assert.ok(!/web\.app|firebase/i.test(text));
});

test("era buckets and filters", () => {
  assert.equal(L.eraOf(1999), "historical");
  assert.equal(L.eraOf(2000), "modern");
  assert.equal(L.eraOf(2019), "modern");
  assert.equal(L.eraOf(2020), "new");
  assert.equal(L.eraOf(null), "none");
  const S = L.SITES;
  assert.equal(L.filterSites(S, {}).length, 49);
  assert.equal(L.filterSites(S, { text: "baikonur" }).length, 1);
  assert.equal(L.filterSites(S, { text: "ALCANTARA" })[0].id, "alcantara-space-center", "accent-blind");
  assert.equal(L.filterSites(S, { text: "andoya" })[0].id, "andoya-spaceport");
  assert.deepEqual(L.filterSites(S, { country: "Japan" }).map(s => s.id).sort(),
    ["spaceport-kii", "tanegashima-space-center", "uchinoura-space-center"]);
  // Counted by hand from the list: eight sites with no launch yet, seven that have launched people.
  assert.equal(L.filterSites(S, { era: "none" }).length, 8);
  assert.equal(L.filterSites(S, { capability: "crewed" }).length, 7);
  assert.equal(L.filterSites(S, { country: "China", launchType: "orbital", status: "active" }).length, 4);
  assert.equal(L.filterSites(S, { text: "no such place" }).length, 0);
  assert.equal(L.filterSites(S, { launchType: "all", country: "", status: null }).length, 49);
});

test("sorting by distance and first launch; nearest site", () => {
  const rows = L.arrange(L.SITES, "distance", 28.6083, -80.6041);
  assert.equal(rows[0].site.id, "kennedy-space-center");
  near(rows[0].distanceKm, 0, 1e-9, "zero distance kept, not treated as missing");
  assert.equal(rows[1].site.id, "cape-canaveral-space-force-station");
  near(rows[1].distanceKm, 5.79, 0.01, "second");
  const first = L.arrange(L.SITES, "first");
  assert.equal(first[0].site.id, "wallops-flight-facility", "1945 sorts first (Wallops before White Sands by name)");
  assert.equal(first[first.length - 1].site.firstLaunch, null, "no launch yet sorts last");
  assert.equal(L.arrange(L.SITES, "name")[0].site.name, "Alcântara Space Center");
  assert.throws(() => L.arrange(L.SITES, "distance", NaN, 0));
  assert.equal(L.nearestSite(L.SITES, 28.5833, -80.5829, 50).site.id, "cape-canaveral-space-force-station", "SLC-41");
  assert.equal(L.nearestSite(L.SITES, 30, -40, 50), null, "mid-Atlantic");
});

test("Launch Library 2 records and matching them to sites", () => {
  const a = L.parseLL2Launch({ id: "1", name: "Falcon 9 | Test", net: "2026-12-01T10:00:00Z", status: { abbrev: "Go" },
    rocket: { configuration: { full_name: "Falcon 9 Block 5" } }, probability: 80,
    pad: { name: "Space Launch Complex 41", latitude: "28.58341025", longitude: "-80.58303644", location: { name: "Cape Canaveral SFS, FL, USA" } } });
  const b = L.parseLL2Launch({ id: "2", name: "Earlier", net: "2026-11-30T10:00:00Z",
    pad: { latitude: 28.5619, longitude: -80.5772 } });
  const c = L.parseLL2Launch({ id: "3", name: "At sea", net: "2026-11-29T00:00:00Z", pad: { latitude: 34.9, longitude: 123.0 } });
  const d = L.parseLL2Launch({ id: "4", name: "No pad", net: "bad", probability: -1 });
  assert.equal(a.vehicle, "Falcon 9 Block 5");
  assert.equal(a.weatherProbability, 80);
  assert.equal(d.netMs, null);
  assert.equal(d.weatherProbability, null);
  assert.ok(Number.isNaN(d.lat));
  const m = L.matchLaunches([a, b, c, d], L.SITES, 50);
  assert.deepEqual(m.bySite["cape-canaveral-space-force-station"].map(x => x.id), ["2", "1"], "time order");
  assert.deepEqual(m.unmatched.map(x => x.id), ["3", "4"]);
  assert.deepEqual(L.countBy([{ status: "active" }, { status: "active" }, { status: "inactive" }], "status"), { active: 2, inactive: 1 });
});
