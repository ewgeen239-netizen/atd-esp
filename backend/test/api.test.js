import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config as baseConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { Throttle } from '../src/lib/throttle.js';
import { AutodocProvider } from '../src/providers/autodoc.js';
import { MockProvider } from '../src/providers/mock.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Fake autodoc.pl: routes by URL, records every request. */
function fakeSite(routes) {
  const calls = [];
  const fetchHtml = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const key = u.pathname + u.search;
    const hit = routes[key] ?? routes[u.pathname];
    if (!hit) return { status: 404, url, html: 'not found' };
    return { status: 200, url, ...hit };
  };
  return { calls, fetchHtml };
}

function makeAutodoc(site, overrides = {}) {
  return new AutodocProvider({
    name: 'autodoc',
    baseUrl: 'https://www.autodoc.pl',
    userAgent: 'TestAgent/1.0',
    respectRobots: true,
    throttle: new Throttle({ minIntervalMs: 0, dailyLimit: 100, maxQueue: 5, cooldownMinutes: 15 }),
    fetchHtml: site.fetchHtml,
    ...overrides,
  });
}

let server;
let base;
let repo;
let site;

before(async () => {
  site = fakeSite({
    '/robots.txt': { html: 'User-agent: *\nDisallow: /cart\n' },
    '/search?keyword=5050063083767': { html: fixture('search.html') },
    '/blue-print/332773': { html: fixture('product-jsonld.html') },
    '/search?keyword=4006381333931': { html: '<html><body>Brak wyników</body></html>' },
  });
  repo = openDb(':memory:');
  const config = { ...baseConfig, apiRateLimitPerMin: 1000, basicAuthUser: '', basicAuthPass: '' };
  const { app } = createApp(config, { repo, providers: [makeAutodoc(site), new MockProvider()] });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  repo?.close();
});

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text(), headers: res.headers };
};
const send = async (method, path, body, type = 'application/json') => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('external lookup enriches the local catalog, second scan stays local', async () => {
  const r1 = await get('/api/lookup?code=5050063083767');
  assert.equal(r1.status, 200);
  assert.equal(r1.body.source, 'autodoc');
  assert.equal(r1.body.match, 'exact');
  assert.equal(r1.body.product.article_no, 'ADC42111');
  assert.ok(r1.body.product.id, 'saved to catalog');
  const callsAfterFirst = site.calls.length;
  assert.deepEqual(site.calls.map((u) => new URL(u).pathname), ['/robots.txt', '/search', '/blue-print/332773']);

  const r2 = await get('/api/lookup?code=5050063083767');
  assert.equal(r2.body.source, 'local');
  assert.equal(site.calls.length, callsAfterFirst, 'no new outbound request');
});

test('miss on autodoc falls through to the next provider and is cached negatively', async () => {
  const r = await get('/api/lookup?code=4006381333931');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
  assert.match(r.body.autodocSearchUrl, /search\?keyword=4006381333931/);
  const n = site.calls.length;
  await get('/api/lookup?code=4006381333931');
  assert.equal(site.calls.length, n, 'negative cache prevents a second request');
});

test('mock provider answers demo codes', async () => {
  // autodoc has no route for this search -> 404 -> mock
  const r = await get('/api/lookup?code=2009999010012');
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'mock');
  assert.equal(r.body.product.id, undefined, 'mock data is never saved to the catalog');
});

test('invalid EAN -> 422 with expected check digit, logged as invalid scan', async () => {
  const r = await get('/api/lookup?code=5901234123458');
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'INVALID_EAN');
  assert.equal(r.body.error.expectedCheckDigit, '7');
  const scans = await get('/api/scans?type=invalid');
  assert.ok(scans.body.items.some((s) => s.code === '5901234123458'));
});

test('empty code -> 400', async () => {
  const r = await get('/api/lookup?code=');
  assert.equal(r.status, 400);
});

test('products CRUD + duplicate EAN + lookup by OEM', async () => {
  const c = await send('POST', '/api/products', { name: 'Test pad', brand: 'TST', article_no: 'tp-1', ean: '5901234123457', oem_numbers: 'AB 123, CD-456', price: '12,50' });
  assert.equal(c.status, 201);
  assert.equal(c.body.price, 12.5);
  assert.deepEqual(c.body.oem_numbers, ['AB 123', 'CD-456']);

  const dup = await send('POST', '/api/products', { name: 'Dup', ean: '5901234123457' });
  assert.equal(dup.status, 409);

  const badEan = await send('POST', '/api/products', { name: 'Bad', ean: '5901234123458' });
  assert.equal(badEan.status, 422);

  const byOem = await get('/api/lookup?code=cd456&log=0');
  assert.equal(byOem.body.product.id, c.body.id);

  const u = await send('PUT', `/api/products/${c.body.id}`, { price: 15 });
  assert.equal(u.body.price, 15);
  assert.equal(u.body.name, 'Test pad');

  const d = await send('DELETE', `/api/products/${c.body.id}`);
  assert.equal(d.status, 204);
});

test('CSV import with PL headers and formula-injection-safe export', async () => {
  const csv = 'nazwa;marka;numer artykułu;ean;cena\n=HYPERLINK("x");BOSCH;0 986 494 294;4047024123456;99,90\nBez kodu;X;;;\n';
  // 4047024123456 has a wrong check digit on purpose
  const r = await send('POST', '/api/products/import', csv, 'text/csv');
  assert.equal(r.status, 200);
  assert.equal(r.body.errors.length, 2);
  const ok = 'nazwa;marka;numer artykułu;cena\n=HYPERLINK("x");BOSCH;0 986 494 294;99,90\n';
  const r2 = await send('POST', '/api/products/import', ok, 'text/csv');
  assert.equal(r2.body.inserted, 1);
  const exp = await get('/api/products/export.csv');
  assert.match(exp.body, /'=HYPERLINK/);
});

test('history filters, stats and CSV export', async () => {
  const all = await get('/api/scans?limit=1000');
  assert.ok(all.body.total >= 4);
  const found = await get('/api/scans?found=1');
  assert.ok(found.body.items.every((s) => s.found));
  const future = await get(`/api/scans?from=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`);
  assert.equal(future.body.total, 0);
  const bad = await get('/api/scans?from=yesterday-ish');
  assert.equal(bad.status, 400);

  const stats = await get('/api/stats');
  assert.equal(stats.body.total, all.body.total);

  const csv = await get('/api/scans/export.csv?tz=Europe/Warsaw');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="scans-/);
  assert.ok(csv.body.startsWith('time_local;time_utc;code'));
  // fetch().text() strips the BOM, so check raw bytes: Excel needs it to detect UTF-8
  const raw = new Uint8Array(await (await fetch(`${base}/api/scans/export.csv`)).arrayBuffer());
  assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('robots.txt disallow blocks the provider without hitting the page', async () => {
  const blockedSite = fakeSite({ '/robots.txt': { html: 'User-agent: *\nDisallow: /search\n' } });
  const p = makeAutodoc(blockedSite);
  await assert.rejects(p.lookup({ type: 'ean', value: '5050063083767', normalized: '5050063083767' }), { code: 'UPSTREAM_BLOCKED' });
  assert.deepEqual(blockedSite.calls.map((u) => new URL(u).pathname), ['/robots.txt']);
});

test('403 / captcha trips the circuit breaker', async () => {
  const s = fakeSite({ '/robots.txt': { html: '' }, '/search': { status: 403, html: 'Access denied' } });
  const p = makeAutodoc(s);
  const code = { type: 'ean', value: '5050063083767', normalized: '5050063083767' };
  await assert.rejects(p.lookup(code), { code: 'UPSTREAM_BLOCKED' });
  const n = s.calls.length;
  await assert.rejects(p.lookup(code), /на паузе/);
  assert.equal(s.calls.length, n, 'no request during cooldown');
});

test('throttle enforces queue size and daily limit', async () => {
  const t = new Throttle({ minIntervalMs: 50, dailyLimit: 2, maxQueue: 1, cooldownMinutes: 1 });
  const first = t.schedule(async () => 1);
  assert.throws(() => t.schedule(async () => 2), { code: 'RATE_LIMITED' });
  assert.equal(await first, 1);
  await t.schedule(async () => 3);
  assert.throws(() => t.schedule(async () => 4), /дневной лимит/);
});

test('unknown API route -> JSON 404, security headers present', async () => {
  const r = await get('/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});
