# API

Все ответы в JSON. Ошибки: `{ "error": { "code": "…", "message": "…", …доп. поля } }`.

| HTTP | `error.code` | Когда |
|---|---|---|
| 400 | `EMPTY`, `BAD_DATE`, `BAD_ID`, `VALIDATION`, `CONFIRM_REQUIRED` | неверные параметры |
| 401 | `UNAUTHORIZED` | включён Basic auth |
| 404 | `NOT_FOUND` | товар или запись не найдены |
| 409 | `DUPLICATE_EAN` | EAN уже есть в каталоге |
| 413 | `TOO_LARGE` | слишком большое тело запроса |
| 422 | `INVALID_EAN` (+`expectedCheckDigit`), `INVALID_CODE`, `VALIDATION` | неверный код или данные |
| 429 | `RATE_LIMITED` (+`retryAfter`, заголовок `Retry-After`) | лимит API или внешних запросов |

## `GET /api/lookup`

| Параметр | |
|---|---|
| `code` | EAN-8/12/13/14, артикул или OEM (до 40 символов) |
| `type` | `auto` (по умолчанию), `ean`, `article` (например, «искать как артикул» для кода с неверной контрольной цифрой) |
| `refresh=1` | пропустить локальный каталог и кэш, перезапросить внешний источник |
| `log=0` | не записывать в историю |

Ответ 200:

```json
{
  "code": "5050063083767", "codeType": "ean", "found": true,
  "source": "local|autodoc|scraper|mock", "cached": false, "match": "exact|probable",
  "product": { "id": 1, "ean": "…", "article_no": "…", "brand": "…", "name": "…",
               "oem_numbers": ["…"], "price": 23.49, "currency": "PLN", "availability": "…",
               "image_url": "…", "product_url": "…", "source": "autodoc", "notes": null },
  "alternatives": [], "warnings": [{ "provider": "autodoc", "code": "UPSTREAM_BLOCKED", "message": "…" }],
  "autodocSearchUrl": "https://www.autodoc.pl/search?keyword=…", "scanId": 42
}
```

Ответ 404 (`NOT_FOUND`) имеет ту же форму с `found: false`. `warnings` объясняют, почему не помог внешний источник.

## История

- `GET /api/scans?from=<ISO>&to=<ISO>&found=1|0&type=ean|article|invalid&q=<текст>&limit=100&offset=0` → `{ items, total }`
- `GET /api/scans/export.csv?<те же фильтры>&tz=<IANA zone>&sep=comma` — по умолчанию разделитель `;`, UTF-8 BOM, десятичная запятая (Excel PL/RU)
- `GET /api/stats?<фильтры>` → `{ total, found, not_found, invalid, unique_codes, by_source }`
- `DELETE /api/scans/:id`
- `DELETE /api/scans?confirm=1&<фильтры>` → `{ deleted }`

## Каталог

- `GET /api/products?q=&limit=&offset=` → `{ items, total }`
- `GET /api/products/:id`
- `POST /api/products` — `name` обязательно, плюс `ean` или `article_no`; `oem_numbers` — массив или строка через запятую
- `PUT /api/products/:id` — частичное обновление
- `DELETE /api/products/:id`
- `POST /api/products/import` с `Content-Type: text/csv` → `{ inserted, updated, errors: [{ line, message }] }`
- `GET /api/products/export.csv`

## Служебное

- `GET /api/health` → `{ ok, providers, external: { usedToday, dailyLimit, queued, cooldownUntil, cooldownReason }, robots }`. Доступен без Basic auth (для healthcheck платформы).
