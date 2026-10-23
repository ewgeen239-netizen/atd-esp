import { isValidGtin } from '/lib/ean.js';
import { fmtPrice, h, sourceBadge } from './ui.js';

function field(label, value, mono = false) {
  return [h('dt', {}, label), h('dd', { class: mono ? 'font-mono' : '' }, value ?? '—')];
}

/**
 * @param {object} result  /api/lookup response
 * @param {{onBarcode, onEdit, onAdd, onRefresh, onSearchAsArticle, canRefresh}} actions
 */
export function renderLookupResult(result, actions) {
  if (!result) return h('div');
  const err = result.error;

  if (result.found && result.product) return productCard(result, actions);

  if (err?.code === 'INVALID_EAN' || err?.code === 'INVALID_CODE') {
    return h('div', { class: 'card border-red-900 bg-red-950/40 space-y-3' },
      h('div', { class: 'flex items-center gap-2' }, h('span', { class: 'text-xl' }, '⚠'), h('h3', { class: 'font-semibold text-red-200' }, err.message)),
      h('p', { class: 'font-mono text-sm text-red-300' }, err.value),
      err.code === 'INVALID_EAN'
        ? h('p', { class: 'text-xs text-red-300/80' }, 'Скорее всего код считан с ошибкой: отсканируйте ещё раз или введите вручную. Если это не штрих-код, а номер детали — ищите как артикул.')
        : null,
      h('div', { class: 'flex flex-wrap gap-2' },
        err.code === 'INVALID_EAN' ? h('button', { class: 'btn-ghost btn-sm', type: 'button', onclick: () => actions.onSearchAsArticle(err.value) }, 'Искать как артикул') : null,
        err.autodocSearchUrl ? h('a', { class: 'btn-ghost btn-sm', href: err.autodocSearchUrl, target: '_blank', rel: 'noopener noreferrer' }, 'autodoc.pl ↗') : null,
      ),
    );
  }

  if (err?.code === 'RATE_LIMITED') {
    return h('div', { class: 'card border-amber-900 bg-amber-950/40 space-y-2' },
      h('h3', { class: 'font-semibold text-amber-200' }, '⏳ Лимит внешних запросов'),
      h('p', { class: 'text-sm text-amber-200/80' }, err.message),
      err.retryAfter ? h('p', { class: 'text-xs text-amber-300/70' }, `Повторите через ~${err.retryAfter} с. Локальный каталог продолжает работать.`) : null,
      result.autodocSearchUrl || err.autodocSearchUrl
        ? h('a', { class: 'btn-ghost btn-sm', href: result.autodocSearchUrl || err.autodocSearchUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Открыть поиск на autodoc.pl ↗')
        : null,
    );
  }

  if (err?.code === 'NOT_FOUND' || result.found === false) {
    return h('div', { class: 'card space-y-3 border-zinc-700' },
      h('div', { class: 'flex items-center justify-between gap-2' },
        h('h3', { class: 'font-semibold' }, '✗ Не найдено'),
        h('span', { class: 'badge bg-zinc-800 text-zinc-300' }, result.codeType === 'ean' ? 'EAN' : 'артикул'),
      ),
      h('p', { class: 'font-mono text-lg' }, result.code),
      warningsBlock(result.warnings),
      h('p', { class: 'text-xs text-zinc-400' }, 'Откройте товар на autodoc.pl, проверьте данные и добавьте его в локальный каталог — следующий скан найдёт его мгновенно.'),
      h('div', { class: 'flex flex-wrap gap-2' },
        h('a', { class: 'btn-ghost', href: result.autodocSearchUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Искать на autodoc.pl ↗'),
        h('button', { class: 'btn-primary', type: 'button', onclick: () => actions.onAdd(result) }, '+ Добавить вручную'),
        result.codeType === 'ean' ? h('button', { class: 'btn-ghost', type: 'button', onclick: () => actions.onBarcode(result.code) }, 'Штрих-код') : null,
      ),
    );
  }

  return h('div', { class: 'card border-red-900 bg-red-950/40 text-sm text-red-200' }, err?.message || 'Неизвестная ошибка');
}

function warningsBlock(warnings) {
  if (!warnings?.length) return null;
  return h('ul', { class: 'space-y-1 rounded-lg bg-amber-950/40 p-2 text-xs text-amber-200/90' },
    warnings.map((w) => h('li', {}, `${w.provider}: ${w.message}`)));
}

function productCard(result, actions) {
  const p = result.product;
  const eanOk = p.ean && isValidGtin(p.ean);
  const link = p.product_url || result.autodocSearchUrl;
  return h('article', { class: 'card space-y-3' },
    h('div', { class: 'flex gap-3' },
      p.image_url
        ? h('img', { src: p.image_url, alt: '', class: 'h-20 w-20 shrink-0 rounded-xl bg-white object-contain', loading: 'lazy', referrerpolicy: 'no-referrer' })
        : h('div', { class: 'flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-2xl text-zinc-600' }, '⚙'),
      h('div', { class: 'min-w-0 flex-1' },
        h('div', { class: 'mb-1 flex flex-wrap items-center gap-1.5' },
          sourceBadge(result.source === 'local' ? p.source || 'local' : result.source),
          result.cached ? h('span', { class: 'badge bg-zinc-800 text-zinc-400' }, 'кэш') : null,
          result.match === 'probable' ? h('span', { class: 'badge bg-amber-900/60 text-amber-300', title: 'Проверьте, что это тот же товар' }, 'похоже') : null,
          p.brand ? h('span', { class: 'text-xs font-semibold text-zinc-300' }, p.brand) : null,
        ),
        h('h3', { class: 'text-base font-semibold leading-snug' }, p.name),
      ),
    ),
    h('dl', { class: 'kv grid grid-cols-2 gap-x-4' },
      h('div', {}, field('EAN', p.ean ? `${p.ean} ${eanOk ? '✓' : '✗'}` : '—', true)),
      h('div', {}, field('Артикул', p.article_no, true)),
      h('div', {}, field('Цена', fmtPrice(p.price, p.currency))),
      h('div', {}, field('Наличие', p.availability)),
    ),
    p.oem_numbers?.length
      ? h('div', {},
          h('p', { class: 'mb-1 text-[11px] uppercase tracking-wide text-zinc-500' }, 'OEM / OE номера'),
          h('div', { class: 'flex flex-wrap gap-1' }, p.oem_numbers.slice(0, 20).map((o) => h('span', { class: 'chip' }, o))),
        )
      : null,
    p.notes ? h('p', { class: 'text-xs text-zinc-400' }, p.notes) : null,
    warningsBlock(result.warnings),
    h('div', { class: 'flex flex-wrap gap-2' },
      h('a', { class: 'btn-ghost btn-sm', href: link, target: '_blank', rel: 'noopener noreferrer' }, p.product_url ? 'autodoc.pl ↗' : 'Поиск на autodoc.pl ↗'),
      p.ean ? h('button', { class: 'btn-ghost btn-sm', type: 'button', onclick: () => actions.onBarcode(p.ean, p.article_no) }, 'Штрих-код') : null,
      p.id ? h('button', { class: 'btn-ghost btn-sm', type: 'button', onclick: () => actions.onEdit(p) }, 'Изменить') : null,
      !p.id ? h('button', { class: 'btn-ghost btn-sm', type: 'button', onclick: () => actions.onAdd(result) }, 'В каталог') : null,
      actions.canRefresh ? h('button', { class: 'btn-ghost btn-sm', type: 'button', onclick: () => actions.onRefresh(result.code) }, 'Обновить ↻') : null,
    ),
    result.alternatives?.length
      ? h('div', { class: 'border-t border-zinc-800 pt-2' },
          h('p', { class: 'mb-1 text-[11px] uppercase tracking-wide text-zinc-500' }, 'Также совпадает'),
          h('ul', { class: 'space-y-1 text-sm' }, result.alternatives.map((a) =>
            h('li', { class: 'flex justify-between gap-2' },
              h('span', { class: 'truncate' }, `${a.brand ? a.brand + ' · ' : ''}${a.name}`),
              h('span', { class: 'font-mono text-xs text-zinc-400' }, a.article_no || a.ean || ''),
            ))),
        )
      : null,
  );
}
