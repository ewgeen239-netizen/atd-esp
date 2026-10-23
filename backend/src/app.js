import path from 'node:path';
import express from 'express';
import { BACKEND_DIR } from './config.js';
import { openDb } from './db/index.js';
import { apiRateLimit, basicAuth, errorHandler, notFound, securityHeaders } from './middleware.js';
import { lookupRouter } from './routes/lookup.js';
import { productsRouter } from './routes/products.js';
import { scansRouter } from './routes/scans.js';
import { LookupService } from './services/lookup.js';
import { buildProviders } from './services/providers.js';

/**
 * Build the Express app. Tests pass their own repo/providers.
 * @param {object} config
 * @param {{repo?: object, providers?: object[], throttle?: object}} deps
 */
export function createApp(config, deps = {}) {
  const repo = deps.repo ?? openDb(config.dbPath);
  const built = deps.providers ? { providers: deps.providers, throttle: deps.throttle } : buildProviders(config);
  const lookup = new LookupService({
    repo,
    providers: built.providers,
    autodocBaseUrl: config.autodoc.baseUrl,
    cacheTtlHours: config.cacheTtlHours,
    cacheNegativeTtlHours: config.cacheNegativeTtlHours,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use(securityHeaders);
  if (config.basicAuthUser && config.basicAuthPass) app.use(basicAuth(config.basicAuthUser, config.basicAuthPass));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      providers: ['local', ...built.providers.map((p) => p.name)],
      external: built.throttle?.status() ?? null,
      robots: config.autodoc.respectRobots,
    });
  });

  const api = express.Router();
  api.use(apiRateLimit(config.apiRateLimitPerMin));
  api.use(express.json({ limit: '100kb' }));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(lookupRouter({ lookup, repo }));
  api.use(scansRouter({ repo, config }));
  api.use(productsRouter({ repo }));
  api.use(notFound);
  app.use('/api', api);

  // Frontend + vendored browser libraries (no CDN: works on a closed warehouse network).
  const nm = path.join(BACKEND_DIR, 'node_modules');
  app.get('/vendor/html5-qrcode.min.js', (_req, res) => res.sendFile(path.join(nm, 'html5-qrcode', 'html5-qrcode.min.js')));
  app.get('/vendor/JsBarcode.all.min.js', (_req, res) => res.sendFile(path.join(nm, 'jsbarcode', 'dist', 'JsBarcode.all.min.js')));
  app.get('/lib/ean.js', (_req, res) => res.type('text/javascript').sendFile(path.join(BACKEND_DIR, 'src', 'lib', 'ean.js')));
  app.use(express.static(config.frontendDir, { maxAge: '1h', index: 'index.html' }));

  app.use(notFound);
  app.use(errorHandler);

  return { app, repo, lookup, providers: built.providers };
}
