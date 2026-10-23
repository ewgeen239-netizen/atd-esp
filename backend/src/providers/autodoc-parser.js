// Best-effort extraction of product data from AutoDoc.pl HTML.
//
// AutoDoc product URLs look like https://www.autodoc.pl/<brand-slug>/<numeric-id>
// (e.g. /blue-print/332773). Product pages show "Numer artykułu", "Numer EAN",
// price, availability and an "OE numbers" cross-reference block. Markup changes
// over time, so we try, in order: schema.org JSON-LD -> microdata -> OpenGraph ->
// visible Polish labels. Every field is optional except the name.

import { isValidGtin, toGtin13 } from '../lib/ean.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|td|th|h\d|dt|dd|span)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function asArray(v) {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function hasType(node, type) {
  return asArray(node?.['@type']).some((t) => String(t).toLowerCase() === type.toLowerCase());
}

function collectJsonLd(html) {
  const nodes = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim());
      const stack = asArray(data);
      while (stack.length) {
        const n = stack.pop();
        if (!n || typeof n !== 'object') continue;
        nodes.push(n);
        if (n['@graph']) stack.push(...asArray(n['@graph']));
      }
    } catch {
      /* ignore malformed blocks */
    }
  }
  return nodes;
}

function availabilityLabel(v) {
  const s = String(v ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('instock') || (s.includes('dostępn') && !s.includes('niedost'))) return 'В наличии';
  if (s.includes('outofstock') || s.includes('niedost')) return 'Нет в наличии';
  if (s.includes('preorder') || s.includes('backorder')) return 'Под заказ';
  if (s.includes('limited')) return 'Мало на складе';
  return decodeEntities(String(v)).trim().slice(0, 60);
}

function pickImage(img) {
  const first = asArray(img)[0];
  if (!first) return null;
  return typeof first === 'string' ? first : first.url || first.contentUrl || null;
}

function fromJsonLd(nodes) {
  const p = nodes.find((n) => hasType(n, 'Product'));
  if (!p) return null;
  const offers = asArray(p.offers).flatMap((o) => (hasType(o, 'AggregateOffer') ? [o, ...asArray(o.offers)] : [o]));
  const offer = offers.find((o) => o && (o.price ?? o.lowPrice) !== undefined) || offers[0] || {};
  const brand = typeof p.brand === 'string' ? p.brand : p.brand?.name;
  return {
    name: p.name,
    brand,
    article_no: p.mpn || p.sku,
    ean: p.gtin13 || p.gtin || p.gtin12 || p.gtin14 || p.gtin8,
    price: offer.price ?? offer.lowPrice,
    currency: offer.priceCurrency,
    availability: availabilityLabel(offer.availability),
    image_url: pickImage(p.image),
    product_url: p.url || offer.url,
  };
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3]) : null;
}

function fromMicrodata(html) {
  const out = {};
  const re = /<[a-z0-9]+\b[^>]*\sitemprop=["']([a-zA-Z0-9]+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const prop = m[1];
    if (out[prop] !== undefined) continue;
    let value = attr(m[0], 'content') ?? attr(m[0], 'href') ?? attr(m[0], 'src');
    if (value === null) {
      const rest = html.slice(re.lastIndex, re.lastIndex + 400);
      value = htmlToText(rest.split(/<\//)[0]);
    }
    if (value) out[prop] = value.trim();
  }
  if (!Object.keys(out).length) return null;
  return {
    name: out.name,
    brand: out.brand,
    article_no: out.mpn || out.sku,
    ean: out.gtin13 || out.gtin || out.gtin12 || out.gtin8,
    price: out.price,
    currency: out.priceCurrency,
    availability: availabilityLabel(out.availability),
    image_url: out.image,
  };
}

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[:.]/g, '\\$&')}["'][^>]*>`, 'i');
  const m = html.match(re);
  return m ? attr(m[0], 'content') : null;
}

function fromOpenGraph(html) {
  const title = meta(html, 'og:title') || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null);
  return {
    name: title ? decodeEntities(title).trim() : null,
    image_url: meta(html, 'og:image'),
    price: meta(html, 'product:price:amount'),
    currency: meta(html, 'product:price:currency'),
    product_url: meta(html, 'og:url') || html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)/)?.[1],
  };
}

function fromText(text) {
  const out = {};
  const ean = text.match(/(?:Numer\s+)?EAN\s*[:\-]?\s*(\d{8,14})\b/i);
  if (ean) out.ean = ean[1];
  const art = text.match(/Numer\s+artykułu\s*[:\-]?\s*([A-Z0-9][A-Z0-9 .\-/]{1,30}?)(?=\s*(?:\n|EAN|Numer|$))/i);
  if (art) out.article_no = art[1].trim();
  const brand = text.match(/Producent\s*[:\-]?\s*([^\n]{2,40})/i);
  if (brand) out.brand = brand[1].trim();
  const price = text.match(/(\d{1,6}(?:[  ]\d{3})*[,.]\d{2})\s*(zł|PLN|€|EUR)/i);
  if (price) {
    out.price = price[1].replace(/[  ]/g, '').replace(',', '.');
    out.currency = /zł|pln/i.test(price[2]) ? 'PLN' : 'EUR';
  }
  if (/\bniedostępn/i.test(text)) out.availability = 'Нет в наличии';
  else if (/\bw magazynie\b|\bdostępny\b|\bna stanie\b/i.test(text)) out.availability = 'В наличии';

  // OE cross-reference block: "Numery OE" / "Numer OE" / "Numery porównawcze OE"
  const oe = text.match(/Numer(?:y)?\s+(?:porównawcze\s+)?OE[MN]?\b[^\n]*\n([\s\S]{0,1500})/i);
  if (oe) {
    const block = oe[1].split(/\n(?:Pasuje do|Opinie|Opis|Dane techniczne|Analogi|Zamienniki)\b/i)[0];
    const nums = [];
    for (const line of block.split('\n')) {
      const t = line.trim();
      // "BMW 11 42 7 953 129" -> "11 42 7 953 129"; keep entries containing digits
      const m = t.match(/^(?:[A-ZĄĆĘŁŃÓŚŹŻ][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż\- ]{1,20}?\s)?([A-Z0-9][A-Z0-9 .\-/]{3,30})$/);
      if (m && /\d/.test(m[1])) nums.push(m[1].trim());
      if (nums.length >= 30) break;
    }
    if (nums.length) out.oem_numbers = nums;
  }
  return out;
}

function merge(...parts) {
  const out = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (out[k] === undefined || out[k] === null || out[k] === '') {
        if (v !== undefined && v !== null && v !== '') out[k] = v;
      }
    }
  }
  return out;
}

function absolutize(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

/** True when the page is a single-product page. */
export function looksLikeProductPage(html) {
  return collectJsonLd(html).some((n) => hasType(n, 'Product')) || /itemtype=["'][^"']*schema\.org\/Product["']/i.test(html);
}

/** Parse one product page. Returns null when nothing usable was found. */
export function parseProductPage(html, pageUrl) {
  const text = htmlToText(html);
  const p = merge(fromJsonLd(collectJsonLd(html)), fromMicrodata(html), fromText(text), fromOpenGraph(html));
  if (!p.name) return null;

  const clean = (s) => (s === undefined || s === null ? null : decodeEntities(String(s)).replace(/\s+/g, ' ').trim() || null);
  let ean = clean(p.ean)?.replace(/\D/g, '') || null;
  const notes = [];
  if (ean && !isValidGtin(ean)) {
    notes.push(`EAN на странице не прошёл проверку: ${clean(p.ean)}`);
    ean = null;
  }
  const price = p.price !== undefined && p.price !== null ? Number(String(p.price).replace(',', '.')) : null;
  return {
    name: clean(p.name).replace(/\s*[|–-]\s*AUTODOC.*$/i, '').slice(0, 300),
    brand: clean(p.brand),
    article_no: clean(p.article_no),
    ean: ean ? toGtin13(ean) : null,
    oem_numbers: Array.isArray(p.oem_numbers) ? p.oem_numbers : [],
    price: Number.isFinite(price) ? price : null,
    currency: clean(p.currency)?.toUpperCase() || null,
    availability: clean(p.availability),
    image_url: absolutize(clean(p.image_url), pageUrl),
    product_url: absolutize(clean(p.product_url), pageUrl) || pageUrl,
    notes: notes.join('; ') || null,
  };
}

// Paths that look like /<slug>/<number> but are not product pages.
const NON_PRODUCT_SLUGS = new Set(['czesci', 'samochody', 'car-parts', 'search', 'blog', 'info', 'oferty', 'opony', 'akcesoria']);

/** Extract product page URLs from a search results page (deduplicated, in page order). */
export function parseSearchResults(html, baseUrl, max = 5) {
  const origin = new URL(baseUrl).origin;
  const host = new URL(baseUrl).host.replace(/\./g, '\\.');
  const re = new RegExp(`href=["'](?:https?://${host})?/([a-z0-9][a-z0-9-]{1,60})/(\\d{3,12})(?:[?#][^"']*)?["']`, 'gi');
  const urls = [];
  let m;
  while ((m = re.exec(html)) && urls.length < max) {
    if (NON_PRODUCT_SLUGS.has(m[1].toLowerCase())) continue;
    const url = `${origin}/${m[1].toLowerCase()}/${m[2]}`;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Heuristics for anti-bot / block pages that may come back with HTTP 200. */
export function detectBlockPage(html) {
  const head = String(html).slice(0, 20000).toLowerCase();
  return (
    head.includes('cf-challenge') ||
    head.includes('challenge-platform') ||
    head.includes('just a moment...') ||
    head.includes('attention required') ||
    head.includes('captcha') ||
    head.includes('access denied') ||
    head.includes('request blocked')
  );
}
