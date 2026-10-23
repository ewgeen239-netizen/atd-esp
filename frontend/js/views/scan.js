import { api } from '../api.js';
import { openProductForm } from '../product-form.js';
import { renderLookupResult } from '../product-card.js';
import { CameraScanner, listenKeyboardWedge } from '../scanner.js';
import { $, feedback, fmtTime, h, toast } from '../ui.js';

const recent = [];
let busy = false;
let state;

export function initScanView(appState) {
  state = appState;
  const scanner = new CameraScanner('reader', (code) => {
    if (!$('#cam-continuous').checked) stopCamera();
    lookup(code);
  });

  async function startCamera() {
    $('#cam-error').classList.add('hidden');
    $('#reader-wrap').classList.remove('hidden');
    $('#cam-toggle').disabled = true;
    try {
      await scanner.start();
      $('#cam-toggle').textContent = '■ Выключить камеру';
      $('#cam-toggle').classList.replace('btn-primary', 'btn-ghost');
      $('#cam-switch').classList.toggle('hidden', scanner.cameras.length < 2);
      $('#cam-torch').classList.toggle('hidden', !scanner.torchSupported());
    } catch (err) {
      $('#reader-wrap').classList.add('hidden');
      const msg = String(err?.message || err);
      $('#cam-error').textContent = /Permission|NotAllowed/i.test(msg)
        ? 'Доступ к камере запрещён. Разрешите камеру в настройках браузера для этого сайта.'
        : /NotFound|Requested device not found/i.test(msg) ? 'Камера не найдена.' : `Камера: ${msg}`;
      $('#cam-error').classList.remove('hidden');
    } finally {
      $('#cam-toggle').disabled = false;
    }
  }

  async function stopCamera() {
    await scanner.stop();
    $('#reader-wrap').classList.add('hidden');
    $('#cam-toggle').textContent = '📷 Включить камеру';
    $('#cam-toggle').classList.replace('btn-ghost', 'btn-primary');
    $('#cam-switch').classList.add('hidden');
    $('#cam-torch').classList.add('hidden');
  }

  $('#cam-toggle').addEventListener('click', () => (scanner.running ? stopCamera() : startCamera()));
  $('#cam-switch').addEventListener('click', () => scanner.switchCamera().catch((e) => toast(e.message, 'error')));
  $('#cam-torch').addEventListener('click', async () => {
    try {
      const on = await scanner.toggleTorch();
      $('#cam-torch').classList.toggle('!bg-amber-500', on);
    } catch (e) {
      toast('Фонарик недоступен', 'warn');
    }
  });

  $('#manual-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#manual-code').value.trim();
    if (code) lookup(code);
  });

  listenKeyboardWedge((code) => lookup(code), () => state.view === 'scan');

  state.stopCamera = stopCamera;
  // Release the camera when leaving the tab or hiding the app (battery, other apps).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && scanner.running) stopCamera();
  });
  state.scanner = scanner;
}

export async function lookup(code, opts = {}) {
  if (busy) return;
  busy = true;
  state.scanner?.pause(true);
  const out = $('#result');
  out.replaceChildren(h('div', { class: 'card animate-pulse text-sm text-zinc-400' }, `Поиск ${code}…`));
  try {
    const res = await api.lookup(code, opts);
    const result = res.data || { error: { code: 'NETWORK', message: 'Нет ответа сервера' } };
    if (res.status === 0) result.error = res.data.error;
    feedback(result.found ? 'ok' : result.error?.code === 'NOT_FOUND' ? 'miss' : 'error');
    out.replaceChildren(renderLookupResult(result, actions()));
    addRecent(result, code);
    if (opts.log !== false) state.onScan?.();
    if (matchMedia('(pointer: fine)').matches) {
      $('#manual-code').select();
    } else {
      $('#manual-code').value = '';
    }
  } finally {
    busy = false;
    state.scanner?.pause(false);
  }
}

function actions() {
  return {
    canRefresh: state.externalProviders.some((p) => p !== 'mock'),
    onBarcode: (value, caption) => state.go('barcode', { value, caption }),
    onRefresh: (code) => lookup(code, { refresh: true, log: false }),
    onSearchAsArticle: (code) => lookup(code, { type: 'article' }),
    onEdit: (product) => openProductForm({ product, saved: (p) => lookup(p.ean || p.article_no, { log: false }) }),
    onAdd: (result) =>
      openProductForm({
        product: result.product ? { ...result.product, id: undefined } : null,
        code: result.code,
        saved: (p) => lookup(p.ean || p.article_no, { log: false }),
      }),
  };
}

function addRecent(result, code) {
  const ok = !!result.found;
  const name = result.product?.name || result.error?.message || '';
  recent.unshift({ code: result.code || code, ok, name, at: new Date().toISOString() });
  recent.length = Math.min(recent.length, 8);
  $('#recent-wrap').classList.remove('hidden');
  $('#recent').replaceChildren(
    ...recent.map((r) =>
      h('li', {},
        h('button', {
          class: 'flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left text-sm hover:bg-zinc-800/60',
          type: 'button',
          onclick: () => lookup(r.code, { log: false }),
        },
        h('span', { class: r.ok ? 'text-emerald-400' : 'text-red-400' }, r.ok ? '●' : '○'),
        h('span', { class: 'font-mono text-xs' }, r.code),
        h('span', { class: 'flex-1 truncate text-zinc-400' }, r.name),
        h('span', { class: 'text-[11px] text-zinc-500' }, fmtTime(r.at)),
        ),
      ),
    ),
  );
}
