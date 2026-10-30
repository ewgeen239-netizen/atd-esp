# M13 · инструменты склада

| Файл | Что это |
|---|---|
| `index.html` | Меню: 4 режима, у каждого печать |
| `scan.html` | Сканер: ArticleId (в т.ч. найденный на этикетке) → Code-128 |
| `locations.html` | Скриншоты WMS → маршрут → лист отбора / этикетки A4 |
| `rules.html` | Сканер с правилами M13 |
| `scan-classic.html` | Старый сканер, для Huy |
| `netlify/functions/name.mjs` | Сервер названий: `/api/name/<ArticleId>` → название товара с autodoc.pl |
| `netlify.toml` | Настройки Netlify (сайт = эта папка + функция) |

## Развёртывание на Netlify с автопоиском названий

Netlify Drop (перетаскивание папки) публикует только страницы — **функция названий так не загружается**.
Нужен один из двух способов:

### А. Из GitHub (рекомендуется: обновляется само после каждого push)
1. app.netlify.com → **Add new site → Import an existing project → GitHub**.
2. Репозиторий `atd-esp`, ветка `claude/autodoc-barcode-scanner`.
3. **Base directory:** `m13` · **Build command:** пусто · **Publish directory:** `m13` (подставится из `netlify.toml`).
4. **Deploy**. Уже созданный через Drop сайт можно привязать так же: *Site configuration → Build & deploy → Link repository*.

### Б. Netlify CLI (с компьютера, из этой папки)
```bash
npm install -g netlify-cli
cd m13
netlify login
netlify link        # выбрать существующий сайт (или netlify init для нового)
netlify deploy --prod
```

### Проверка
Откройте `https://<ваш-сайт>.netlify.app/api/name/251310` — должен прийти JSON с `name`.
Если `{"error":"blocked"}` — AutoDoc не пускает запросы с серверов Netlify; тогда названия вводятся вручную (🔎 в строке).

Ответы кэшируются на CDN Netlify (найдено — 7 дней, не найдено — 1 день), поэтому один и тот же
Article ID не запрашивается у AutoDoc повторно. Автоматический сбор данных с autodoc.pl может
противоречить правилам сайта — используйте умеренно.
Свой User-Agent: переменная окружения `AUTODOC_USER_AGENT` в настройках сайта Netlify.
