import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  detectBlockPage,
  looksLikeProductPage,
  parseProductPage,
  parseSearchResults,
} from '../src/providers/autodoc-parser.js';
import { isAllowed, parseRobots } from '../src/providers/robots.js';

// Synthetic fixtures modelled on the public structure of autodoc.pl pages
// (not copies of real pages). Re-check with `npm run probe` against the live site.
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parses a product page with JSON-LD', () => {
  const html = fixture('product-jsonld.html');
  assert.ok(looksLikeProductPage(html));
  const p = parseProductPage(html, 'https://www.autodoc.pl/blue-print/332773');
  assert.equal(p.name, 'BLUE PRINT Filtr oleju ADC42111');
  assert.equal(p.brand, 'BLUE PRINT');
  assert.equal(p.article_no, 'ADC42111');
  assert.equal(p.ean, '5050063083767');
  assert.equal(p.price, 23.49);
  assert.equal(p.currency, 'PLN');
  assert.equal(p.availability, 'В наличии');
  assert.equal(p.image_url, 'https://cdn.autodoc.example/thumb/332773.jpg');
  assert.equal(p.product_url, 'https://www.autodoc.pl/blue-print/332773');
  assert.deepEqual(p.oem_numbers, ['MD 069782', 'MD 135737', '15208-AA020']);
});

test('falls back to visible labels when there is no structured data', () => {
  const html = fixture('product-text.html');
  const p = parseProductPage(html, 'https://www.autodoc.pl/ate/954642');
  assert.equal(p.name, 'ATE Klocki hamulcowe 13.0460-7184.2');
  assert.equal(p.article_no, '13.0460-7184.2');
  assert.equal(p.ean, '4006633157346');
  assert.equal(p.brand, 'ATE');
  assert.equal(p.price, 1234.5);
  assert.equal(p.currency, 'PLN');
  assert.equal(p.availability, 'Нет в наличии');
});

test('drops an EAN that fails the check digit', () => {
  const html = '<title>X Filtr | AUTODOC</title><body>Numer artykułu: 13.0280.1 EAN: 1234567890123</body>';
  const p = parseProductPage(html, 'https://www.autodoc.pl/x/1');
  assert.equal(p.ean, null);
  assert.match(p.notes, /не прошёл проверку/);
  assert.equal(p.name, 'X Filtr');
});

test('extracts product links from search results', () => {
  const urls = parseSearchResults(fixture('search.html'), 'https://www.autodoc.pl');
  assert.deepEqual(urls, ['https://www.autodoc.pl/blue-print/332773', 'https://www.autodoc.pl/ridex/7781234']);
});

test('detects anti-bot pages', () => {
  assert.ok(detectBlockPage('<html><title>Just a moment...</title><div id="cf-challenge"></div></html>'));
  assert.ok(!detectBlockPage(fixture('product-jsonld.html')));
});

test('robots.txt evaluation', () => {
  const groups = parseRobots(`
User-agent: *
Disallow: /search
Allow: /search/help
Disallow: /*?sort=

User-agent: BadBot
Disallow: /
`);
  const ua = 'AutodocBarcodeScanner/0.1';
  assert.equal(isAllowed(groups, ua, '/search?keyword=123'), false);
  assert.equal(isAllowed(groups, ua, '/search/help'), true);
  assert.equal(isAllowed(groups, ua, '/blue-print/332773'), true);
  assert.equal(isAllowed(groups, ua, '/x?sort=price'), false);
  assert.equal(isAllowed(groups, 'BadBot/1.0', '/blue-print/1'), false);
  assert.equal(isAllowed([], ua, '/anything'), true);
});
