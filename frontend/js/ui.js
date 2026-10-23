// Small DOM helpers. All text goes through textContent, never innerHTML.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div', {class: 'x', onclick: fn}, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(message, kind = 'info', ms = 2600) {
  const colors = {
    info: 'border-zinc-700 bg-zinc-900 text-zinc-100',
    ok: 'border-emerald-800 bg-emerald-950 text-emerald-200',
    warn: 'border-amber-800 bg-amber-950 text-amber-200',
    error: 'border-red-800 bg-red-950 text-red-200',
  };
  const el = h('div', { class: `pointer-events-auto max-w-md rounded-xl border px-4 py-2 text-sm shadow-lg ${colors[kind] || colors.info}`, role: 'status' }, message);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

let audioCtx;
/** Short beep + vibration so the picker does not need to look at the screen. */
export function feedback(kind) {
  const tones = { ok: [1320, 0.08], miss: [440, 0.18], error: [220, 0.25] };
  const [freq, dur] = tones[kind] || tones.ok;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {
    /* audio not available */
  }
  navigator.vibrate?.(kind === 'ok' ? 60 : [80, 60, 80]);
}

export function fmtPrice(price, currency) {
  if (price === null || price === undefined) return '—';
  try {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: currency || 'PLN' }).format(price);
  } catch {
    return `${price} ${currency || ''}`.trim();
  }
}

export function fmtTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const SOURCE_BADGES = {
  local: ['Каталог', 'bg-sky-900/60 text-sky-300'],
  manual: ['Вручную', 'bg-sky-900/60 text-sky-300'],
  import: ['Импорт', 'bg-sky-900/60 text-sky-300'],
  autodoc: ['autodoc.pl', 'bg-orange-900/60 text-orange-300'],
  scraper: ['Scraper API', 'bg-violet-900/60 text-violet-300'],
  mock: ['DEMO', 'bg-fuchsia-900/60 text-fuchsia-300'],
};

export function sourceBadge(source) {
  const [label, cls] = SOURCE_BADGES[source] || [source || '—', 'bg-zinc-800 text-zinc-300'];
  return h('span', { class: `badge ${cls}` }, label);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
