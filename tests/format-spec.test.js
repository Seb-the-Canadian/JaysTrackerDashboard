/* ============================================================
   Tests: format-spec
   Antifragile pass — Commit 5. Executable spec for every
   formatter in assets/format.js: declared @domain → in-domain
   formatting; out-of-domain → DASH (or the documented neutral).

   Run from repo root:
     /opt/node22/bin/node --test tests/format-spec.test.js
   (Works with any Node 18+; uses node:test + node:assert only.)
   ============================================================ */

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load assets/format.js inside a sandbox with a fake `window`. The file
// uses an IIFE that attaches `window.JaysFormat`; we capture that.
const FORMAT_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'format.js'),
  'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(FORMAT_SRC, sandbox);
const F = sandbox.window.JaysFormat;

// ---- baseballDecimal ----

test('baseballDecimal: drops leading zero for values < 1', () => {
  assert.strictEqual(F.baseballDecimal(0.312), '.312');
  assert.strictEqual(F.baseballDecimal(0.585, 3), '.585');
});
test('baseballDecimal: keeps leading digit for values >= 1', () => {
  assert.strictEqual(F.baseballDecimal(1.234), '1.234');
  assert.strictEqual(F.baseballDecimal(12.34, 2), '12.34');
});
test('baseballDecimal: handles negative sub-1 (-.123)', () => {
  assert.strictEqual(F.baseballDecimal(-0.123, 3), '-.123');
});
test('baseballDecimal: zero formats as .000 at default precision', () => {
  assert.strictEqual(F.baseballDecimal(0), '.000');
});
test('baseballDecimal: out-of-domain inputs → DASH', () => {
  assert.strictEqual(F.baseballDecimal(null), F.DASH);
  assert.strictEqual(F.baseballDecimal(undefined), F.DASH);
  assert.strictEqual(F.baseballDecimal(NaN), F.DASH);
  assert.strictEqual(F.baseballDecimal(Infinity), F.DASH);
  assert.strictEqual(F.baseballDecimal(-Infinity), F.DASH);
  assert.strictEqual(F.baseballDecimal('abc'), F.DASH);
  assert.strictEqual(F.baseballDecimal(true), F.DASH);
  assert.strictEqual(F.baseballDecimal(''), F.DASH);
});

// ---- signed ----

test('signed: positive gets +, negative keeps -, zero is "0"', () => {
  assert.strictEqual(F.signed(5), '+5');
  assert.strictEqual(F.signed(-3), '-3');
  assert.strictEqual(F.signed(0), '0');
});
test('signed: out-of-domain → DASH', () => {
  assert.strictEqual(F.signed(null), F.DASH);
  assert.strictEqual(F.signed(NaN), F.DASH);
  assert.strictEqual(F.signed(Infinity), F.DASH);
  assert.strictEqual(F.signed('x'), F.DASH);
});

// ---- winPct ----

test('winPct: typical season values', () => {
  assert.strictEqual(F.winPct(31, 22), '.585');
  assert.strictEqual(F.winPct(50, 50), '.500');
});
test('winPct: 0-0 is undefined → DASH', () => {
  assert.strictEqual(F.winPct(0, 0), F.DASH);
});
test('winPct: negative or non-numeric → DASH', () => {
  assert.strictEqual(F.winPct(-1, 5), F.DASH);
  assert.strictEqual(F.winPct(5, -1), F.DASH);
  assert.strictEqual(F.winPct(null, 5), F.DASH);
  assert.strictEqual(F.winPct(5, null), F.DASH);
  assert.strictEqual(F.winPct(NaN, 5), F.DASH);
});

// ---- ordinal (DOMAIN: integer 1..30) ----

test('ordinal: standard suffixes', () => {
  assert.strictEqual(F.ordinal(1), '1st');
  assert.strictEqual(F.ordinal(2), '2nd');
  assert.strictEqual(F.ordinal(3), '3rd');
  assert.strictEqual(F.ordinal(4), '4th');
  assert.strictEqual(F.ordinal(11), '11th');
  assert.strictEqual(F.ordinal(12), '12th');
  assert.strictEqual(F.ordinal(13), '13th');
  assert.strictEqual(F.ordinal(21), '21st');
  assert.strictEqual(F.ordinal(22), '22nd');
  assert.strictEqual(F.ordinal(23), '23rd');
  assert.strictEqual(F.ordinal(30), '30th');
});
test('ordinal: out-of-domain → DASH', () => {
  assert.strictEqual(F.ordinal(0), F.DASH);
  assert.strictEqual(F.ordinal(-1), F.DASH);
  assert.strictEqual(F.ordinal(31), F.DASH);
  assert.strictEqual(F.ordinal(1.5), F.DASH);
  assert.strictEqual(F.ordinal(null), F.DASH);
  assert.strictEqual(F.ordinal(undefined), F.DASH);
  assert.strictEqual(F.ordinal(NaN), F.DASH);
  assert.strictEqual(F.ordinal('5'), '5th');   // coerces, valid
  assert.strictEqual(F.ordinal('abc'), F.DASH);
  assert.strictEqual(F.ordinal(Infinity), F.DASH);
});

// ---- rankTier (DOMAIN: rank 1..30 → "m1".."m5"; out-of-domain → '') ----

test('rankTier: each band returns correct class', () => {
  assert.strictEqual(F.rankTier(1), 'm1');
  assert.strictEqual(F.rankTier(5), 'm1');
  assert.strictEqual(F.rankTier(6), 'm2');
  assert.strictEqual(F.rankTier(10), 'm2');
  assert.strictEqual(F.rankTier(11), 'm3');
  assert.strictEqual(F.rankTier(20), 'm3');
  assert.strictEqual(F.rankTier(21), 'm4');
  assert.strictEqual(F.rankTier(25), 'm4');
  assert.strictEqual(F.rankTier(26), 'm5');
  assert.strictEqual(F.rankTier(30), 'm5');
});
test('rankTier: out-of-domain → empty string (CSS neutral)', () => {
  assert.strictEqual(F.rankTier(0), '');
  assert.strictEqual(F.rankTier(31), '');
  assert.strictEqual(F.rankTier(null), '');
  assert.strictEqual(F.rankTier(NaN), '');
});

// ---- rankLeftPercent (DOMAIN: any input; clamps; out-of-domain → 50) ----

test('rankLeftPercent: endpoints map to 0%/100%', () => {
  assert.strictEqual(F.rankLeftPercent(1), 0);
  assert.strictEqual(F.rankLeftPercent(30), 100);
});
test('rankLeftPercent: midpoint near 50%', () => {
  const mid = F.rankLeftPercent(15);
  assert.ok(mid > 48 && mid < 52, 'rank 15 ≈ 50% got ' + mid);
});
test('rankLeftPercent: clamps out-of-range numeric inputs', () => {
  assert.strictEqual(F.rankLeftPercent(-5), 0);
  assert.strictEqual(F.rankLeftPercent(100), 100);
});
test('rankLeftPercent: non-numeric → 50 (neutral)', () => {
  assert.strictEqual(F.rankLeftPercent(null), 50);
  assert.strictEqual(F.rankLeftPercent(NaN), 50);
  assert.strictEqual(F.rankLeftPercent('x'), 50);
});

// ---- shortMonthDay ----

test('shortMonthDay: valid ISO date → localized format', () => {
  const s = F.shortMonthDay('2026-05-24T00:00:00Z');
  assert.ok(typeof s === 'string' && s.length > 2, 'got ' + s);
  assert.notStrictEqual(s, F.DASH);
});
test('shortMonthDay: out-of-domain → DASH', () => {
  assert.strictEqual(F.shortMonthDay(null), F.DASH);
  assert.strictEqual(F.shortMonthDay(''), F.DASH);
  assert.strictEqual(F.shortMonthDay('not a date'), F.DASH);
  assert.strictEqual(F.shortMonthDay(undefined), F.DASH);
  assert.strictEqual(F.shortMonthDay(123), F.DASH);  // not a string
});

// ---- slashDate ----

test('slashDate: valid ISO → "M/D"', () => {
  const s = F.slashDate('2026-05-24T00:00:00Z');
  assert.match(s, /^\d{1,2}\/\d{1,2}$/, 'got ' + s);
});
test('slashDate: out-of-domain → DASH', () => {
  assert.strictEqual(F.slashDate(null), F.DASH);
  assert.strictEqual(F.slashDate(''), F.DASH);
  assert.strictEqual(F.slashDate('bad'), F.DASH);
});

// ---- relativeAge ----

test('relativeAge: past → relative phrase', () => {
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86400 * 1000).toISOString();
  assert.match(F.relativeAge(oneHourAgo), /h ago$|just now$/);
  assert.match(F.relativeAge(oneDayAgo), /d ago$/);
});
test('relativeAge: future → "soon" (clock skew tolerant)', () => {
  const fut = new Date(Date.now() + 86400 * 1000).toISOString();
  assert.strictEqual(F.relativeAge(fut), 'soon');
});
test('relativeAge: invalid → empty string', () => {
  assert.strictEqual(F.relativeAge(null), '');
  assert.strictEqual(F.relativeAge(''), '');
  assert.strictEqual(F.relativeAge('not iso'), '');
});

// ---- initials ----

test('initials: standard two-part name', () => {
  assert.strictEqual(F.initials('Bo Bichette'), 'BB');
  assert.strictEqual(F.initials('Vladimir Guerrero'), 'VG');
});
test('initials: strips Jr./Sr./II/III/IV', () => {
  assert.strictEqual(F.initials('Vladimir Guerrero Jr.'), 'VG');
  assert.strictEqual(F.initials('George Springer III'), 'GS');
});
test('initials: single name → 1 letter', () => {
  assert.strictEqual(F.initials('Cher'), 'C');
});
test('initials: out-of-domain → empty string', () => {
  assert.strictEqual(F.initials(null), '');
  assert.strictEqual(F.initials(''), '');
  assert.strictEqual(F.initials('   '), '');
  assert.strictEqual(F.initials(123), '');
});

// ---- slugify ----

test('slugify: standard ASCII name', () => {
  assert.strictEqual(F.slugify('Bo Bichette'), 'bo-bichette');
  assert.strictEqual(F.slugify("O'Hoppe"), 'o-hoppe');
});
test('slugify: accented characters fold to ASCII', () => {
  assert.strictEqual(F.slugify('José Berríos'), 'jose-berrios');
});
test('slugify: out-of-domain → empty string', () => {
  assert.strictEqual(F.slugify(null), '');
  assert.strictEqual(F.slugify(''), '');
  assert.strictEqual(F.slugify(undefined), '');
});

// ---- DASH constant is exported ----

test('DASH: canonical missing-data string', () => {
  assert.strictEqual(F.DASH, '—');
});
