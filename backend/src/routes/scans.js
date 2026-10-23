import { Router } from 'express';
import { toCsv } from '../lib/csv.js';
import { AppError } from '../lib/errors.js';
import { formatLocal, idParam, intParam, scanFilter, sendCsv, timeZoneParam } from './util.js';

const CSV_HEADERS = [
  'time_local', 'time_utc', 'code', 'code_type', 'found', 'source',
  'ean', 'article_no', 'brand', 'name', 'price', 'currency',
];

export function scansRouter({ repo, config }) {
  const r = Router();

  r.get('/scans', (req, res) => {
    const filter = scanFilter(req.query);
    res.json(
      repo.listScans({
        ...filter,
        limit: intParam(req.query.limit, 100, { min: 1, max: 1000 }),
        offset: intParam(req.query.offset, 0),
      }),
    );
  });

  r.get('/scans/export.csv', (req, res) => {
    const filter = scanFilter(req.query);
    const tz = timeZoneParam(req.query.tz, config.displayTimeZone);
    const sep = req.query.sep === 'comma' ? ',' : ';';
    const rows = [];
    for (const s of repo.iterateScans(filter)) {
      rows.push([
        formatLocal(s.created_at, tz), s.created_at, s.code, s.code_type, s.found ? 1 : 0, s.source,
        s.ean, s.article_no, s.brand, s.name,
        // Excel with PL/RU locale expects a decimal comma when the separator is ";"
        s.price === null ? '' : sep === ';' ? String(s.price).replace('.', ',') : s.price,
        s.currency,
      ]);
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    sendCsv(res, `scans-${stamp}.csv`, toCsv(CSV_HEADERS, rows, { sep }));
  });

  r.get('/stats', (req, res) => {
    res.json(repo.scanStats(scanFilter(req.query)));
  });

  r.delete('/scans/:id', (req, res) => {
    if (!repo.deleteScan(idParam(req.params.id))) throw new AppError(404, 'NOT_FOUND', 'Запись не найдена');
    res.status(204).end();
  });

  // Clears the history matching the same filters as the list (all history without filters).
  r.delete('/scans', (req, res) => {
    if (req.query.confirm !== '1') throw new AppError(400, 'CONFIRM_REQUIRED', 'Добавьте confirm=1');
    res.json({ deleted: repo.deleteScans(scanFilter(req.query)) });
  });

  return r;
}
