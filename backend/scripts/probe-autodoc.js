#!/usr/bin/env node
// One-off, polite check of what autodoc.pl returns for ONE code. Use it before
// enabling the autodoc/scraper provider, and again whenever parsing breaks.
//
//   npm run probe -- 4006633157346                 # robots.txt + search page only
//   npm run probe -- 4006633157346 --follow        # + first product page (2nd request)
//   npm run probe -- 4006633157346 --via=scraper   # through SCRAPER_PROVIDER / SCRAPER_API_KEY
//
// At most 3 requests, 5 s apart. Raw HTML is saved to data/probe/ for inspection
// (git-ignored). Does not touch the database.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../src/config.js';
import { classifyCode } from '../src/lib/ean.js';
import { detectBlockPage, looksLikeProductPage, parseProductPage, parseSearchResults } from '../src/providers/autodoc-parser.js';
import { autodocSearchUrl, directFetcher } from '../src/providers/autodoc.js';
import { isAllowed, parseRobots } from '../src/providers/robots.js';
import { scraperFetcher } from '../src/providers/scraper.js';

const args = process.argv.slice(2);
const code = args.find((a) => !a.startsWith('--'));
const follow = args.includes('--follow');
const via = args.find((a) => a.startsWith('--via='))?.split('=')[1] || 'direct';
const ignoreRobots = args.includes('--ignore-robots');

if (!code) {
  console.error('Usage: npm run probe -- <EAN|article> [--follow] [--via=scraper] [--ignore-robots]');
  process.exit(1);
}
const c = classifyCode(code);
if (!c.ok) {
  console.error(`✗ ${c.message}`);
  process.exit(1);
}

const outDir = path.join(ROOT_DIR, 'data', 'probe');
fs.mkdirSync(outDir, { recursive: true });
const direct = directFetcher({ ...config.autodoc, timeoutMs: config.external.timeoutMs });
const fetchPage = via === 'scraper' ? scraperFetcher({ ...config.scraper, timeoutMs: config.external.timeoutMs }) : direct;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(fetcher, url, label) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetcher(url);
  } catch (err) {
    console.log(`  ✗ ${label}: запрос не удался (${err.cause?.code || err.name}: ${err.message})`);
    process.exit(3);
  }
  const file = path.join(outDir, `${Date.now()}-${label}.html`);
  fs.writeFileSync(file, r.html);
  console.log(`  ${label}: HTTP ${r.status}, ${r.html.length} bytes, ${Date.now() - t0} ms -> ${path.relative(ROOT_DIR, file)}`);
  if (r.url !== url) console.log(`  redirected to ${r.url}`);
  if (r.status === 403 || r.status === 429 || detectBlockPage(r.html)) {
    console.log('  ✗ Похоже на блокировку/антибот. Не повторяйте запросы; используйте ручной ввод или локальный каталог.');
    process.exit(2);
  }
  return r;
}

console.log(`Code: ${c.value} (${c.type}), via: ${via}, UA: ${config.autodoc.userAgent}`);

console.log('1) robots.txt');
const robots = await get(direct, `${config.autodoc.baseUrl}/robots.txt`, 'robots');
const groups = robots.status === 200 ? parseRobots(robots.html) : [];
const searchUrl = autodocSearchUrl(config.autodoc.baseUrl, c.value);
const allowed = isAllowed(groups, config.autodoc.userAgent, new URL(searchUrl).pathname + new URL(searchUrl).search);
console.log(`  /search for our User-Agent: ${allowed ? 'allowed' : 'DISALLOWED'}`);
if (!allowed && !ignoreRobots) {
  console.log('  Остановлено: robots.txt запрещает поиск. Откройте ссылку вручную в браузере:');
  console.log(`  ${searchUrl}`);
  process.exit(0);
}

await sleep(5000);
console.log('2) search page');
const search = await get(fetchPage, searchUrl, 'search');
let page = search;
if (!looksLikeProductPage(search.html)) {
  const urls = parseSearchResults(search.html, config.autodoc.baseUrl);
  console.log(`  product links found: ${urls.length}`);
  urls.forEach((u) => console.log(`   - ${u}`));
  if (!urls.length) {
    console.log('  Нет ссылок на товары: либо товара нет, либо разметка поиска изменилась (см. сохранённый HTML).');
    process.exit(0);
  }
  if (!follow) {
    console.log('  Добавьте --follow, чтобы открыть первую карточку (ещё 1 запрос).');
    process.exit(0);
  }
  await sleep(5000);
  console.log('3) product page');
  page = await get(fetchPage, urls[0], 'product');
}

const product = parseProductPage(page.html, page.url);
console.log(product ? JSON.stringify(product, null, 2) : '  ✗ Карточка не распознана — пришлите сохранённый HTML, чтобы поправить парсер.');
