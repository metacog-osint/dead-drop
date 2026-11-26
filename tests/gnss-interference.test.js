// GNSS Interference Indicators. References: Kaplan & Hegarty, Understanding GPS: Principles and Applications,
// 2nd ed., chapter 6 (effective C/N0 under interference, C / (N0 + I0)) and chapter 2 (four unknowns, so four
// satellites for a 3-D fix); Humphreys et al., "Assessing the spoofing threat", ION GNSS 2008 (spoofing signs).
// Worked examples, by hand:
//   A C/N0 drop of D dB with the signal unchanged means (N0 + I0) / N0 = 10^(D/10), so I0/N0 = 10^(D/10) - 1.
//   D = 10 dB: I0/N0 = 9, 10 log10 9 = 9.542 dB.   D = 3 dB: 10^0.3 - 1 = 0.99526, 10 log10 = -0.021 dB
//   (interference about equal to the thermal noise).   D = 6 dB: 10^0.6 - 1 = 2.98107, 4.744 dB.
//   Satellites: 3 used is below the four a 3-D fix needs, whatever else is entered.
// Every other threshold is indicative by design; the tests pin the stated values (C/N0 40 and 35 dB-Hz absolute;
// 3 and 10 dB drop; 6 or 10 satellites without a baseline; a quarter or half lost; 10 and 20 m; 2 and 5 times).
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../site/lib/gnss-interference.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const reading = (r, id) => r.indicators.find(x => x.id === id).reading;

test("implied interference-to-noise ratio from a C/N0 drop", () => {
  near(G.interferenceToNoiseDb(10), 9.542, 0.001, "10 dB drop");
  near(G.interferenceToNoiseDb(3), -0.021, 0.001, "3 dB drop");
  near(G.interferenceToNoiseDb(6), 4.744, 0.001, "6 dB drop");
  assert.equal(G.interferenceToNoiseDb(0), null);
  assert.equal(G.interferenceToNoiseDb(-2), null);
  const r = G.assess({ cn0: 35, cn0Baseline: 45 });
  near(r.cn0DropDb, 10, 1e-12, "drop"); near(r.interferenceToNoiseDb, 9.542, 0.001, "via assess");
  assert.equal(reading(r, "cn0"), "strong");
});

test("C/N0 thresholds, absolute and against normal", () => {
  assert.equal(reading(G.assess({ cn0: 45 }), "cn0"), "normal");
  assert.equal(reading(G.assess({ cn0: 40 }), "cn0"), "normal");
  assert.equal(reading(G.assess({ cn0: 37 }), "cn0"), "flag");
  assert.equal(reading(G.assess({ cn0: 34.9 }), "cn0"), "strong");
  assert.equal(reading(G.assess({ cn0: 43, cn0Baseline: 45 }), "cn0"), "normal");
  assert.equal(reading(G.assess({ cn0: 42, cn0Baseline: 45 }), "cn0"), "flag");
  const up = G.assess({ cn0: 49, cn0Baseline: 45 });
  assert.equal(reading(up, "cn0"), "flag");
  assert.equal(up.pattern, "spoofing-like");
});

test("satellite counts: four is physics, the rest indicative", () => {
  assert.equal(reading(G.assess({ sats: 3 }), "sats"), "strong");
  assert.equal(reading(G.assess({ sats: 3, satsBaseline: 4 }), "sats"), "strong");
  assert.equal(reading(G.assess({ sats: 5 }), "sats"), "flag");
  assert.equal(reading(G.assess({ sats: 8 }), "sats"), "normal");
  assert.equal(reading(G.assess({ sats: 8, constellations: "multi" }), "sats"), "flag");
  assert.equal(reading(G.assess({ sats: 18, satsBaseline: 24, constellations: "multi" }), "sats"), "flag");
  assert.equal(reading(G.assess({ sats: 12, satsBaseline: 24 }), "sats"), "strong");
  assert.equal(reading(G.assess({ sats: 19, satsBaseline: 24 }), "sats"), "normal");
});

test("accuracy and observations, and the wording never confirms", () => {
  assert.equal(reading(G.assess({ haccM: 5 }), "hacc"), "normal");
  assert.equal(reading(G.assess({ haccM: 15 }), "hacc"), "flag");
  assert.equal(reading(G.assess({ haccM: 25 }), "hacc"), "strong");
  assert.equal(reading(G.assess({ haccM: 6, haccBaseline: 3 }), "hacc"), "flag");
  assert.equal(reading(G.assess({ haccM: 15, haccBaseline: 3 }), "hacc"), "strong");
  const quiet = G.assess({ cn0: 45, sats: 9, haccM: 4 });
  assert.equal(quiet.flaggedCount, 0); assert.equal(quiet.pattern, "none");
  assert.match(quiet.summary, /does not rule out/);
  const jam = G.assess({ cn0: 30, sats: 3, haccM: 40, flags: { agcDrop: true } });
  assert.equal(jam.jammingLike, 4); assert.equal(jam.pattern, "interference-like");
  const both = G.assess({ cn0: 30, flags: { posJump: true, timeJump: true } });
  assert.equal(both.pattern, "both"); assert.equal(both.spoofingLike, 2);
  for (const r of [quiet, jam, both, G.assess({ flags: { cn0Uniform: true } })]) {
    const text = [r.summary, r.caution].concat(r.indicators.map(x => x.text + " " + x.basis)).join(" ");
    assert.doesNotMatch(text, /\b(confirmed|detected|threat level|critical)\b/i);
    assert.match(r.caution, /cannot confirm/);
  }
});

test("bad input is refused", () => {
  assert.throws(() => G.assess({}), /at least one/);
  assert.throws(() => G.assess({ cn0: "45" }));
  assert.throws(() => G.assess({ cn0: 90 }));
  assert.throws(() => G.assess({ sats: 4.5 }));
  assert.throws(() => G.assess({ sats: -1 }));
  assert.throws(() => G.assess({ sats: 5, satsBaseline: 0 }));
  assert.throws(() => G.assess({ haccM: -3 }));
  assert.throws(() => G.assess({ haccM: 3, haccBaseline: 0 }));
});
