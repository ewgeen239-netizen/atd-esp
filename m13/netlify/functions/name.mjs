// Netlify Function: product name from AutoDoc.pl by number (Article ID / article number).
//
//   GET /api/name/251310  →  {"id":"251310","name":"VALEO Przełącznik świateł …","url":"https://www.autodoc.pl/valeo/…"}
//
// The browser cannot read autodoc.pl itself (no cross-origin access), so locations.html asks this
// function. One lookup = the search page + at most 2 product pages. Answers are cached on Netlify's
// CDN for 7 days per number ("not found" for 1 day), so a repeated Article ID never reaches AutoDoc.
// No dependencies; runs on Netlify's Node runtime (global fetch).

const BASE = 'https://www.autodoc.pl';
const UA = process.env.AUTODOC_USER_AGENT || 'M13-Warehouse-NameLookup/1.0 (AutoDoc Logistic M13; low volume, cached)';
const TIMEOUT_MS = 4000; // per request
const BUDGET_MS = 8500; // whole lookup: Netlify stops a function after 10 s

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const clean = (s) => decode(s).replace(/\s+/g, ' ').replace(/\s*[|–-]\s*AUTODOC.*$/i, '').trim();
const norm = (s) => String(s).toUpperCase().replace(/[^0-9A-Z]/g, '');

/** Product name and brand from a product page: schema.org JSON-LD, then og:title, then <title>/<h1>. */
export function productFromPage(html) {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const stack = [JSON.parse(m[1].trim())];
      while (stack.length) {
        const n = stack.pop();
        if (!n || typeof n !== 'object') continue;
        if (Array.isArray(n)) { stack.push(...n); continue; }
        if (n['@graph']) stack.push(...[].concat(n['@graph']));
        const types = [].concat(n['@type'] || []).map((t) => String(t).toLowerCase());
        if (types.includes('product') && n.name) {
          return { name: clean(n.name), brand: clean(typeof n.brand === 'string' ? n.brand : n.brand?.name || ''), sku: n.mpn || n.sku || '' };
        }
      }
    } catch { /* malformed block */ }
  }
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = og?.[1] || (h1 && h1[1].replace(/<[^>]+>/g, ' ')) || title?.[1];
  return raw ? { name: clean(raw), brand: '', sku: '' } : null;
}

const NON_PRODUCT = new Set(['czesci', 'samochody', 'car-parts', 'search', 'blog', 'info', 'oferty', 'opony', 'akcesoria', 'katalog']);
/** Product page URLs (/brand-slug/123456) from a search results page, in page order. */
export function productLinks(html, max = 5) {
  const out = [];
  for (const m of html.matchAll(/href=["'](?:https?:\/\/www\.autodoc\.pl)?\/([a-z0-9][a-z0-9-]{1,60})\/(\d{3,12})(?:[?#][^"']*)?["']/gi)) {
    if (NON_PRODUCT.has(m[1].toLowerCase())) continue;
    const url = `${BASE}/${m[1].toLowerCase()}/${m[2]}`;
    if (!out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

const isProductPage = (html) => /"@type"\s*:\s*"Product"/i.test(html) || /itemtype=["'][^"']*schema\.org\/Product/i.test(html);
const isBlocked = (status, html) => [401, 403, 429, 503].includes(status) ||
  /cf-challenge|challenge-platform|just a moment\.\.\.|captcha|access denied/i.test(String(html).slice(0, 20000));

class Blocked extends Error {}
async function get(url, fetchImpl, deadline) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(Math.max(300, Math.min(TIMEOUT_MS, deadline - Date.now()))),
  });
  const html = await res.text();
  if (isBlocked(res.status, html)) throw new Blocked(`HTTP ${res.status}`);
  return { status: res.status, url: res.url || url, html };
}

/** Look the number up on AutoDoc. Prefers a product whose page mentions the searched number. */
export async function lookupName(id, fetchImpl = fetch, deadline = Date.now() + BUDGET_MS) {
  const search = await get(`${BASE}/search?keyword=${encodeURIComponent(id)}`, fetchImpl, deadline);
  if (search.status === 404) return null;
  if (isProductPage(search.html)) { // exact match redirects straight to the product
    const p = productFromPage(search.html);
    return p && { ...p, url: search.url, exact: true };
  }
  const links = productLinks(search.html, 5);
  let first = null;
  for (const url of links.slice(0, 2)) {
    if (first && deadline - Date.now() < 1500) break; // keep the answer we have rather than time out
    const page = await get(url, fetchImpl, deadline);
    const p = productFromPage(page.html);
    if (!p) continue;
    const hit = { ...p, url: page.url };
    if (norm(page.html.replace(/<[^>]+>/g, ' ')).includes(norm(id))) return { ...hit, exact: true };
    first ??= { ...hit, exact: false };
  }
  return first;
}

const json = (status, body, cacheSeconds) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cacheSeconds ? `public, max-age=${Math.min(cacheSeconds, 3600)}` : 'no-store',
    // Netlify's CDN keeps the answer per URL, i.e. per number.
    ...(cacheSeconds ? { 'Netlify-CDN-Cache-Control': `public, durable, max-age=${cacheSeconds}, stale-while-revalidate=86400` } : {}),
  },
});

export default async (req, context) => {
  const id = decodeURIComponent(context?.params?.id || new URL(req.url).searchParams.get('id') || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.\-/ ]{2,29}$/.test(id)) return json(400, { error: 'bad_id', message: 'Номер: 3–30 символов, латиница/цифры' });
  try {
    const p = await lookupName(id);
    if (!p) return json(404, { id, error: 'not_found', message: 'На AutoDoc ничего не найдено' }, 86400);
    return json(200, { id, name: p.name, brand: p.brand || undefined, url: p.url, exact: p.exact }, 604800);
  } catch (err) {
    if (err instanceof Blocked) return json(502, { id, error: 'blocked', message: `AutoDoc не пустил запрос (${err.message})` });
    return json(502, { id, error: 'upstream', message: err.name === 'TimeoutError' ? 'AutoDoc не ответил вовремя' : String(err.message || err) });
  }
};

export const config = { path: '/api/name/:id' };
