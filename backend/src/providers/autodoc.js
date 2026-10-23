import { UpstreamBlockedError, UpstreamError, RateLimitError } from '../lib/errors.js';
import { gtinVariants, normalizeArticle } from '../lib/ean.js';
import { detectBlockPage, looksLikeProductPage, parseProductPage, parseSearchResults } from './autodoc-parser.js';
import { isAllowed, parseRobots } from './robots.js';

export function autodocSearchUrl(baseUrl, code) {
  return `${baseUrl}/search?keyword=${encodeURIComponent(code)}`;
}

/** Direct HTTPS fetch with an honest User-Agent and a timeout. */
export function directFetcher({ userAgent, acceptLanguage, timeoutMs }) {
  return async function fetchHtml(url) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': acceptLanguage,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, url: res.url || url, html: await res.text(), retryAfter: res.headers.get('retry-after') };
  };
}

/**
 * AutoDoc.pl lookup: search page -> first product page -> parsed product.
 * Uses at most 2 requests per code, all through the shared throttle.
 * The same class powers the "scraper" provider with a different fetcher.
 */
export class AutodocProvider {
  constructor({ name = 'autodoc', baseUrl, userAgent, respectRobots, throttle, fetchHtml, robotsFetch = fetchHtml }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.userAgent = userAgent;
    this.respectRobots = respectRobots;
    this.throttle = throttle;
    this.fetchHtml = fetchHtml;
    this.robots = null;
    this.robotsFetchedAt = 0;
    this.robotsFetch = robotsFetch;
  }

  async #ensureRobots() {
    if (!this.respectRobots) return;
    if (this.robots && Date.now() - this.robotsFetchedAt < 24 * 3_600_000) return;
    try {
      const r = await this.throttle.schedule(() => this.robotsFetch(`${this.baseUrl}/robots.txt`));
      this.robots = r.status === 200 ? parseRobots(r.html) : [];
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof UpstreamBlockedError) throw err;
      // Unknown robots policy: be conservative only if we never had one.
      if (!this.robots) throw new UpstreamError(`Не удалось прочитать robots.txt: ${err.message}`);
    }
    this.robotsFetchedAt = Date.now();
  }

  #assertAllowed(url) {
    if (!this.respectRobots || !this.robots) return;
    const u = new URL(url);
    if (!isAllowed(this.robots, this.userAgent, u.pathname + u.search)) {
      throw new UpstreamBlockedError(
        `robots.txt сайта запрещает ${u.pathname} для автоматических запросов. ` +
          'Используйте ручной поиск по ссылке или локальный каталог (см. docs/AUTODOC.md).',
      );
    }
  }

  async #get(url) {
    this.#assertAllowed(url);
    let r;
    try {
      r = await this.throttle.schedule(() => this.fetchHtml(url));
    } catch (err) {
      if (err instanceof RateLimitError || err instanceof UpstreamBlockedError || err instanceof UpstreamError) throw err;
      throw new UpstreamError(`${this.name}: сеть/таймаут (${err.name === 'TimeoutError' ? 'timeout' : err.message})`);
    }
    if (r.status === 429) {
      const retry = Number(r.retryAfter) || 600;
      this.throttle.trip('HTTP 429 от сайта', retry * 1000);
      throw new RateLimitError(`${this.name}: сайт ограничил частоту запросов`, retry);
    }
    if (r.status === 403 || r.status === 401 || detectBlockPage(r.html)) {
      this.throttle.trip(`доступ заблокирован (HTTP ${r.status})`);
      throw new UpstreamBlockedError(`${this.name}: доступ заблокирован (HTTP ${r.status}, антибот/капча)`);
    }
    if (r.status === 404) return { ...r, notFound: true };
    if (r.status >= 400) throw new UpstreamError(`${this.name}: HTTP ${r.status}`);
    return r;
  }

  /** @returns {Promise<object|null>} product or null when the site has no match */
  async lookup(code) {
    await this.#ensureRobots();
    const query = code.type === 'ean' ? code.value : code.value.trim();
    const search = await this.#get(autodocSearchUrl(this.baseUrl, query));
    if (search.notFound) return null;

    let page = search;
    if (!looksLikeProductPage(search.html)) {
      const urls = parseSearchResults(search.html, this.baseUrl, 3);
      if (!urls.length) return null;
      page = await this.#get(urls[0]);
      if (page.notFound) return null;
    }
    const product = parseProductPage(page.html, page.url);
    if (!product) throw new UpstreamError(`${this.name}: страница товара не распознана (изменилась разметка?)`);

    let match = 'probable';
    if (code.type === 'ean' && product.ean && gtinVariants(code.value).includes(product.ean)) match = 'exact';
    if (code.type === 'article' && normalizeArticle(product.article_no) === code.normalized) match = 'exact';
    return { ...product, source: this.name, match };
  }
}
