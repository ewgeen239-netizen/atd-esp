import { AppError } from '../lib/errors.js';

export function intParam(v, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

export function idParam(v) {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== String(v)) throw new AppError(400, 'BAD_ID', 'Некорректный id');
  return n;
}

function isoParam(v, name) {
  if (v === undefined || v === '') return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'BAD_DATE', `Некорректная дата в параметре ${name}`);
  return d.toISOString();
}

/** Parse history filters. `from`/`to` are ISO timestamps (the browser converts local dates). */
export function scanFilter(q) {
  const found = q.found === '1' || q.found === 'true' ? true : q.found === '0' || q.found === 'false' ? false : undefined;
  const codeType = ['ean', 'article', 'invalid'].includes(q.type) ? q.type : undefined;
  return {
    from: isoParam(q.from, 'from'),
    to: isoParam(q.to, 'to'),
    q: typeof q.q === 'string' ? q.q.slice(0, 100) : undefined,
    found,
    codeType,
  };
}

export function timeZoneParam(v, fallback) {
  const tz = typeof v === 'string' && v ? v : fallback;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

export function formatLocal(iso, timeZone) {
  // sv-SE gives "YYYY-MM-DD HH:MM:SS", which Excel recognises as a date.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}
