import { api } from './api.js';
import { initProductForm } from './product-form.js';
import { $, $$ } from './ui.js';
import { initBarcodeView, showBarcode } from './views/barcode.js';
import { initCatalogView, reload as reloadCatalog } from './views/catalog.js';
import { initHistoryView, reload as reloadHistory } from './views/history.js';
import { initScanView, lookup } from './views/scan.js';

const VIEWS = ['scan', 'history', 'barcode', 'catalog'];

const state = {
  view: 'scan',
  externalProviders: [],
  histRange: null,
  scanner: null,
  stopCamera: null,
  onScan: () => refreshKpi(),
  /** Navigate to a view, optionally with a payload. */
  go(view, payload) {
    pendingPayload = payload;
    if (location.hash === `#${view}`) show(view);
    else location.hash = view;
  },
};
let pendingPayload = null;

function show(view) {
  if (!VIEWS.includes(view)) view = 'scan';
  if (state.view === 'scan' && view !== 'scan' && state.scanner?.running) state.stopCamera();
  state.view = view;
  $$('[data-view]').forEach((s) => s.classList.toggle('hidden', s.dataset.view !== view));
  $$('[data-nav]').forEach((a) => (a.dataset.nav === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const payload = pendingPayload;
  pendingPayload = null;
  if (view === 'history') reloadHistory();
  if (view === 'catalog') reloadCatalog();
  if (view === 'barcode') showBarcode(payload || {});
  if (view === 'scan' && payload?.lookup) lookup(payload.lookup, { log: false });
  window.scrollTo({ top: 0 });
}

async function refreshKpi() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const res = await api.stats({ from: from.toISOString() });
  if (res.ok) $('#kpi-today').textContent = `сегодня: ${res.data.total}`;
}

async function refreshStatus() {
  const res = await api.health();
  const dot = $('#status-dot');
  if (!res.ok) {
    dot.className = 'h-2 w-2 rounded-full bg-red-500';
    $('#status-text').textContent = 'офлайн';
    return;
  }
  const ext = res.data.providers.filter((p) => p !== 'local');
  state.externalProviders = ext;
  const paused = res.data.external?.cooldownUntil;
  dot.className = `h-2 w-2 rounded-full ${paused ? 'bg-amber-500' : 'bg-emerald-500'}`;
  $('#status-text').textContent = ext.length ? `local+${ext.join('+')}` : 'local';
  $('#status').title = paused ? `Внешний поиск на паузе: ${res.data.external.cooldownReason}` : 'Источники поиска';
}

initProductForm();
initScanView(state);
initHistoryView(state);
initBarcodeView();
initCatalogView(state);

window.addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1) || 'scan');
refreshStatus();
refreshKpi();
setInterval(refreshStatus, 60_000);

if (matchMedia('(pointer: fine)').matches) $('#manual-code').focus();
