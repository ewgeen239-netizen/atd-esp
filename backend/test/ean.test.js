import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyCode, computeCheckDigit, isValidGtin, normalizeArticle, toGtin13 } from '../src/lib/ean.js';

test('check digit for known GTINs', () => {
  assert.equal(computeCheckDigit('590123412345'), '7'); // GS1 example 5901234123457
  assert.equal(computeCheckDigit('400638133393'), '1'); // 4006381333931
  assert.equal(computeCheckDigit('9638507'), '4'); // EAN-8 96385074
  assert.equal(computeCheckDigit('03600029145'), '2'); // UPC-A 036000291452
});

test('isValidGtin', () => {
  assert.ok(isValidGtin('5901234123457'));
  assert.ok(isValidGtin('96385074'));
  assert.ok(isValidGtin('036000291452'));
  assert.ok(isValidGtin('05901234123457')); // GTIN-14
  assert.ok(!isValidGtin('5901234123458'));
  assert.ok(!isValidGtin('590123412345')); // 12 digits but not a valid UPC
  assert.ok(!isValidGtin('59012341234X'));
  assert.ok(!isValidGtin(''));
});

test('toGtin13 canonicalizes UPC-A and GTIN-14', () => {
  assert.equal(toGtin13('036000291452'), '0036000291452');
  assert.equal(toGtin13('05901234123457'), '5901234123457');
  assert.equal(toGtin13('5901234123457'), '5901234123457');
});

test('classifyCode', () => {
  assert.deepEqual(classifyCode(' 5901234123457 '), { ok: true, type: 'ean', value: '5901234123457', normalized: '5901234123457' });
  const bad = classifyCode('5901234123458');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'INVALID_EAN');
  assert.equal(bad.expectedCheckDigit, '7');
  // 10 digits: Bosch-style article number
  assert.equal(classifyCode('0 986 494 294').type, 'article');
  assert.equal(classifyCode('0 986 494 294').normalized, '0986494294');
  // 8 digits with a wrong check digit are treated as an article number, not an error
  assert.equal(classifyCode('12345678').type, 'article');
  assert.equal(classifyCode('W 712/75').normalized, 'W71275');
  assert.equal(classifyCode('').error, 'EMPTY');
  assert.equal(classifyCode('<script>').error, 'INVALID_CODE');
  // forced article search for a "bad EAN"
  assert.equal(classifyCode('5901234123458', { forceType: 'article' }).type, 'article');
});

test('normalizeArticle', () => {
  assert.equal(normalizeArticle('hu 816-x'), 'HU816X');
  assert.equal(normalizeArticle(null), '');
});
