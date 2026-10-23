import express, { Router } from 'express';
import { toCsv } from '../lib/csv.js';
import { AppError } from '../lib/errors.js';
import { importProductsCsv, validateProduct } from '../services/products.js';
import { idParam, intParam, sendCsv } from './util.js';

const EXPORT_FIELDS = ['ean', 'article_no', 'brand', 'name', 'oem_numbers', 'price', 'currency', 'availability', 'image_url', 'product_url', 'source', 'notes', 'updated_at'];

export function productsRouter({ repo }) {
  const r = Router();

  function conflictSafe(fn) {
    try {
      return fn();
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed: products.ean')) {
        throw new AppError(409, 'DUPLICATE_EAN', 'Товар с таким EAN уже есть в каталоге');
      }
      throw err;
    }
  }

  r.get('/products', (req, res) => {
    res.json(
      repo.listProducts({
        q: typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '',
        limit: intParam(req.query.limit, 50, { min: 1, max: 500 }),
        offset: intParam(req.query.offset, 0),
      }),
    );
  });

  r.get('/products/export.csv', (_req, res) => {
    const { items } = repo.listProducts({ limit: 1_000_000 });
    const rows = items.map((p) => EXPORT_FIELDS.map((f) => (f === 'oem_numbers' ? p.oem_numbers.join(' | ') : p[f])));
    sendCsv(res, 'products.csv', toCsv(EXPORT_FIELDS, rows));
  });

  r.post(
    '/products/import',
    express.text({ type: ['text/csv', 'text/plain', 'application/vnd.ms-excel'], limit: '5mb' }),
    (req, res) => {
      if (typeof req.body !== 'string' || !req.body.trim()) {
        throw new AppError(400, 'VALIDATION', 'Отправьте CSV в теле запроса (Content-Type: text/csv)');
      }
      res.json(importProductsCsv(repo, req.body));
    },
  );

  r.get('/products/:id', (req, res) => {
    const p = repo.getProduct(idParam(req.params.id));
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Товар не найден');
    res.json(p);
  });

  r.post('/products', (req, res) => {
    const data = validateProduct(req.body);
    const p = conflictSafe(() => repo.createProduct({ ...data, source: 'manual' }));
    res.status(201).json(p);
  });

  r.put('/products/:id', (req, res) => {
    const id = idParam(req.params.id);
    if (!repo.getProduct(id)) throw new AppError(404, 'NOT_FOUND', 'Товар не найден');
    const data = validateProduct(req.body, { partial: true });
    res.json(conflictSafe(() => repo.updateProduct(id, data)));
  });

  r.delete('/products/:id', (req, res) => {
    if (!repo.deleteProduct(idParam(req.params.id))) throw new AppError(404, 'NOT_FOUND', 'Товар не найден');
    res.status(204).end();
  });

  return r;
}
