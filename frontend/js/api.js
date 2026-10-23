// Thin fetch wrapper. Always resolves to { ok, status, data } (never throws on HTTP errors).

async function request(method, url, body, headers = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined && typeof body !== 'string' ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: { code: 'NETWORK', message: 'Нет связи с сервером' } } };
  }
}

export const api = {
  health: () => request('GET', '/api/health'),
  lookup: (code, { type = 'auto', refresh = false, log = true } = {}) => {
    const p = new URLSearchParams({ code, type });
    if (refresh) p.set('refresh', '1');
    if (!log) p.set('log', '0');
    return request('GET', `/api/lookup?${p}`);
  },
  scans: (params) => request('GET', `/api/scans?${new URLSearchParams(params)}`),
  stats: (params) => request('GET', `/api/stats?${new URLSearchParams(params)}`),
  deleteScan: (id) => request('DELETE', `/api/scans/${id}`),
  clearScans: (params) => request('DELETE', `/api/scans?${new URLSearchParams({ ...params, confirm: '1' })}`),
  scansExportUrl: (params) => `/api/scans/export.csv?${new URLSearchParams(params)}`,
  products: (params) => request('GET', `/api/products?${new URLSearchParams(params)}`),
  createProduct: (p) => request('POST', '/api/products', p),
  updateProduct: (id, p) => request('PUT', `/api/products/${id}`, p),
  deleteProduct: (id) => request('DELETE', `/api/products/${id}`),
  importProducts: (csvText) => request('POST', '/api/products/import', csvText, { 'Content-Type': 'text/csv' }),
};

export function errorMessage(res) {
  return res?.data?.error?.message || `Ошибка ${res?.status || ''}`.trim();
}
