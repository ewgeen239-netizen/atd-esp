import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(here, '..');
export const ROOT_DIR = path.resolve(BACKEND_DIR, '..');

// Load .env without extra dependencies (Node >= 21.7). Real env vars win.
for (const file of [path.join(ROOT_DIR, '.env'), path.join(BACKEND_DIR, '.env')]) {
  if (fs.existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch (err) {
      console.warn(`[config] cannot read ${file}: ${err.message}`);
    }
  }
}

const env = process.env;

function int(name, def) {
  const v = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}

function bool(name, def) {
  const v = env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function list(name, def) {
  const v = env[name];
  if (v === undefined) return def;
  return v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p);
}

export const config = {
  port: int('PORT', 3000),
  host: env.HOST || '0.0.0.0',
  dbPath: resolveFromRoot(env.DB_PATH || './data/scanner.db'),
  frontendDir: resolveFromRoot(env.FRONTEND_DIR || './frontend'),
  trustProxy: bool('TRUST_PROXY', true),

  // Optional protection for a publicly deployed instance.
  basicAuthUser: env.BASIC_AUTH_USER || '',
  basicAuthPass: env.BASIC_AUTH_PASS || '',

  apiRateLimitPerMin: int('API_RATE_LIMIT_PER_MIN', 120),
  historyRetentionDays: int('HISTORY_RETENTION_DAYS', 90),
  displayTimeZone: env.DISPLAY_TZ || 'Europe/Warsaw',

  // External lookup. Order matters; "local" catalog is always checked first.
  // Allowed: autodoc, scraper, mock. Empty = local catalog only.
  externalProviders: list('EXTERNAL_PROVIDERS', ['mock']),

  autodoc: {
    baseUrl: (env.AUTODOC_BASE_URL || 'https://www.autodoc.pl').replace(/\/+$/, ''),
    userAgent:
      env.AUTODOC_USER_AGENT ||
      'AutodocBarcodeScanner/0.1 (warehouse EAN lookup; low volume; contact: set AUTODOC_USER_AGENT)',
    respectRobots: bool('AUTODOC_RESPECT_ROBOTS', true),
    acceptLanguage: env.AUTODOC_ACCEPT_LANGUAGE || 'pl-PL,pl;q=0.9,en;q=0.5',
  },

  scraper: {
    provider: (env.SCRAPER_PROVIDER || '').toLowerCase(), // scraperapi | zenrows | piloterr | custom
    apiKey: env.SCRAPER_API_KEY || '',
    urlTemplate: env.SCRAPER_URL_TEMPLATE || '', // for "custom": use {url} and {key}
  },

  // Politeness for every outbound request (direct or via a scraper API).
  external: {
    minIntervalMs: int('EXTERNAL_MIN_INTERVAL_MS', 3000),
    dailyLimit: int('EXTERNAL_DAILY_LIMIT', 300),
    maxQueue: int('EXTERNAL_MAX_QUEUE', 5),
    timeoutMs: int('EXTERNAL_TIMEOUT_MS', 12000),
    cooldownMinutes: int('EXTERNAL_COOLDOWN_MINUTES', 15),
  },

  cacheTtlHours: int('CACHE_TTL_HOURS', 168),
  cacheNegativeTtlHours: int('CACHE_NEGATIVE_TTL_HOURS', 24),
};
