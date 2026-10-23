# Переход на PostgreSQL

Весь SQL сосредоточен в `backend/src/db/index.js` (`openDb()` возвращает объект-репозиторий). Маршруты и сервисы вызывают только методы репозитория, поэтому переход сводится к новой реализации этого модуля.

## Схема

`schema.sql` совместима с PostgreSQL при следующих заменах:

| SQLite | PostgreSQL |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGSERIAL PRIMARY KEY` |
| `REAL` (price) | `NUMERIC(12,2)` |
| `TEXT` для дат | можно оставить (ISO-8601 сравнивается лексикографически) или `TIMESTAMPTZ` |
| `oem_numbers TEXT` (JSON) | `JSONB` + GIN-индекс; `oem_norm` можно заменить на `TEXT[]` с `ANY()` |

Частичный уникальный индекс `ON products (ean) WHERE ean IS NOT NULL` и `ON CONFLICT … DO UPDATE` поддерживаются в PostgreSQL без изменений.

## Шаги

1. `npm --prefix backend install pg`.
2. Создать `src/db/postgres.js` с тем же набором методов (`findProducts`, `listProducts`, `createProduct`, `updateProduct`, `upsertProduct`, `addScan`, `listScans`, `iterateScans`, `scanStats`, `getCache`/`setCache`, …). Плейсхолдеры `?` заменить на `$1, $2…`, методы сделать `async`.
3. В `app.js` выбирать реализацию по `DATABASE_URL`: `const repo = process.env.DATABASE_URL ? await openPg(...) : openDb(...)`; в `LookupService` и маршрутах добавить `await` перед вызовами репозитория (Express 5 сам обрабатывает async-ошибки).
4. Импорт CSV: `BEGIN/COMMIT` через `client.query`, вставка батчами.
5. Перенос данных: `GET /api/products/export.csv` → импорт в новый инстанс. История сканов: `GET /api/scans/export.csv` или `sqlite3 … .dump` с правкой типов.

Тесты в `backend/test/api.test.js` работают через HTTP и не зависят от БД. Их можно запускать против Postgres-реализации без изменений.
