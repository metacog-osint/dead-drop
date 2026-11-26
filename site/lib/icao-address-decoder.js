/* ICAO 24-bit aircraft address decoder. Pure functions, no DOM, no network.

   1. State of registry. Every Mode S transponder (and so every ADS-B transmitter) sends a 24-bit address that the
      state of registry assigns to the airframe. ICAO gives each state a block of addresses:
      ICAO Annex 10, Aeronautical Telecommunications, Volume III, Part I, Chapter 9 ("Aircraft addressing system"),
      Appendix to Chapter 9, Table 9-1, "Allocation of aircraft addresses to States". The table below is that
      allocation, written as first and last address of each block in hexadecimal (the Annex gives the same blocks as
      binary prefixes). Blocks are re-assigned by amendment from time to time, so check a decision that matters
      against the current edition of the Annex.
      ICAO does not publish military sub-blocks. The one range below marked community-reported is from open-source
      ADS-B software, not from ICAO, and is never a statement that an aircraft is military.

   2. United States N-numbers. The FAA assigns US civil addresses A00001 to ADF7C7 to N-numbers in a fixed order
      (the FAA aircraft registry lists each aircraft's Mode S code, in octal and hexadecimal, beside its N-number).
      An N-number is "N" plus 1 to 5 characters: a first digit 1-9, then digits, ending in at
      most two letters, never I or O, letters only at the end. Counting them in order, N1, N1A, N1AA ... N1AZ, N1B,
      ... N1ZZ, N10, N10A ... gives each N-number its address: N1 = A00001, N2 = A18D50, N99999 = ADF7C7.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.DD = root.DD || {}).icaoAddressDecoder = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // [first, last, state]. ICAO Annex 10, Vol. III, Part I, Chapter 9, Appendix, Table 9-1.
  var ICAO_TABLE = [
    ["004000", "0043FF", "Zimbabwe"],
    ["006000", "006FFF", "Mozambique"],
    ["008000", "00FFFF", "South Africa"],
    ["010000", "017FFF", "Egypt"],
    ["018000", "01FFFF", "Libya"],
    ["020000", "027FFF", "Morocco"],
    ["028000", "02FFFF", "Tunisia"],
    ["030000", "0303FF", "Botswana"],
    ["032000", "032FFF", "Burundi"],
    ["034000", "034FFF", "Cameroon"],
    ["035000", "0353FF", "Comoros"],
    ["036000", "036FFF", "Congo"],
    ["038000", "038FFF", "Côte d'Ivoire"],
    ["03E000", "03EFFF", "Gabon"],
    ["040000", "040FFF", "Ethiopia"],
    ["042000", "042FFF", "Equatorial Guinea"],
    ["044000", "044FFF", "Ghana"],
    ["046000", "046FFF", "Guinea"],
    ["048000", "0483FF", "Guinea-Bissau"],
    ["04A000", "04A3FF", "Lesotho"],
    ["04C000", "04CFFF", "Kenya"],
    ["050000", "050FFF", "Liberia"],
    ["054000", "054FFF", "Madagascar"],
    ["058000", "058FFF", "Malawi"],
    ["05A000", "05A3FF", "Maldives"],
    ["05C000", "05CFFF", "Mali"],
    ["05E000", "05E3FF", "Mauritania"],
    ["060000", "0603FF", "Mauritius"],
    ["062000", "062FFF", "Niger"],
    ["064000", "064FFF", "Nigeria"],
    ["068000", "068FFF", "Uganda"],
    ["06A000", "06A3FF", "Qatar"],
    ["06C000", "06CFFF", "Central African Republic"],
    ["06E000", "06EFFF", "Rwanda"],
    ["070000", "070FFF", "Senegal"],
    ["074000", "0743FF", "Seychelles"],
    ["076000", "0763FF", "Sierra Leone"],
    ["078000", "078FFF", "Somalia"],
    ["07A000", "07A3FF", "Eswatini"],
    ["07C000", "07CFFF", "Sudan"],
    ["080000", "080FFF", "United Republic of Tanzania"],
    ["084000", "084FFF", "Chad"],
    ["088000", "088FFF", "Togo"],
    ["08A000", "08AFFF", "Zambia"],
    ["08C000", "08CFFF", "Democratic Republic of the Congo"],
    ["090000", "090FFF", "Angola"],
    ["094000", "0943FF", "Benin"],
    ["096000", "0963FF", "Cabo Verde"],
    ["098000", "0983FF", "Djibouti"],
    ["09A000", "09AFFF", "Gambia"],
    ["09C000", "09CFFF", "Burkina Faso"],
    ["09E000", "09E3FF", "Sao Tome and Principe"],
    ["0A0000", "0A7FFF", "Algeria"],
    ["0A8000", "0A8FFF", "Bahamas"],
    ["0AA000", "0AA3FF", "Barbados"],
    ["0AB000", "0AB3FF", "Belize"],
    ["0AC000", "0ACFFF", "Colombia"],
    ["0AE000", "0AEFFF", "Costa Rica"],
    ["0B0000", "0B0FFF", "Cuba"],
    ["0B2000", "0B2FFF", "El Salvador"],
    ["0B4000", "0B4FFF", "Guatemala"],
    ["0B6000", "0B6FFF", "Guyana"],
    ["0B8000", "0B8FFF", "Haiti"],
    ["0BA000", "0BAFFF", "Honduras"],
    ["0BC000", "0BC3FF", "Saint Vincent and the Grenadines"],
    ["0BE000", "0BEFFF", "Jamaica"],
    ["0C0000", "0C0FFF", "Nicaragua"],
    ["0C2000", "0C2FFF", "Panama"],
    ["0C4000", "0C4FFF", "Dominican Republic"],
    ["0C6000", "0C6FFF", "Trinidad and Tobago"],
    ["0C8000", "0C8FFF", "Suriname"],
    ["0CA000", "0CA3FF", "Antigua and Barbuda"],
    ["0CC000", "0CC3FF", "Grenada"],
    ["0D0000", "0D7FFF", "Mexico"],
    ["0D8000", "0DFFFF", "Venezuela (Bolivarian Republic of)"],
    ["100000", "1FFFFF", "Russian Federation"],
    ["201000", "2013FF", "Namibia"],
    ["202000", "2023FF", "Eritrea"],
    ["300000", "33FFFF", "Italy"],
    ["340000", "37FFFF", "Spain"],
    ["380000", "3BFFFF", "France"],
    ["3C0000", "3FFFFF", "Germany"],
    ["400000", "43FFFF", "United Kingdom"],
    ["440000", "447FFF", "Austria"],
    ["448000", "44FFFF", "Belgium"],
    ["450000", "457FFF", "Bulgaria"],
    ["458000", "45FFFF", "Denmark"],
    ["460000", "467FFF", "Finland"],
    ["468000", "46FFFF", "Greece"],
    ["470000", "477FFF", "Hungary"],
    ["478000", "47FFFF", "Norway"],
    ["480000", "487FFF", "Netherlands"],
    ["488000", "48FFFF", "Poland"],
    ["490000", "497FFF", "Portugal"],
    ["498000", "49FFFF", "Czechia"],
    ["4A0000", "4A7FFF", "Romania"],
    ["4A8000", "4AFFFF", "Sweden"],
    ["4B0000", "4B7FFF", "Switzerland"],
    ["4B8000", "4BFFFF", "Türkiye"],
    ["4C0000", "4C7FFF", "Serbia"],
    ["4C8000", "4C83FF", "Cyprus"],
    ["4CA000", "4CAFFF", "Ireland"],
    ["4CC000", "4CCFFF", "Iceland"],
    ["4D0000", "4D03FF", "Luxembourg"],
    ["4D2000", "4D23FF", "Malta"],
    ["4D4000", "4D43FF", "Monaco"],
    ["500000", "5003FF", "San Marino"],
    ["501000", "5013FF", "Albania"],
    ["501C00", "501FFF", "Croatia"],
    ["502C00", "502FFF", "Latvia"],
    ["503C00", "503FFF", "Lithuania"],
    ["504C00", "504FFF", "Republic of Moldova"],
    ["505C00", "505FFF", "Slovakia"],
    ["506C00", "506FFF", "Slovenia"],
    ["507C00", "507FFF", "Uzbekistan"],
    ["508000", "50FFFF", "Ukraine"],
    ["510000", "5103FF", "Belarus"],
    ["511000", "5113FF", "Estonia"],
    ["512000", "5123FF", "North Macedonia"],
    ["513000", "5133FF", "Bosnia and Herzegovina"],
    ["514000", "5143FF", "Georgia"],
    ["515000", "5153FF", "Tajikistan"],
    ["516000", "5163FF", "Montenegro"],
    ["600000", "6003FF", "Armenia"],
    ["600800", "600BFF", "Azerbaijan"],
    ["601000", "6013FF", "Kyrgyzstan"],
    ["601800", "601BFF", "Turkmenistan"],
    ["680000", "6803FF", "Bhutan"],
    ["681000", "6813FF", "Micronesia (Federated States of)"],
    ["682000", "6823FF", "Mongolia"],
    ["683000", "6833FF", "Kazakhstan"],
    ["684000", "6843FF", "Palau"],
    ["700000", "700FFF", "Afghanistan"],
    ["702000", "702FFF", "Bangladesh"],
    ["704000", "704FFF", "Myanmar"],
    ["706000", "706FFF", "Kuwait"],
    ["708000", "708FFF", "Lao People's Democratic Republic"],
    ["70A000", "70AFFF", "Nepal"],
    ["70C000", "70C3FF", "Oman"],
    ["70E000", "70EFFF", "Cambodia"],
    ["710000", "717FFF", "Saudi Arabia"],
    ["718000", "71FFFF", "Republic of Korea"],
    ["720000", "727FFF", "Democratic People's Republic of Korea"],
    ["728000", "72FFFF", "Iraq"],
    ["730000", "737FFF", "Iran (Islamic Republic of)"],
    ["738000", "73FFFF", "Israel"],
    ["740000", "747FFF", "Jordan"],
    ["748000", "74FFFF", "Lebanon"],
    ["750000", "757FFF", "Malaysia"],
    ["758000", "75FFFF", "Philippines"],
    ["760000", "767FFF", "Pakistan"],
    ["768000", "76FFFF", "Singapore"],
    ["770000", "777FFF", "Sri Lanka"],
    ["778000", "77FFFF", "Syrian Arab Republic"],
    ["780000", "7BFFFF", "China"],
    ["7C0000", "7FFFFF", "Australia"],
    ["800000", "83FFFF", "India"],
    ["840000", "87FFFF", "Japan"],
    ["880000", "887FFF", "Thailand"],
    ["888000", "88FFFF", "Viet Nam"],
    ["890000", "890FFF", "Yemen"],
    ["894000", "894FFF", "Bahrain"],
    ["895000", "8953FF", "Brunei Darussalam"],
    ["896000", "896FFF", "United Arab Emirates"],
    ["897000", "8973FF", "Solomon Islands"],
    ["898000", "898FFF", "Papua New Guinea"],
    ["8A0000", "8A7FFF", "Indonesia"],
    ["900000", "9003FF", "Marshall Islands"],
    ["901000", "9013FF", "Cook Islands"],
    ["902000", "9023FF", "Samoa"],
    ["A00000", "AFFFFF", "United States"],
    ["C00000", "C3FFFF", "Canada"],
    ["C80000", "C87FFF", "New Zealand"],
    ["C88000", "C88FFF", "Fiji"],
    ["C8A000", "C8A3FF", "Nauru"],
    ["C8C000", "C8C3FF", "Saint Lucia"],
    ["C8D000", "C8D3FF", "Tonga"],
    ["C8E000", "C8E3FF", "Kiribati"],
    ["C90000", "C903FF", "Vanuatu"],
    ["E00000", "E3FFFF", "Argentina"],
    ["E40000", "E7FFFF", "Brazil"],
    ["E80000", "E80FFF", "Chile"],
    ["E84000", "E84FFF", "Ecuador"],
    ["E88000", "E88FFF", "Paraguay"],
    ["E8C000", "E8CFFF", "Peru"],
    ["E90000", "E90FFF", "Uruguay"],
    ["E94000", "E94FFF", "Bolivia (Plurinational State of)"],
    ["F00000", "F07FFF", "ICAO block 1: temporary addresses ICAO issues on request"],
    ["F09000", "F093FF", "ICAO block 2: special uses in the interests of flight safety"]
  ];

  // Ranges from open-source ADS-B software, not from ICAO. Shown as such and never as fact.
  var COMMUNITY = [
    { first: "ADF7C8", last: "AFFFFF", label: "Community-reported, not ICAO: the part of the US block past the last N-number. " +
      "Open-source ADS-B software (the tar1090 map, for one) commonly flags addresses here as US military; the FAA " +
      "and ICAO publish no such sub-block, so this says nothing certain about the aircraft." },
    { first: "899000", last: "8993FF", label: "Community-reported, not ICAO: this block is not in the ICAO table. Open-source " +
      "ADS-B decoders' country lists attribute it to Taiwan, which is not an ICAO member state." }
  ];

  var TABLE = ICAO_TABLE.map(function (r) {
    return { first: parseInt(r[0], 16), last: parseInt(r[1], 16), state: r[2], firstHex: r[0], lastHex: r[1] };
  });
  var COMM = COMMUNITY.map(function (r) {
    return { first: parseInt(r.first, 16), last: parseInt(r.last, 16), firstHex: r.first, lastHex: r.last, label: r.label };
  });

  function hex6(n) { return ("000000" + n.toString(16).toUpperCase()).slice(-6); }

  /** Parses "A1B2C3", "a1b2c3", "0xA1B2C3" or "A1 B2 C3".
   *  Returns the address as a number, or throws with a plain reason. */
  function parseAddress(text) {
    var s = String(text == null ? "" : text).trim().toUpperCase().replace(/[\s:-]/g, "");
    if (s.indexOf("0X") === 0) s = s.slice(2);
    if (s === "") throw new Error("Enter an address: six hexadecimal characters, 0-9 and A-F.");
    if (!/^[0-9A-F]+$/.test(s)) throw new Error("An ICAO address is hexadecimal: only 0-9 and A-F.");
    if (s.length !== 6) throw new Error("An ICAO address is 24 bits: exactly six hexadecimal characters (got " + s.length + ").");
    return parseInt(s, 16);
  }

  function lookupState(addr) {
    for (var i = 0; i < TABLE.length; i++) if (addr >= TABLE[i].first && addr <= TABLE[i].last) return TABLE[i];
    return null;
  }
  function lookupCommunity(addr) {
    return COMM.filter(function (r) { return addr >= r.first && addr <= r.last; });
  }

  // ---- US N-numbers ---------------------------------------------------------------------------------------------
  var LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";       // 24: no I, no O
  var DIGITS = "0123456789";
  var US_FIRST = 0xA00001, US_LAST = 0xADF7C7;
  // Size of the run of N-numbers that start with a given k-digit prefix (the prefix itself included).
  //   k = 5: the prefix alone (1).  k = 4: prefix, prefix + 1 letter (24), prefix + 1 digit (10 x 1) = 35.
  //   k <= 3: prefix (1), + 1 or 2 letters (24 x 25 = 600), + 1 digit (10 x next).
  var SUFFIX = 1 + 24 * 25;                       // 601: the prefix and its one- and two-letter endings
  var BUCKET = [0, 0, 0, 0, 35, 1];               // BUCKET[k] for k = 1..5
  BUCKET[3] = SUFFIX + 10 * BUCKET[4];            // 951
  BUCKET[2] = SUFFIX + 10 * BUCKET[3];            // 10111
  BUCKET[1] = SUFFIX + 10 * BUCKET[2];            // 101711

  /** Checks and normalises an N-number ("N12345", "12345", "n1ab"). Returns "N..." or throws. */
  function normaliseN(text) {
    var s = String(text == null ? "" : text).trim().toUpperCase().replace(/[\s-]/g, "");
    if (s.charAt(0) === "N") s = s.slice(1);
    if (s === "") throw new Error("Enter an N-number, for example N12345 or N1AB.");
    if (s.length > 5) throw new Error("An N-number has at most 5 characters after the N.");
    if (!/^[1-9]/.test(s)) throw new Error("An N-number starts with a digit 1 to 9 after the N.");
    if (/[IO]/.test(s)) throw new Error("N-numbers never use the letters I or O (they look like 1 and 0).");
    var m = /^([0-9]+)([A-Z]{0,2})$/.exec(s);
    if (!m) throw new Error("In an N-number the letters, at most two, come only at the end.");
    return "N" + s;
  }

  /** N-number to address (a number). */
  function nToIcao(text) {
    var s = normaliseN(text).slice(1);
    var m = /^([0-9]+)([A-Z]*)$/.exec(s);
    var digits = m[1], letters = m[2];
    var off = (Number(digits.charAt(0)) - 1) * BUCKET[1];
    for (var k = 2; k <= digits.length; k++) {      // each further digit skips the prefix's letter run and lower digits
      off += (k - 1 <= 3 ? SUFFIX : 25) + Number(digits.charAt(k - 1)) * BUCKET[k];
    }
    var k0 = digits.length;
    if (letters.length) {
      var a = LETTERS.indexOf(letters.charAt(0));
      if (k0 <= 3) {
        off += 1 + a * 25;
        if (letters.length === 2) off += 1 + LETTERS.indexOf(letters.charAt(1));
      } else {
        if (letters.length === 2) throw new Error("With four digits only one letter fits in five characters.");
        off += 1 + a;                               // k0 = 4: prefix + one letter
      }
    }
    return US_FIRST + off;
  }

  /** Address (a number) to N-number, or null when the address is outside A00001-ADF7C7. */
  function icaoToN(addr) {
    if (!(addr >= US_FIRST && addr <= US_LAST)) return null;
    var off = addr - US_FIRST;
    var out = "N" + String(Math.floor(off / BUCKET[1]) + 1);
    off %= BUCKET[1];
    for (var k = 1; k <= 5; k++) {
      if (off === 0) return out;                    // the prefix itself
      off -= 1;
      var nLetters = k <= 3 ? 24 * 25 : (k === 4 ? 24 : 0);
      if (off < nLetters) {
        if (k <= 3) {
          out += LETTERS.charAt(Math.floor(off / 25));
          var r = off % 25;
          if (r > 0) out += LETTERS.charAt(r - 1);
        } else {
          out += LETTERS.charAt(off);
        }
        return out;
      }
      off -= nLetters;
      var d = Math.floor(off / BUCKET[k + 1]);
      out += DIGITS.charAt(d);
      off -= d * BUCKET[k + 1];
    }
    return out;
  }

  /** Everything the page shows for one address. */
  function decode(text) {
    var addr = parseAddress(text);
    var out = {
      hex: hex6(addr),
      decimal: addr,
      octal: ("00000000" + addr.toString(8)).slice(-8),
      binary: ("000000000000000000000000" + addr.toString(2)).slice(-24),
      state: null, block: null, blockSize: null, nNumber: null, community: [], notes: []
    };
    if (addr === 0 || addr === 0xFFFFFF) {
      out.notes.push("ICAO does not assign the all-zeros or all-ones address to any aircraft.");
    }
    var b = lookupState(addr);
    if (b) {
      out.state = b.state;
      out.block = b.firstHex + "–" + b.lastHex;
      out.blockSize = b.last - b.first + 1;
    } else {
      out.notes.push("This address is outside every block in the ICAO allocation table (unallocated or held in reserve).");
    }
    out.community = lookupCommunity(addr).map(function (r) { return { range: r.firstHex + "–" + r.lastHex, label: r.label }; });
    if (b && b.state === "United States") {
      out.nNumber = icaoToN(addr);
      if (addr === 0xA00000) out.notes.push("A00000 is the first address of the US block but no N-number maps to it.");
      else if (!out.nNumber) out.notes.push("In the US block but past ADF7C7, the last address the FAA maps to an N-number.");
    }
    return out;
  }

  /** Decodes one line that is either an address or an N-number. */
  function decodeAny(text) {
    var s = String(text == null ? "" : text).trim().toUpperCase();
    if (/^N[0-9]/.test(s)) {
      var n = normaliseN(s);
      var r = decode(hex6(nToIcao(n)));
      r.input = n;
      r.inputKind = "N-number";
      return r;
    }
    var d = decode(s);
    d.input = s;
    d.inputKind = "ICAO address";
    return d;
  }

  return { ICAO_TABLE: TABLE, COMMUNITY: COMM, parseAddress: parseAddress, lookupState: lookupState,
    normaliseN: normaliseN, nToIcao: nToIcao, icaoToN: icaoToN, decode: decode, decodeAny: decodeAny, hex6: hex6,
    US_FIRST: US_FIRST, US_LAST: US_LAST, BUCKET: BUCKET.slice(), LETTERS: LETTERS };
});
