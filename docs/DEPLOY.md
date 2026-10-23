# Деплой

Приложение — один процесс Node.js (API + статика) и файл SQLite. Нужен **постоянный диск** для `/data`, иначе история и каталог пропадут при перезапуске.

## Railway (рекомендуется)

1. New Project → Deploy from GitHub repo → выберите репозиторий. `railway.json` укажет на `Dockerfile` и healthcheck `/api/health`.
2. Service → **Volumes** → Add Volume, mount path `/data`.
3. Variables:
   ```
   DB_PATH=/data/scanner.db
   EXTERNAL_PROVIDERS=            # пусто = только локальный каталог (или mock для демо)
   BASIC_AUTH_USER=sklad
   BASIC_AUTH_PASS=<длинный пароль>
   ```
   `PORT` Railway задаёт сам.
4. Settings → Networking → Generate Domain: получите HTTPS-адрес, камера на телефоне заработает.

## Render

1. New → **Blueprint** → репозиторий (используется `render.yaml`), либо New → Web Service → Docker.
2. Диск `/data` (1 GB) описан в `render.yaml`. Persistent disk доступен только на платных планах; на Free данные не сохраняются между деплоями.
3. В Environment задайте `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` (в blueprint они `sync: false`).

## Vercel (не рекомендуется для этого проекта)

Vercel запускает serverless-функции без постоянного диска: SQLite будет пустым после каждого холодного старта, а in-memory лимиты и очередь запросов не разделяются между инстансами. Варианты:

- **Фронтенд на Vercel, бэкенд на Railway/Render.** Задеплойте папку `frontend/` как статический сайт и добавьте в проект Vercel `vercel.json` с rewrite `/api/*`, `/vendor/*`, `/lib/*` на адрес бэкенда:
  ```json
  { "rewrites": [
      { "source": "/api/:path*", "destination": "https://<backend>.up.railway.app/api/:path*" },
      { "source": "/vendor/:path*", "destination": "https://<backend>.up.railway.app/vendor/:path*" },
      { "source": "/lib/:path*", "destination": "https://<backend>.up.railway.app/lib/:path*" } ] }
  ```
- **Полностью на Vercel** возможно только после перехода на PostgreSQL ([POSTGRES.md](POSTGRES.md)) и экспорта `createApp()` как serverless-обработчика. Это отдельная доработка.

## Свой сервер / VPS

```bash
docker build -t barcode-scanner .
docker run -d --name scanner --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v scanner-data:/data --env-file .env barcode-scanner
```

Перед контейнером поставьте Caddy или Nginx с HTTPS (Caddy: `scanner.example.com { reverse_proxy 127.0.0.1:3000 }`).

## Бэкап

SQLite в WAL-режиме: копируйте через `sqlite3 /data/scanner.db ".backup /backup/scanner-$(date +%F).db"` или делайте снапшот тома. Для каталога достаточно `GET /api/products/export.csv`.

## Обновление Tailwind

`frontend/css/tailwind.css` собран заранее и закоммичен, поэтому в Docker сборка CSS не нужна. После изменения классов в `index.html` или `js/` выполните `npm run build:css` и закоммитьте результат.
