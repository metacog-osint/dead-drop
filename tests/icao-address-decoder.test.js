// ICAO Address Decoder. References: ICAO Annex 10, Volume III, Part I, Chapter 9, Appendix, Table 9-1 (allocation
// of aircraft addresses to States), and the FAA's assignment of US addresses A00001-ADF7C7 to N-numbers in order.
//
// Worked example, by hand. An N-number is N + a first digit 1-9, then up to four more characters, ending in at most
// two letters from the 24 letters A-Z without I and O. Count how many N-numbers start with a k-digit prefix:
//   k = 5: just the prefix                                       = 1
//   k = 4: prefix + 24 one-letter endings + 10 five-digit ones    = 1 + 24 + 10 x 1   = 35
//   k = 3: prefix + 24 x (1 + 24) letter endings + 10 children    = 1 + 600 + 10 x 35 = 951
//   k = 2:                                                        = 1 + 600 + 10 x 951 = 10,111
//   k = 1:                                                        = 1 + 600 + 10 x 10,111 = 101,711
// Nine first digits give 9 x 101,711 = 915,399 N-numbers: A00001 + 915,398 = A00001 + 0xDF7C6 = ADF7C7, the known
// last address of the sequence. N1 = A00001. N2 = A00001 + 101,711 = A00001 + 0x18D4F = A18D50.
// N12345: after "1", skip the prefix and its letter endings (601) and digits 0-1 (2 x 10,111): 20,823;
//   after "12": 601 + 3 x 951 = 3,454; after "123": 601 + 4 x 35 = 741; after "1234": 1 + 24 + 5 x 1 = 30.
//   Offset 20,823 + 3,454 + 741 + 30 = 25,048 = 0x61D8, so N12345 = A00001 + 0x61D8 = A061D9.
// N1A = A00002 and N1AA = A00003 (letters come before the next digit); N1B = A00001 + 1 + 25 = A0001B;
//   N10 = A00001 + 601 = A0025A; N9999Z = ADF7C7 - 10 = ADF7BD (ten five-digit numbers follow it).
// Allocation table spot checks from Table 9-1: 3C0000-3FFFFF Germany, 400000-43FFFF United Kingdom,
//   7C0000-7FFFFF Australia, C00000-C3FFFF Canada, 780000-7BFFFF China, 100000-1FFFFF Russian Federation.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../site/lib/icao-address-decoder.js");

const hex = (n) => D.hex6(n);

test("N-number bucket sizes match the hand count", () => {
  assert.deepEqual(D.BUCKET.slice(1), [101711, 10111, 951, 35, 1]);
  assert.equal(D.LETTERS.length, 24);
  assert.equal(D.US_LAST - D.US_FIRST + 1, 9 * 101711);
});

test("N-number to address: worked pairs", () => {
  const pairs = { N1: "A00001", N1A: "A00002", N1AA: "A00003", N1B: "A0001B", N10: "A0025A", N2: "A18D50",
    N12345: "A061D9", N9999Z: "ADF7BD", N99999: "ADF7C7" };
  for (const [n, h] of Object.entries(pairs)) {
    assert.equal(hex(D.nToIcao(n)), h, n);
    assert.equal(D.icaoToN(parseInt(h, 16)), n, h);
  }
  assert.equal(hex(D.nToIcao("n12345")), "A061D9", "lower case and no N are accepted");
  assert.equal(hex(D.nToIcao("12345")), "A061D9");
});

test("N-numbers: all 915,399 US addresses round-trip, ending at N99999", () => {
  let prev = null;
  for (let a = D.US_FIRST; a <= D.US_LAST; a++) {
    const n = D.icaoToN(a);
    assert.ok(/^N[1-9][0-9]{0,4}[A-HJ-NP-Z]{0,2}$/.test(n) && n.length <= 6, n);
    if (D.nToIcao(n) !== a) assert.fail(`round trip ${hex(a)} -> ${n}`);
    prev = n;
  }
  assert.equal(prev, "N99999");
  assert.equal(D.icaoToN(0xA00000), null);
  assert.equal(D.icaoToN(0xADF7C8), null);
});

test("N-numbers: independent enumeration in the FAA order agrees", () => {
  // Enumerate valid N-numbers depth first (prefix, its letter endings, then each next digit) and compare positions.
  const L = D.LETTERS.split("");
  let i = 0, checked = 0;
  function walk(p) {
    if (i % 997 === 0) { assert.equal(D.nToIcao(p), D.US_FIRST + i, p); checked++; }
    i++;
    const room = 6 - p.length;            // characters still allowed after "N"
    if (room >= 1) for (const a of L) {
      if (i % 997 === 0) { assert.equal(D.nToIcao(p + a), D.US_FIRST + i, p + a); checked++; }
      i++;
      if (room >= 2) for (const b of L) {
        if (i % 997 === 0) { assert.equal(D.nToIcao(p + a + b), D.US_FIRST + i, p + a + b); checked++; }
        i++;
      }
    }
    if (room >= 1) for (let d = 0; d <= 9; d++) walk(p + d);
  }
  for (let d = 1; d <= 9; d++) walk("N" + d);
  assert.equal(i, 915399);
  assert.ok(checked > 900);
});

test("N-numbers: bad input is refused", () => {
  for (const bad of ["N0123", "N123456", "N1I", "N1O", "N1A1", "N1ABC", "N", "", "N12A3", "N1234AB"]) {
    assert.throws(() => D.nToIcao(bad), undefined, bad);
  }
});

test("allocation table: sorted, no overlaps, every block a power-of-two size on its own boundary", () => {
  let prev = -1;
  for (const b of D.ICAO_TABLE) {
    const size = b.last - b.first + 1;
    assert.ok(size > 0 && (size & (size - 1)) === 0, b.state);
    assert.equal(b.first % size, 0, b.state);
    assert.ok(b.first > prev, b.state);
    prev = b.last;
  }
  assert.ok(D.ICAO_TABLE.length > 180);
});

test("state of registry: spot checks from Table 9-1", () => {
  const cases = { "3C6589": "Germany", "400000": "United Kingdom", "43FFFF": "United Kingdom", "7C1234": "Australia",
    C0FFEE: "Canada", "780A00": "China", "155555": "Russian Federation", A061D9: "United States", "4B8100": "Türkiye",
    E40000: "Brazil", "896123": "United Arab Emirates" };
  for (const [h, st] of Object.entries(cases)) assert.equal(D.decode(h).state, st, h);
  assert.equal(D.decode("3C6589").block, "3C0000–3FFFFF");
  assert.equal(D.decode("3C6589").blockSize, 262144);
});

test("decode: forms, US specifics, community ranges and bad input", () => {
  const r = D.decode("0xa061d9");
  assert.equal(r.hex, "A061D9");
  assert.equal(r.nNumber, "N12345");
  assert.equal(r.octal, (0xA061D9).toString(8).padStart(8, "0"));
  assert.equal(r.binary.length, 24);
  const m = D.decode("AE1234");
  assert.equal(m.nNumber, null);
  assert.equal(m.community.length, 1);
  assert.match(m.community[0].label, /^Community-reported, not ICAO/);
  assert.equal(D.decode("000000").state, null);
  assert.ok(D.decode("FFFFFF").notes.length >= 1);
  assert.equal(D.decode("F00010").state.indexOf("ICAO block 1"), 0);
  assert.equal(D.decodeAny("N12345").hex, "A061D9");
  assert.equal(D.decodeAny("a061d9").nNumber, "N12345");
  for (const bad of ["", "12345", "1234567", "GGGGGG", "A0 61 D"]) assert.throws(() => D.decode(bad), undefined, bad);
});
