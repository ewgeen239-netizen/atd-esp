import { Throttle } from '../lib/throttle.js';
import { AutodocProvider, directFetcher } from '../providers/autodoc.js';
import { MockProvider } from '../providers/mock.js';
import { scraperFetcher } from '../providers/scraper.js';

/** Build the ordered list of external providers from config. */
export function buildProviders(config) {
  // One throttle for everything that ends up on autodoc.pl.
  const throttle = new Throttle(config.external);
  const direct = directFetcher({ ...config.autodoc, timeoutMs: config.external.timeoutMs });
  const providers = [];

  for (const name of config.externalProviders) {
    if (name === 'autodoc') {
      providers.push(new AutodocProvider({ ...config.autodoc, name: 'autodoc', throttle, fetchHtml: direct }));
    } else if (name === 'scraper') {
      try {
        const fetchHtml = scraperFetcher({ ...config.scraper, timeoutMs: config.external.timeoutMs });
        providers.push(
          new AutodocProvider({ ...config.autodoc, name: 'scraper', throttle, fetchHtml, robotsFetch: direct }),
        );
      } catch (err) {
        console.warn(`[providers] scraper disabled: ${err.message}`);
      }
    } else if (name === 'mock') {
      providers.push(new MockProvider());
    } else if (name && name !== 'local') {
      console.warn(`[providers] unknown provider "${name}" ignored`);
    }
  }
  return { providers, throttle };
}
