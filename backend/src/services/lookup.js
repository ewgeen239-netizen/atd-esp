import { AppError, RateLimitError } from '../lib/errors.js';
import { classifyCode } from '../lib/ean.js';
import { autodocSearchUrl } from '../providers/autodoc.js';

/**
 * Lookup pipeline:
 *   1. validate + classify the code (EAN check digit, article normalization)
 *   2. local catalog (SQLite)                       <- primary path, no network
 *   3. external providers in configured order, each behind cache + throttle
 * Products found by a real external source are saved to the local catalog
 * (enrichment), so the next scan of the same code never leaves the server.
 */
export class LookupService {
  constructor({ repo, providers, autodocBaseUrl, cacheTtlHours, cacheNegativeTtlHours }) {
    this.repo = repo;
    this.providers = providers;
    this.autodocBaseUrl = autodocBaseUrl;
    this.cacheTtlHours = cacheTtlHours;
    this.cacheNegativeTtlHours = cacheNegativeTtlHours;
  }

  classify(raw, type = 'auto') {
    const c = classifyCode(raw, { forceType: type });
    if (!c.ok) {
      const status = c.error === 'EMPTY' ? 400 : 422;
      throw new AppError(status, c.error, c.message, {
        value: c.value,
        expectedCheckDigit: c.expectedCheckDigit,
        autodocSearchUrl: c.value ? autodocSearchUrl(this.autodocBaseUrl, c.value) : undefined,
      });
    }
    return c;
  }

  async lookup(raw, { type = 'auto', refresh = false } = {}) {
    const code = this.classify(raw, type);
    const base = {
      code: code.value,
      codeType: code.type,
      autodocSearchUrl: autodocSearchUrl(this.autodocBaseUrl, code.value),
    };

    if (!refresh) {
      const local = this.repo.findProducts(code);
      if (local.length) {
        return { ...base, found: true, source: 'local', cached: false, product: local[0], alternatives: local.slice(1, 6), warnings: [] };
      }
    }

    const warnings = [];
    let rateLimited = null;
    for (const provider of this.providers) {
      const key = `${provider.name}:${code.type}:${code.normalized}`;
      if (refresh) this.repo.deleteCache(key);
      const cached = this.repo.getCache(key);
      if (cached) {
        if (cached.found) {
          return { ...base, found: true, source: provider.name, cached: true, product: cached.product, alternatives: [], warnings };
        }
        continue; // known miss for this provider, try the next one
      }

      let product;
      try {
        product = await provider.lookup(code);
      } catch (err) {
        warnings.push({ provider: provider.name, code: err.code || 'ERROR', message: err.message });
        if (err instanceof RateLimitError) rateLimited = err;
        continue; // errors are never cached: we did not learn anything about the code
      }

      if (!product) {
        this.repo.setCache(key, null, this.cacheNegativeTtlHours);
        continue;
      }

      const { match, ...data } = product;
      let saved = data;
      if (provider.name !== 'mock') {
        // Enrichment: real external data becomes part of the local catalog.
        saved = this.repo.upsertProduct({ ...data, source: provider.name }).product;
      }
      this.repo.setCache(key, saved, this.cacheTtlHours);
      return { ...base, found: true, source: provider.name, cached: false, match, product: saved, alternatives: [], warnings };
    }

    if (rateLimited) {
      throw new AppError(429, 'RATE_LIMITED', rateLimited.message, { ...base, retryAfter: rateLimited.retryAfter, warnings });
    }
    return { ...base, found: false, source: null, product: null, alternatives: [], warnings };
  }
}
