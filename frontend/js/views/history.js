import { api, errorMessage } from '../api.js';
import { $, $$, debounce, fmtPrice, fmtTime, h, sourceBadge, toast } from '../ui.js';

const PAGE = 100;
let offset = 0;
let state;

const pad = (n) => String(n).padStart(2, '0');
const dateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local calendar dates from the inputs -> ISO instants for the API (night shifts span midnight). */
function filters() {
  const p = {};
  const from = $('#hist-from').value;
  const to = $('#hist-to').value;
  if (state.histRange) {
    p.from = state.histRange.from;
    if (state.histRange.to) p.to = state.histRange.to;
  } else {
    if (from) p.from = new Date(`${from}T00:00:00`).toISOString();
    if (to) p.to = new Date(`${to}T23:59:59.999`).toISOString();
  }
  const f = $('#hist-found').value;
  if (f === 'invalid') p.type = 'invalid';
  else if (f) p.found = f;
  const q = $('#hist-q').value.trim();
  if (q) p.q = q;
  return p;
}

function applyPreset(name) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  state.histRange = null;
  if (name === 'shift') {
    state.histRange = { from: new Date(now - 12 * 3_600_000).toISOString() };
    $('#hist-from').value = dateInput(new Date(now - 12 * 3_600_000));
    $('#hist-to').value = dateInput(now);
  } else if (name === 'today') {
    $('#hist-from').value = $('#hist-to').value = dateInput(now);
  } else if (name === 'yesterday') {
    const y = new Date(start - 86_400_000);
    $('#hist-from').value = $('#hist-to').value = dateInput(y);
  } else if (name === 'week') {
    $('#hist-from').value = dateInput(new Date(start - 6 * 86_400_000));
    $('#hist-to').value = dateInput(now);
  } else {
    $('#hist-from').value = $('#hist-to').value = '';
  }
  $$('#hist-presets [data-preset]').forEach((b) => b.classList.toggle('!border-accent', b.dataset.preset === name));
  reload();
}

function stat(label, value, cls = '') {
  return h('div', { class: 'card p-2' }, h('div', { class: `text-lg font-semibold ${cls}` }, value), h('div', { class: 'text-[10px] uppercase tracking-wide text-zinc-500' }, label));
}

async function loadStats(p) {
  const res = await api.stats(p);
  if (!res.ok) return;
  const s = res.data;
  const rate = s.total ? Math.round((s.found / s.total) * 100) : 0;
  $('#hist-stats').replaceChildren(
    stat('всего', s.total),
    stat(`найдено ${rate}%`, s.found, 'text-emerald-400'),
    stat('не найдено', s.not_found, 'text-red-400'),
    stat('ошибки', s.invalid, 'text-amber-400'),
  );
}

function row(s) {
  return h('li', { class: 'flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2' },
    h('span', { class: s.found ? 'text-emerald-400' : s.code_type === 'invalid' ? 'text-amber-400' : 'text-red-400', title: s.found ? 'найдено' : 'не найдено' }, s.found ? '●' : s.code_type === 'invalid' ? '!' : '○'),
    h('button', { class: 'min-w-0 flex-1 text-left', type: 'button', onclick: () => state.go('scan', { lookup: s.code }) },
      h('div', { class: 'flex items-center gap-2' },
        h('span', { class: 'font-mono text-sm' }, s.code),
        s.source ? sourceBadge(s.source) : null,
      ),
      h('div', { class: 'truncate text-xs text-zinc-400' },
        s.name ? `${s.brand ? s.brand + ' · ' : ''}${s.name}` : s.code_type === 'invalid' ? 'неверный EAN' : 'не найдено',
        s.price !== null ? ` · ${fmtPrice(s.price, s.currency)}` : ''),
    ),
    h('span', { class: 'shrink-0 text-[11px] text-zinc-500' }, fmtTime(s.created_at)),
    h('button', {
      class: 'shrink-0 px-1 text-zinc-600 hover:text-red-400', type: 'button', title: 'Удалить запись', 'aria-label': 'Удалить запись',
      onclick: async (e) => {
        const res = await api.deleteScan(s.id);
        if (res.ok) {
          e.target.closest('li').remove();
          loadStats(filters());
        } else toast(errorMessage(res), 'error');
      },
    }, '✕'),
  );
}

export async function reload() {
  offset = 0;
  $('#hist-list').replaceChildren();
  await loadMore();
}

async function loadMore() {
  const p = filters();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('#hist-export').href = api.scansExportUrl({ ...p, tz });
  if (offset === 0) loadStats(p);
  const res = await api.scans({ ...p, limit: PAGE, offset });
  if (!res.ok) return toast(errorMessage(res), 'error');
  const { items, total } = res.data;
  if (!items.length && offset === 0) {
    $('#hist-list').append(h('li', { class: 'py-8 text-center text-sm text-zinc-500' }, 'Нет сканов за выбранный период'));
  }
  $('#hist-list').append(...items.map(row));
  offset += items.length;
  $('#hist-more').classList.toggle('hidden', offset >= total);
}

export function initHistoryView(appState) {
  state = appState;
  $$('#hist-presets [data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  const manual = () => {
    state.histRange = null;
    $$('#hist-presets [data-preset]').forEach((b) => b.classList.remove('!border-accent'));
    reload();
  };
  $('#hist-from').addEventListener('change', manual);
  $('#hist-to').addEventListener('change', manual);
  $('#hist-found').addEventListener('change', reload);
  $('#hist-q').addEventListener('input', debounce(reload, 300));
  $('#hist-more').addEventListener('click', loadMore);
  $('#hist-clear').addEventListener('click', async () => {
    const p = filters();
    const scope = Object.keys(p).length ? 'по текущему фильтру' : 'ВСЮ историю';
    if (!confirm(`Удалить ${scope}? Это нельзя отменить.`)) return;
    const res = await api.clearScans(p);
    if (res.ok) {
      toast(`Удалено: ${res.data.deleted}`, 'ok');
      reload();
      state.onScan?.();
    } else toast(errorMessage(res), 'error');
  });
  applyPreset('today');
}
