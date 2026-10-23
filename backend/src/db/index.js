import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { gtinVariants, normalizeArticle, toGtin13 } from '../lib/ean.js';

const SCHEMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

const PRODUCT_FIELDS = [
  'ean', 'article_no', 'brand', 'name', 'oem_numbers', 'price', 'currency',
  'availability', 'image_url', 'product_url', 'source', 'notes',
];

const nowIso = () => new Date().toISOString();

function rowToProduct(row) {
  if (!row) return null;
  const { oem_norm, article_norm, ...rest } = row;
  let oem = [];
  try {
    oem = JSON.parse(row.oem_numbers || '[]');
  } catch {
    /* keep [] */
  }
  return { ...rest, oem_numbers: oem };
}

function cleanOem(list) {
  const arr = Array.isArray(list) ? list : String(list ?? '').split(/[|,;\n]/);
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const v = String(raw).trim();
    const n = normalizeArticle(v);
    if (n.length >= 3 && !seen.has(n)) {
      seen.add(n);
      out.push(v);
    }
  }
  return out.slice(0, 50);
}

/**
 * Repository over SQLite (node:sqlite, no native addons).
 * Every query lives here, so switching to PostgreSQL means re-implementing this
 * one module (see docs/POSTGRES.md); routes and services do not touch SQL.
 */
export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const stmt = (sql) => db.prepare(sql);

  function normalizeInput(p) {
    const out = {};
    for (const f of PRODUCT_FIELDS) if (p[f] !== undefined) out[f] = p[f];
    if (out.ean !== undefined) out.ean = out.ean ? toGtin13(String(out.ean).trim()) : null;
    if (out.price !== undefined) {
      const n = out.price === '' || out.price === null ? null : Number(String(out.price).replace(',', '.'));
      out.price = Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    }
    for (const f of ['article_no', 'brand', 'name', 'currency', 'availability', 'image_url', 'product_url', 'notes']) {
      if (out[f] !== undefined) out[f] = out[f] === null ? null : String(out[f]).trim() || null;
    }
    let oemNorm;
    if (out.oem_numbers !== undefined) {
      const oem = cleanOem(out.oem_numbers);
      out.oem_numbers = JSON.stringify(oem);
      oemNorm = ' ' + oem.map(normalizeArticle).join(' ') + ' ';
    }
    return { fields: out, oemNorm };
  }

  const repo = {
    db,
    close: () => db.close(),

    // ---------- products ----------
    getProduct(id) {
      return rowToProduct(stmt('SELECT * FROM products WHERE id = ?').get(id));
    },

    /** Local lookup by EAN, article number or OEM number. */
    findProducts({ type, value, normalized }) {
      const results = [];
      const seen = new Set();
      const push = (rows) => {
        for (const r of rows) if (!seen.has(r.id)) {
          seen.add(r.id);
          results.push(rowToProduct(r));
        }
      };
      if (type === 'ean') {
        const v = gtinVariants(value);
        push(stmt(`SELECT * FROM products WHERE ean IN (${v.map(() => '?').join(',')})`).all(...v));
      }
      const art = normalizeArticle(type === 'ean' ? value : normalized);
      if (art.length >= 2) {
        push(stmt('SELECT * FROM products WHERE article_norm = ? ORDER BY updated_at DESC LIMIT 20').all(art));
        push(stmt('SELECT * FROM products WHERE oem_norm LIKE ? ORDER BY updated_at DESC LIMIT 20').all(`% ${art} %`));
      }
      return results;
    },

    listProducts({ q = '', limit = 50, offset = 0 } = {}) {
      const like = `%${q.trim()}%`;
      const norm = `%${normalizeArticle(q)}%`;
      const where = q.trim()
        ? `WHERE name LIKE ? OR brand LIKE ? OR ean LIKE ? OR article_norm LIKE ? OR oem_norm LIKE ?`
        : '';
      const params = q.trim() ? [like, like, like, norm, norm] : [];
      const items = stmt(`SELECT * FROM products ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset)
        .map(rowToProduct);
      const { total } = stmt(`SELECT COUNT(*) AS total FROM products ${where}`).get(...params);
      return { items, total };
    },

    createProduct(p) {
      const { fields, oemNorm } = normalizeInput({ oem_numbers: [], ...p });
      const ts = nowIso();
      const cols = Object.keys(fields);
      const r = stmt(
        `INSERT INTO products (${cols.join(',')}, article_norm, oem_norm, created_at, updated_at)
         VALUES (${cols.map(() => '?').join(',')}, ?, ?, ?, ?)`,
      ).run(...cols.map((c) => fields[c]), normalizeArticle(fields.article_no) || null, oemNorm ?? ' ', ts, ts);
      return repo.getProduct(Number(r.lastInsertRowid));
    },

    updateProduct(id, p) {
      const { fields, oemNorm } = normalizeInput(p);
      const sets = Object.keys(fields).map((c) => `${c} = ?`);
      const vals = Object.values(fields);
      if (fields.article_no !== undefined) {
        sets.push('article_norm = ?');
        vals.push(normalizeArticle(fields.article_no) || null);
      }
      if (oemNorm !== undefined) {
        sets.push('oem_norm = ?');
        vals.push(oemNorm);
      }
      sets.push('updated_at = ?');
      vals.push(nowIso());
      stmt(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      return repo.getProduct(id);
    },

    deleteProduct(id) {
      return stmt('DELETE FROM products WHERE id = ?').run(id).changes > 0;
    },

    findProductByEan(ean) {
      const v = gtinVariants(ean);
      return rowToProduct(stmt(`SELECT * FROM products WHERE ean IN (${v.map(() => '?').join(',')})`).get(...v));
    },

    /** Insert or update, matching by EAN, then product URL, then brand + article. */
    upsertProduct(p) {
      let existing = null;
      if (p.ean) existing = repo.findProductByEan(toGtin13(String(p.ean)));
      if (!existing && p.product_url) {
        existing = rowToProduct(stmt('SELECT * FROM products WHERE product_url = ?').get(p.product_url));
      }
      if (!existing && p.article_no) {
        existing = rowToProduct(
          stmt('SELECT * FROM products WHERE article_norm = ? AND lower(coalesce(brand,\'\')) = lower(?)').get(
            normalizeArticle(p.article_no),
            p.brand || '',
          ),
        );
      }
      if (existing) {
        // Do not overwrite known values with blanks from a poorer source.
        const patch = Object.fromEntries(
          Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)),
        );
        return { product: repo.updateProduct(existing.id, patch), created: false };
      }
      return { product: repo.createProduct(p), created: true };
    },

    // ---------- scans ----------
    addScan(s) {
      const r = stmt(
        `INSERT INTO scans (code, code_type, found, source, product_id, ean, article_no, brand, name, price, currency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        s.code, s.code_type, s.found ? 1 : 0, s.source ?? null, s.product_id ?? null,
        s.ean ?? null, s.article_no ?? null, s.brand ?? null, s.name ?? null,
        s.price ?? null, s.currency ?? null, nowIso(),
      );
      return Number(r.lastInsertRowid);
    },

    listScans(filter = {}) {
      const { where, params } = scanWhere(filter);
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), 5000);
      const items = stmt(`SELECT * FROM scans ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, filter.offset ?? 0)
        .map((r) => ({ ...r, found: !!r.found }));
      const { total } = stmt(`SELECT COUNT(*) AS total FROM scans ${where}`).get(...params);
      return { items, total };
    },

    *iterateScans(filter = {}) {
      const { where, params } = scanWhere(filter);
      for (const r of stmt(`SELECT * FROM scans ${where} ORDER BY created_at ASC, id ASC`).iterate(...params)) {
        yield { ...r, found: !!r.found };
      }
    },

    deleteScan(id) {
      return stmt('DELETE FROM scans WHERE id = ?').run(id).changes > 0;
    },

    deleteScans(filter = {}) {
      const { where, params } = scanWhere(filter);
      return Number(stmt(`DELETE FROM scans ${where}`).run(...params).changes);
    },

    scanStats(filter = {}) {
      const { where, params } = scanWhere(filter);
      const row = stmt(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(found), 0) AS found,
                COALESCE(SUM(CASE WHEN found = 0 AND code_type <> 'invalid' THEN 1 ELSE 0 END), 0) AS not_found,
                COALESCE(SUM(CASE WHEN code_type = 'invalid' THEN 1 ELSE 0 END), 0) AS invalid,
                COUNT(DISTINCT code) AS unique_codes
         FROM scans ${where}`,
      ).get(...params);
      const bySource = stmt(
        `SELECT COALESCE(source, 'none') AS source, COUNT(*) AS n FROM scans ${where} GROUP BY 1 ORDER BY 2 DESC`,
      ).all(...params);
      return { ...row, by_source: bySource };
    },

    purgeScansOlderThan(days) {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      return Number(stmt('DELETE FROM scans WHERE created_at < ?').run(cutoff).changes);
    },

    // ---------- cache ----------
    getCache(key) {
      const row = stmt('SELECT * FROM lookup_cache WHERE cache_key = ? AND expires_at > ?').get(key, nowIso());
      if (!row) return null;
      return { found: !!row.found, product: row.payload ? JSON.parse(row.payload) : null, fetched_at: row.fetched_at };
    },

    setCache(key, product, ttlHours) {
      const ts = new Date();
      stmt(
        `INSERT INTO lookup_cache (cache_key, found, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (cache_key) DO UPDATE SET found = excluded.found, payload = excluded.payload,
           fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      ).run(
        key, product ? 1 : 0, product ? JSON.stringify(product) : null,
        ts.toISOString(), new Date(ts.getTime() + ttlHours * 3_600_000).toISOString(),
      );
    },

    deleteCache(key) {
      stmt('DELETE FROM lookup_cache WHERE cache_key = ?').run(key);
    },

    purgeExpiredCache() {
      return Number(stmt('DELETE FROM lookup_cache WHERE expires_at <= ?').run(nowIso()).changes);
    },
  };
  return repo;
}

function scanWhere({ from, to, q, found, codeType } = {}) {
  const cond = [];
  const params = [];
  if (from) {
    cond.push('created_at >= ?');
    params.push(from);
  }
  if (to) {
    cond.push('created_at <= ?');
    params.push(to);
  }
  if (found === true || found === false) {
    cond.push('found = ?');
    params.push(found ? 1 : 0);
  }
  if (codeType) {
    cond.push('code_type = ?');
    params.push(codeType);
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    cond.push('(code LIKE ? OR name LIKE ? OR brand LIKE ? OR article_no LIKE ? OR ean LIKE ?)');
    params.push(like, like, like, like, like);
  }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}
