import { parseCsv } from '../lib/csv.js';
import { AppError } from '../lib/errors.js';
import { isValidGtin, normalizeArticle, toGtin13 } from '../lib/ean.js';

const LIMITS = { name: 300, brand: 80, article_no: 40, currency: 3, availability: 60, notes: 1000, image_url: 1000, product_url: 1000 };

function httpUrl(v, field) {
  if (!v) return null;
  try {
    const u = new URL(String(v));
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch {
    /* fallthrough */
  }
  throw new AppError(422, 'VALIDATION', `Поле ${field}: нужен URL http(s)`);
}

/**
 * Validate and normalize a product payload from the UI, API or CSV import.
 * @param {boolean} partial  true for PUT (only provided fields are checked)
 */
export function validateProduct(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object') throw new AppError(400, 'VALIDATION', 'Ожидается JSON-объект');
  const out = {};
  const has = (k) => input[k] !== undefined;

  if (!partial || has('name')) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new AppError(422, 'VALIDATION', 'Название обязательно');
    out.name = name;
  }
  for (const k of ['brand', 'article_no', 'availability', 'notes']) {
    if (has(k)) out[k] = input[k] === null ? null : String(input[k]).trim() || null;
  }
  for (const [k, max] of Object.entries(LIMITS)) {
    if (typeof out[k] === 'string' && out[k].length > max) {
      throw new AppError(422, 'VALIDATION', `Поле ${k} длиннее ${max} символов`);
    }
  }
  if (has('ean')) {
    const ean = String(input.ean ?? '').replace(/\s/g, '');
    if (ean && !isValidGtin(ean)) throw new AppError(422, 'INVALID_EAN', `EAN ${ean} не прошёл проверку контрольной цифры`);
    out.ean = ean ? toGtin13(ean) : null;
  }
  if (has('price')) {
    const raw = input.price === null ? '' : String(input.price).trim().replace(',', '.');
    const n = raw === '' ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1e7)) throw new AppError(422, 'VALIDATION', 'Некорректная цена');
    out.price = n;
  }
  if (has('currency')) {
    const c = String(input.currency ?? '').trim().toUpperCase();
    if (c && !/^[A-Z]{3}$/.test(c)) throw new AppError(422, 'VALIDATION', 'Валюта: 3 буквы, например PLN');
    out.currency = c || null;
  }
  if (has('oem_numbers')) {
    const list = Array.isArray(input.oem_numbers) ? input.oem_numbers : String(input.oem_numbers ?? '').split(/[|,;\n]/);
    out.oem_numbers = list.map((s) => String(s).trim()).filter(Boolean);
  }
  if (has('image_url')) out.image_url = httpUrl(input.image_url, 'image_url');
  if (has('product_url')) out.product_url = httpUrl(input.product_url, 'product_url');
  if (!partial && !out.ean && !normalizeArticle(out.article_no)) {
    throw new AppError(422, 'VALIDATION', 'Нужен EAN или артикул');
  }
  return out;
}

// CSV header aliases (EN / PL / RU) -> product field
const HEADER_ALIASES = {
  ean: ['ean', 'gtin', 'barcode', 'kod kreskowy', 'numer ean', 'штрихкод', 'штрих-код'],
  article_no: ['article_no', 'article', 'sku', 'mpn', 'numer artykułu', 'numer artykulu', 'artykuł', 'артикул'],
  brand: ['brand', 'manufacturer', 'producent', 'marka', 'бренд', 'производитель'],
  name: ['name', 'title', 'nazwa', 'название', 'наименование'],
  oem_numbers: ['oem_numbers', 'oem', 'oe', 'numery oe', 'oem номера', 'oem'],
  price: ['price', 'cena', 'цена'],
  currency: ['currency', 'waluta', 'валюта'],
  availability: ['availability', 'stock', 'dostępność', 'наличие'],
  image_url: ['image_url', 'image', 'zdjęcie', 'изображение'],
  product_url: ['product_url', 'url', 'link', 'ссылка'],
  notes: ['notes', 'note', 'uwagi', 'заметки', 'комментарий'],
};

function mapHeaders(headerRow) {
  return headerRow.map((h) => {
    const key = h.trim().toLowerCase();
    return Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(key))?.[0] ?? null;
  });
}

/** Import products from CSV text; upserts by EAN / URL / brand+article. */
export function importProductsCsv(repo, text, { source = 'import', maxRows = 20000 } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new AppError(422, 'VALIDATION', 'CSV пуст или нет строки заголовков');
  const fields = mapHeaders(rows[0]);
  if (!fields.includes('name')) throw new AppError(422, 'VALIDATION', 'В CSV нет колонки name / nazwa / название');
  if (rows.length - 1 > maxRows) throw new AppError(413, 'TOO_LARGE', `Не более ${maxRows} строк за раз`);

  const result = { inserted: 0, updated: 0, errors: [] };
  repo.db.exec('BEGIN');
  try {
    rows.slice(1).forEach((row, i) => {
      const obj = {};
      fields.forEach((f, j) => {
        if (f && row[j] !== undefined && row[j].trim() !== '') obj[f] = row[j].trim().replace(/^'(?=[=+@-])/, '');
      });
      try {
        const p = validateProduct(obj);
        const { created } = repo.upsertProduct({ ...p, source });
        created ? result.inserted++ : result.updated++;
      } catch (err) {
        if (result.errors.length < 100) result.errors.push({ line: i + 2, message: err.message });
      }
    });
    repo.db.exec('COMMIT');
  } catch (err) {
    repo.db.exec('ROLLBACK');
    throw err;
  }
  return result;
}
