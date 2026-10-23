// Minimal RFC 4180 CSV reader/writer with Excel-friendly defaults.

const FORMULA_START = /^[=+@\t\r]|^-(?!\d)/;

/** Quote a value and neutralize spreadsheet formula injection ("=HYPERLINK(...)"). */
function cell(value, sep) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = "'" + s;
  if (s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 * @param {{sep?: string, bom?: boolean}} opts  `;` + BOM opens correctly in Excel with PL/RU locale.
 */
export function toCsv(headers, rows, { sep = ';', bom = true } = {}) {
  const lines = [headers.map((h) => cell(h, sep)).join(sep)];
  for (const row of rows) lines.push(row.map((v) => cell(v, sep)).join(sep));
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

/** Parse CSV text; the separator (`;`, `,` or tab) is detected from the header line. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [';', ',', '\t'].map((s) => [s, firstLine.split(s).length]);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}
