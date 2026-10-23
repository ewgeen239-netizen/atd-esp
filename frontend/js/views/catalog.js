import { api, errorMessage } from '../api.js';
import { openProductForm } from '../product-form.js';
import { $, debounce, fmtPrice, h, sourceBadge, toast } from '../ui.js';

const PAGE = 50;
let offset = 0;
let state;

function row(p) {
  return h('li', { class: 'flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2' },
    h('button', { class: 'min-w-0 flex-1 text-left', type: 'button', onclick: () => openProductForm({ product: p, saved: reload }) },
      h('div', { class: 'flex items-center gap-2' },
        sourceBadge(p.source),
        p.brand ? h('span', { class: 'text-xs font-semibold text-zinc-300' }, p.brand) : null,
        h('span', { class: 'truncate text-sm' }, p.name),
      ),
      h('div', { class: 'mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-zinc-400' },
        p.ean ? h('span', {}, `EAN ${p.ean}`) : null,
        p.article_no ? h('span', {}, `ART ${p.article_no}`) : null,
        p.oem_numbers.length ? h('span', {}, `OEM ×${p.oem_numbers.length}`) : null,
      ),
    ),
    h('span', { class: 'shrink-0 text-xs text-zinc-300' }, fmtPrice(p.price, p.currency)),
    p.ean
      ? h('button', { class: 'shrink-0 px-1 text-zinc-500 hover:text-accent', type: 'button', title: 'Штрих-код', 'aria-label': 'Штрих-код', onclick: () => state.go('barcode', { value: p.ean, caption: p.article_no }) }, '║')
      : null,
    h('button', {
      class: 'shrink-0 px-1 text-zinc-600 hover:text-red-400', type: 'button', title: 'Удалить', 'aria-label': 'Удалить товар',
      onclick: async () => {
        if (!confirm(`Удалить «${p.name}» из каталога?`)) return;
        const res = await api.deleteProduct(p.id);
        res.ok ? reload() : toast(errorMessage(res), 'error');
      },
    }, '✕'),
  );
}

export async function reload() {
  offset = 0;
  $('#cat-list').replaceChildren();
  await loadMore();
}

async function loadMore() {
  const res = await api.products({ q: $('#cat-q').value.trim(), limit: PAGE, offset });
  if (!res.ok) return toast(errorMessage(res), 'error');
  const { items, total } = res.data;
  $('#cat-total').textContent = `Товаров в локальном каталоге: ${total}`;
  if (!items.length && offset === 0) {
    $('#cat-list').append(h('li', { class: 'py-8 text-center text-sm text-zinc-500' }, 'Каталог пуст. Добавьте товар вручную или импортируйте CSV.'));
  }
  $('#cat-list').append(...items.map(row));
  offset += items.length;
  $('#cat-more').classList.toggle('hidden', offset >= total);
}

export function initCatalogView(appState) {
  state = appState;
  $('#cat-q').addEventListener('input', debounce(reload, 300));
  $('#cat-more').addEventListener('click', loadMore);
  $('#cat-add').addEventListener('click', () => openProductForm({ saved: reload }));
  $('#cat-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Файл больше 5 МБ', 'error');
    const res = await api.importProducts(await file.text());
    const out = $('#cat-import-result');
    out.classList.remove('hidden');
    if (!res.ok) {
      out.className = 'text-xs text-red-400';
      out.textContent = errorMessage(res);
      return;
    }
    const { inserted, updated, errors } = res.data;
    out.className = `text-xs ${errors.length ? 'text-amber-300' : 'text-emerald-400'}`;
    out.textContent = `Добавлено: ${inserted}, обновлено: ${updated}` +
      (errors.length ? `, ошибок: ${errors.length} — ${errors.slice(0, 3).map((x) => `стр. ${x.line}: ${x.message}`).join('; ')}` : '');
    reload();
  });
}
