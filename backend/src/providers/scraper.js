// Fetch AutoDoc pages through a third-party scraping API instead of directly.
// The page is then parsed by the same AutoDoc parser. Add a preset here to support
// another vendor; anything that takes a target URL and returns HTML works.
//
// NOTE: a scraping API changes *who* sends the request, not whether the site's
// Terms of Service allow it. See docs/AUTODOC.md before enabling.

const PRESETS = {
  scraperapi: {
    url: (target, key) =>
      `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&country_code=pl&url=${encodeURIComponent(target)}`,
  },
  zenrows: {
    url: (target, key) => `https://api.zenrows.com/v1/?apikey=${encodeURIComponent(key)}&url=${encodeURIComponent(target)}`,
  },
  piloterr: {
    url: (target) => `https://piloterr.com/api/v2/website/crawler?query=${encodeURIComponent(target)}`,
    headers: (key) => ({ 'x-api-key': key }),
  },
};

export const SCRAPER_PRESETS = Object.keys(PRESETS);

export function scraperFetcher({ provider, apiKey, urlTemplate, timeoutMs }) {
  let preset = PRESETS[provider];
  if (provider === 'custom') {
    if (!urlTemplate.includes('{url}')) throw new Error('SCRAPER_URL_TEMPLATE must contain {url}');
    preset = {
      url: (target, key) => urlTemplate.replaceAll('{url}', encodeURIComponent(target)).replaceAll('{key}', encodeURIComponent(key)),
    };
  }
  if (!preset) throw new Error(`Unknown SCRAPER_PROVIDER "${provider}". Use one of: ${SCRAPER_PRESETS.join(', ')}, custom`);
  if (!apiKey && provider !== 'custom') throw new Error('SCRAPER_API_KEY is required for the scraper provider');

  return async function fetchHtml(target) {
    const res = await fetch(preset.url(target, apiKey), {
      headers: { Accept: 'text/html,application/json', ...(preset.headers?.(apiKey) ?? {}) },
      signal: AbortSignal.timeout(Math.max(timeoutMs, 30000)), // rendering APIs are slow
    });
    const body = await res.text();
    let html = body;
    if ((res.headers.get('content-type') || '').includes('json')) {
      try {
        const data = JSON.parse(body);
        html = typeof data === 'string' ? data : data.html ?? data.content ?? data.body ?? data.result ?? body;
      } catch {
        /* keep raw body */
      }
    }
    // Scraper APIs report their own quota problems with 401/402/403/429.
    const status = res.status === 402 ? 429 : res.status;
    return { status, url: target, html: String(html), retryAfter: res.headers.get('retry-after') };
  };
}
