import { classifyCode, computeCheckDigit, isValidGtin } from '/lib/ean.js';
import { api, errorMessage } from './api.js';
import { $, toast } from './ui.js';

const FIELDS = ['name', 'brand', 'article_no', 'ean', 'oem_numbers', 'price', 'currency', 'availability', 'product_url', 'image_url', 'notes'];

const dialog = () => $('#product-dialog');
const form = () => $('#product-form');
let editingId = null;
let onSaved = null;

function setHint(text, tone) {
  const hint = $('#pf-ean-hint');
  hint.textContent = text;
  hint.className = `mt-1 min-h-[1rem] text-xs ${{ ok: 'text-emerald-400', bad: 'text-red-400', info: 'text-zinc-400' }[tone]}`;
}

/** Live EAN validation in the form. Returns true when the field is empty or valid. */
function eanHint() {
  const v = form().elements.ean.value.replace(/\s/g, '');
  if (!v) {
    setHint('', 'info');
    return true;
  }
  if (!/^\d+$/.test(v)) {
    setHint('Только цифры', 'bad');
    return false;
  }
  if (isValidGtin(v)) {
    setHint(v.length === 12 ? '✓ UPC-A, будет сохранён как EAN-13 с ведущим 0' : '✓ Контрольная цифра верна', 'ok');
    return true;
  }
  if (v.length === 12) {
    setHint(`Для EAN-13 не хватает контрольной цифры → ${v}${computeCheckDigit(v)}`, 'bad');
    return false;
  }
  setHint(v.length >= 8 ? `✗ Неверная контрольная цифра (ожидается ${computeCheckDigit(v.slice(0, -1))})` : 'EAN: 8, 12, 13 или 14 цифр', 'bad');
  return false;
}

export function initProductForm() {
  form().elements.ean.addEventListener('input', eanHint);
  dialog().addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === dialog()) dialog().close();
  });
  form().addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#pf-error');
    err.classList.add('hidden');
    if (!eanHint()) {
      err.textContent = 'Исправьте EAN или оставьте поле пустым';
      return err.classList.remove('hidden');
    }
    const data = {};
    for (const f of FIELDS) data[f] = form().elements[f].value.trim();
    if (!data.ean && !data.article_no) {
      err.textContent = 'Укажите EAN или артикул';
      return err.classList.remove('hidden');
    }
    const res = editingId ? await api.updateProduct(editingId, data) : await api.createProduct(data);
    if (!res.ok) {
      err.textContent = errorMessage(res);
      return err.classList.remove('hidden');
    }
    dialog().close();
    toast(editingId ? 'Товар обновлён' : 'Товар добавлен в каталог', 'ok');
    onSaved?.(res.data);
  });
}

/**
 * Open the dialog. `product` with an id edits it; otherwise creates a new one prefilled
 * from `product` (e.g. external result) or from the scanned code.
 */
export function openProductForm({ product = null, code = null, saved = null } = {}) {
  editingId = product?.id ?? null;
  onSaved = saved;
  form().reset();
  $('#pf-error').classList.add('hidden');
  $('#product-dialog-title').textContent = editingId ? 'Изменить товар' : 'Новый товар';
  const values = { currency: 'PLN', ...(product || {}) };
  if (!product && code) {
    const c = classifyCode(code);
    if (c.ok && c.type === 'ean') values.ean = c.normalized;
    else values.article_no = code;
  }
  for (const f of FIELDS) {
    const v = values[f];
    form().elements[f].value = Array.isArray(v) ? v.join(', ') : v ?? '';
  }
  eanHint();
  dialog().showModal();
  form().elements.name.focus();
}
