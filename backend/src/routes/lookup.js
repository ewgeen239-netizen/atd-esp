import { Router } from 'express';
import { AppError } from '../lib/errors.js';

export function lookupRouter({ lookup, repo }) {
  const r = Router();

  function logScan(code, codeType, result) {
    const p = result?.product;
    return repo.addScan({
      code,
      code_type: codeType,
      found: !!p,
      source: result?.source ?? null,
      product_id: p?.id ?? null,
      ean: p?.ean ?? null,
      article_no: p?.article_no ?? null,
      brand: p?.brand ?? null,
      name: p?.name ?? null,
      price: p?.price ?? null,
      currency: p?.currency ?? null,
    });
  }

  // GET /api/lookup?code=4006633157346&type=auto|ean|article&refresh=1&log=0
  r.get('/lookup', async (req, res) => {
    const raw = String(req.query.code ?? '').slice(0, 64);
    const type = ['ean', 'article'].includes(req.query.type) ? req.query.type : 'auto';
    const refresh = req.query.refresh === '1';
    const log = req.query.log !== '0';

    let result;
    try {
      result = await lookup.lookup(raw, { type, refresh });
    } catch (err) {
      // Misreads are worth counting (scanner quality KPI), empty input is not.
      if (log && err instanceof AppError && ['INVALID_EAN', 'INVALID_CODE'].includes(err.code)) {
        logScan(err.extra.value || raw, 'invalid', null);
      }
      throw err;
    }
    const scanId = log ? logScan(result.code, result.codeType, result) : null;
    if (!result.found) {
      return res.status(404).json({
        ...result,
        scanId,
        error: { code: 'NOT_FOUND', message: 'Товар не найден. Проверьте на autodoc.pl по ссылке и добавьте вручную.' },
      });
    }
    res.json({ ...result, scanId });
  });

  return r;
}
