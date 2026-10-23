// GTIN / EAN helpers. Shared by the backend and the browser (served at /lib/ean.js),
// so keep this file dependency-free and environment-agnostic.

export const GTIN_LENGTHS = [8, 12, 13, 14];

/** Mod-10 check digit for a GTIN body (all digits except the last one). */
export function computeCheckDigit(body) {
  if (!/^\d+$/.test(body)) throw new Error('GTIN body must contain digits only');
  let sum = 0;
  // Weights alternate 3,1,3,1... starting from the rightmost digit of the body.
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(body[i]) * w;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidGtin(code) {
  if (typeof code !== 'string' || !/^\d+$/.test(code)) return false;
  if (!GTIN_LENGTHS.includes(code.length)) return false;
  return computeCheckDigit(code.slice(0, -1)) === code.at(-1);
}

/** Canonical form used for storage/matching: UPC-A and GTIN-14 (leading 0) -> EAN-13. */
export function toGtin13(code) {
  if (code.length === 12) return '0' + code;
  if (code.length === 14 && code.startsWith('0')) return code.slice(1);
  return code;
}

/** All equivalent spellings of a GTIN, for matching data that was stored inconsistently. */
export function gtinVariants(code) {
  const c13 = toGtin13(code);
  const set = new Set([code, c13]);
  if (c13.length === 13) {
    set.add('0' + c13);
    if (c13.startsWith('0')) set.add(c13.slice(1));
  }
  return [...set];
}

/** Article / OEM number normalization: "0 986-494.294" -> "0986494294". */
export function normalizeArticle(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/**
 * Classify user/scanner input.
 * @returns {{ok:true,type:'ean'|'article',value:string,normalized:string}
 *          |{ok:false,error:'EMPTY'|'INVALID_EAN'|'INVALID_CODE',message:string,value:string,expectedCheckDigit?:string}}
 */
export function classifyCode(raw, { forceType = 'auto' } = {}) {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: 'EMPTY', message: 'Пустой код', value };
  const compact = value.replace(/[\s-]/g, '');
  const numeric = /^\d+$/.test(compact);

  if (forceType !== 'article' && numeric && GTIN_LENGTHS.includes(compact.length)) {
    if (isValidGtin(compact)) {
      return { ok: true, type: 'ean', value: compact, normalized: toGtin13(compact) };
    }
    // 13/14 digits are practically always a barcode: a bad check digit means a misread or typo.
    // 8/12-digit numbers are common article numbers, so fall through and treat them as articles.
    if (compact.length >= 13 || forceType === 'ean') {
      return {
        ok: false,
        error: 'INVALID_EAN',
        message: `Неверная контрольная цифра EAN (ожидается ${computeCheckDigit(compact.slice(0, -1))})`,
        value: compact,
        expectedCheckDigit: computeCheckDigit(compact.slice(0, -1)),
      };
    }
  }
  if (forceType === 'ean') {
    return { ok: false, error: 'INVALID_EAN', message: 'EAN должен содержать 8, 12, 13 или 14 цифр', value };
  }

  const normalized = normalizeArticle(value);
  if (normalized.length < 2 || value.length > 40 || !/^[\p{L}\p{N} .\-/_]+$/u.test(value)) {
    return { ok: false, error: 'INVALID_CODE', message: 'Код не похож ни на EAN, ни на артикул', value };
  }
  return { ok: true, type: 'article', value, normalized };
}
