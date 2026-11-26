// Unit converter. Reference: NIST Special Publication 811 (2008), appendix B: foot = 0.3048 m, mile = 1609.344 m,
// nautical mile = 1852 m, pound = 0.45359237 kg, short ton = 907.18474 kg, long ton = 1016.0469088 kg (all exact);
// pound-force = 4.448222 N (exact 0.45359237 x 9.80665 = 4.4482216152605 N); psi = 6.894757 kPa;
// standard atmosphere = 101325 Pa (exact); mmHg (conventional) = 133.3224 Pa; inHg (conventional) = 3386.389 Pa;
// t/degC = T/K - 273.15; t/degF = 1.8 t/degC + 32. Astronomical unit: IAU 2012 resolution B2, 149,597,870,700 m.
// Speed of sound: U.S. Standard Atmosphere 1976, a = sqrt(1.4 x 287.05287 x T); its table gives 340.294 m/s at sea
// level (288.15 K) and 295.069 m/s from 11 to 20 km (216.65 K).
// Hand calculations: 1 km = 1000 / 1609.344 = 0.6213712 mi; 10,000 m = 10000 / 0.3048 = 32,808.399 ft;
// 1,000 kg = 1000 / 0.45359237 = 2,204.6226 lb; 1 m/s = 3600 / 1852 = 1.9438445 kn; 1 atm = 101325 / 6894.757293
// = 14.695949 psi; 29.92 inHg = 29.92 x 3386.389 Pa = 1013.21 hPa; 1 short ton = 0.90718474 t; Mach 1 at sea level = 340.294 m/s = 1,225.06 km/h (the old figure,
// 1,234.8 km/h = 343.0 m/s, is the speed of sound in air at about 20 degC, not the standard sea-level value).
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../site/lib/unit-converter.js");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const rel = (a, b, tol, what) => assert.ok(Math.abs(a / b - 1) <= tol, `${what}: ${a} vs ${b}`);

test("length and speed: NIST SP 811 exact factors", () => {
  rel(U.convert(1, "length", "km", "mi"), 0.6213712, 1e-7, "km to mi");
  rel(U.convert(10000, "length", "m", "ft"), 32808.399, 1e-8, "m to ft");
  near(U.convert(1, "length", "nmi", "km"), 1.852, 1e-12, "nmi to km");
  near(U.convert(1, "length", "mi", "ft"), 5280, 1e-9, "mile is 5,280 ft");
  near(U.convert(1, "length", "au", "km"), 149597870.7, 1e-3, "astronomical unit");
  rel(U.convert(1, "speed", "m/s", "kn"), 1.9438445, 1e-7, "m/s to knots");
  near(U.convert(1000, "speed", "km/h", "m/s"), 277.7777778, 1e-6, "km/h to m/s");
  near(U.convert(60, "speed", "mph", "km/h"), 96.56064, 1e-9, "60 mph");
});

test("mass, force and pressure", () => {
  rel(U.convert(1000, "mass", "kg", "lb"), 2204.6226, 1e-7, "kg to lb");
  near(U.convert(1, "mass", "shton", "t"), 0.90718474, 1e-12, "short ton");
  near(U.convert(1, "mass", "lgton", "lb"), 2240, 1e-9, "long ton is 2,240 lb");
  near(U.convert(16, "mass", "oz", "lb"), 1, 1e-12, "16 oz to the pound");
  near(U.convert(1, "force", "lbf", "N"), 4.4482216152605, 1e-12, "pound-force");
  rel(U.convert(1, "mass", "slug", "kg"), 14.59390, 1e-6, "slug");
  rel(U.convert(1, "pressure", "atm", "psi"), 14.695949, 1e-7, "atm to psi");
  rel(U.convert(1, "pressure", "psi", "Pa"), 6894.757, 1e-7, "psi");
  near(U.convert(1013.25, "pressure", "hPa", "atm"), 1, 1e-12, "standard pressure in hPa");
  rel(U.convert(29.92, "pressure", "inHg", "hPa"), 1013.21, 1e-5, "29.92 inHg");
  rel(U.convert(760, "pressure", "torr", "mmHg"), 101325 / 133.3224, 1e-9, "760 torr is 759.9998 mmHg");
});

test("angle and temperature", () => {
  near(U.convert(180, "angle", "deg", "rad"), Math.PI, 1e-12, "180 deg");
  near(U.convert(1, "angle", "mil", "deg"), 0.05625, 1e-12, "NATO mil");
  near(U.convert(1, "angle", "deg", "arcsec"), 3600, 1e-9, "arcseconds");
  near(U.convert(100, "temperature", "C", "F"), 212, 1e-9, "boiling point");
  near(U.convert(-40, "temperature", "C", "F"), -40, 1e-9, "-40 is the same");
  near(U.convert(0, "temperature", "K", "F"), -459.67, 1e-9, "absolute zero in F");
  near(U.convert(491.67, "temperature", "R", "C"), 0, 1e-9, "Rankine");
  const rows = U.all(0, "temperature", "C");
  assert.equal(rows.length, 4);
  near(rows.find((r) => r.id === "K").value, 273.15, 1e-12, "all()");
});

test("standard atmosphere: speed of sound and Mach", () => {
  near(U.isaTemperatureK(0), 288.15, 1e-9, "sea level");
  near(U.isaTemperatureK(11000), 216.65, 1e-9, "tropopause");
  near(U.isaTemperatureK(15000), 216.65, 1e-9, "isothermal layer");
  near(U.isaTemperatureK(25000), 221.65, 1e-9, "25 km");
  near(U.speedOfSound(288.15), 340.294, 0.001, "sea level");
  near(U.speedOfSound(216.65), 295.069, 0.002, "11 to 20 km");
  near(U.machToSpeed(1, 288.15) * 3.6, 1225.06, 0.01, "Mach 1 in km/h");
  near(U.flightLevel(35000), 350, 0, "FL350");
  near(U.flightLevel(10049), 100, 0, "rounds to the nearest level");
});

test("bad input is refused", () => {
  assert.throws(() => U.convert(NaN, "length", "m", "ft"));
  assert.throws(() => U.convert(1, "length", "m", "parsec"));
  assert.throws(() => U.convert(1, "volume", "l", "gal"));
  assert.throws(() => U.convert(-300, "temperature", "C", "K"), /absolute zero/);
  assert.throws(() => U.speedOfSound(0));
  assert.throws(() => U.machToSpeed(-1, 288.15));
  assert.throws(() => U.isaTemperatureK(90000));
});
