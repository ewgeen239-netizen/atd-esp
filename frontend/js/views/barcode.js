import { computeCheckDigit, isValidGtin } from '/lib/ean.js';
import { $, debounce, download } from '../ui.js';

let current = null; // { value, format } of the rendered barcode

function hint(text, tone = 'info') {
  const el = $('#bc-hint');
  el.textContent = text;
  el.className = `mt-1 min-h-[1rem] text-xs ${{ ok: 'text-emerald-400', bad: 'text-red-400', info: 'text-zinc-500' }[tone]}`;
}

/** Validate the input for the chosen format; returns the exact value to encode or null. */
function resolveValue(raw, format) {
  const v = raw.replace(/\s/g, '');
  if (!v) {
    hint('Введите значение');
    return null;
  }
  if (format === 'CODE128') {
    if (!/^[\x20-\x7e]+$/.test(raw)) {
      hint('Code 128: только латиница, цифры и символы ASCII', 'bad');
      return null;
    }
    hint(`Code 128 · ${raw.length} симв.`, 'ok');
    return raw;
  }
  const len = format === 'EAN13' ? 13 : 8;
  if (!/^\d+$/.test(v)) {
    hint('EAN: только цифры', 'bad');
    return null;
  }
  if (v.length === len - 1) {
    const full = v + computeCheckDigit(v);
    hint(`Контрольная цифра добавлена автоматически: ${full}`, 'ok');
    return full;
  }
  if (v.length === len) {
    if (isValidGtin(v)) {
      hint('✓ Контрольная цифра верна', 'ok');
      return v;
    }
    hint(`✗ Неверная контрольная цифра: ожидается ${computeCheckDigit(v.slice(0, -1))}`, 'bad');
    return null;
  }
  hint(`${format === 'EAN13' ? 'EAN-13' : 'EAN-8'}: ${len - 1} цифр (контрольная посчитается) или ${len}`, 'bad');
  return null;
}

function render() {
  const raw = $('#bc-value').value;
  const format = $('#bc-format').value;
  const value = resolveValue(raw, format);
  $('#bc-caption-out').textContent = $('#bc-caption').value;
  const svg = $('#bc-svg');
  current = null;
  if (!value) {
    svg.replaceChildren();
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    return;
  }
  try {
    window.JsBarcode(svg, value, { format, width: 2, height: 90, fontSize: 18, margin: 12, background: '#ffffff', lineColor: '#000000' });
    current = { value, format };
  } catch (err) {
    hint(`Не удалось построить: ${err.message || err}`, 'bad');
  }
}

function fileBase() {
  return `barcode-${current.format.toLowerCase()}-${current.value.replace(/[^\w-]/g, '_').slice(0, 40)}`;
}

function svgMarkup() {
  const svg = $('#bc-svg').cloneNode(true);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(svg);
}

function downloadPng(scale = 3) {
  const svg = $('#bc-svg');
  const w = svg.width.baseVal.value || svg.getBoundingClientRect().width;
  const hgt = svg.height.baseVal.value || svg.getBoundingClientRect().height;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgMarkup()], { type: 'image/svg+xml' }));
  img.onload = () => {
    const caption = $('#bc-caption').value;
    const extra = caption ? 28 : 0;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = (hgt + extra) * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, w * scale, hgt * scale);
    if (caption) {
      ctx.fillStyle = '#000';
      ctx.font = `${16 * scale}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(caption, (w * scale) / 2, (hgt + 20) * scale);
    }
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => download(`${fileBase()}.png`, blob), 'image/png');
  };
  img.src = url;
}

export function initBarcodeView() {
  const rerender = debounce(render, 120);
  $('#bc-value').addEventListener('input', rerender);
  $('#bc-caption').addEventListener('input', rerender);
  $('#bc-format').addEventListener('change', render);
  $('#bc-form').addEventListener('submit', (e) => e.preventDefault());
  $('#bc-svg-dl').addEventListener('click', () => current && download(`${fileBase()}.svg`, new Blob([svgMarkup()], { type: 'image/svg+xml' })));
  $('#bc-png-dl').addEventListener('click', () => current && downloadPng());
  $('#bc-print').addEventListener('click', () => current && window.print());
  render();
}

/** Called when navigating here from a product card. */
export function showBarcode({ value, caption } = {}) {
  if (!value) return;
  const v = String(value);
  $('#bc-value').value = v;
  $('#bc-format').value = /^\d{13}$/.test(v) || /^\d{12}$/.test(v) ? 'EAN13' : /^\d{8}$/.test(v) ? 'EAN8' : 'CODE128';
  $('#bc-caption').value = caption || '';
  render();
}
