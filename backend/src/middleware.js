import crypto from 'node:crypto';
import { AppError } from './lib/errors.js';

export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      // html5-qrcode sets inline styles on its video/canvas elements
      "style-src 'self' 'unsafe-inline'",
      // product photos come from the catalog's CDN
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Optional HTTP Basic auth for a public deployment (BASIC_AUTH_USER / BASIC_AUTH_PASS). */
export function basicAuth(user, pass) {
  return (req, res, next) => {
    if (req.path === '/api/health') return next();
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const i = decoded.indexOf(':');
      if (i > 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Barcode Scanner", charset="UTF-8"');
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Требуется вход' } });
  };
}

/**
 * Fixed-window in-memory limiter for /api. IPs are kept in memory only for the
 * current minute and never written to disk or logs.
 */
export function apiRateLimit(perMinute) {
  const hits = new Map();
  let windowStart = Date.now();
  return (req, res, next) => {
    if (perMinute <= 0) return next();
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      hits.clear();
      windowStart = now;
    }
    const key = req.ip || 'unknown';
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    res.setHeader('RateLimit-Limit', String(perMinute));
    res.setHeader('RateLimit-Remaining', String(Math.max(perMinute - n, 0)));
    if (n > perMinute) {
      const retry = Math.ceil((windowStart + 60_000 - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return next(new AppError(429, 'RATE_LIMITED', 'Слишком много запросов, подождите немного', { retryAfter: retry }));
    }
    next();
  };
}

export function notFound(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Маршрут не найден'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err.type === 'entity.too.large') err = new AppError(413, 'TOO_LARGE', 'Слишком большой запрос');
  else if (err.type === 'entity.parse.failed') err = new AppError(400, 'BAD_JSON', 'Некорректный JSON');
  if (!(err instanceof AppError)) {
    console.error('[error]', err);
    err = new AppError(500, 'INTERNAL', 'Внутренняя ошибка сервера');
  }
  if (err.extra?.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
  res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
}
