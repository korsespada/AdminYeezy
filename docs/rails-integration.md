# Интеграция AdminYeezy с Rails API

## Цель

Сохранить текущие scraping-возможности, но перестать использовать legacy `shop` как backend опубликованного каталога. Новые товары должны попадать на сайт через Rails API.

## Почему нельзя подключить Rails-БД напрямую

Старая админка ожидает legacy-схему: `products.price`, массив `brand`, отдельную таблицу `subcategories` и таблицу `admins`. Rails использует `price_cents`, `brand_id`, дерево `categories`, `product_media`, `admin_users` и callbacks индексации.

Прямые SQL-запросы к Rails CRM Postgres обойдут бизнес-логику и могут повредить данные.

## Этап 1. Rails auth

Перевести login на:

```text
POST /api/v1/admin/auth/login
GET  /api/v1/admin/auth/me
```

JWT хранить в HttpOnly cookie. Production fallback через plaintext-таблицу `admins` удалить.

### Runtime authentication

Интерактивные запросы из `/admin/*` всегда передают JWT текущего оператора из
HttpOnly cookie `admin_token`. При отсутствии или истечении cookie production
страница не должна выполнять вход через `RAILS_ADMIN_EMAIL` и
`RAILS_ADMIN_PASSWORD`: пользователя нужно вернуть на `/login`.

Переменные `RAILS_ADMIN_TOKEN` и `RAILS_ADMIN_EMAIL` / `RAILS_ADMIN_PASSWORD`
разрешены только для явных server/background-операций. Если такой процесс
получает JWT по email/password, параллельные запросы обязаны совместно ждать
один login-запрос и использовать выданный JWT из процесса-кеша.

## Этап 2. Каталог

Перевести просмотр и редактирование опубликованных товаров на:

```text
GET    /api/v1/admin/products
GET    /api/v1/admin/products/:id
POST   /api/v1/admin/products
PATCH  /api/v1/admin/products/:id
DELETE /api/v1/admin/products/:id
POST   /api/v1/admin/products/:id/reindex
```

Scraping-товары внутри партий продолжают жить в `yeezy_scraping.products` до публикации.

## Этап 3. Публикация партий

Целевой поток:

```text
yeezy_scraping.products
  -> CSV adapter
  -> POST /api/v1/admin/import_batches
  -> Rails CRM Postgres
  -> search/media jobs
  -> storefront
```

CSV adapter должен:

- принимать внутренний `;`-CSV;
- сохранять стабильный `external_id`;
- преобразовывать JSON-массив фото в формат Rails importer;
- мапить legacy ID брендов и категорий;
- публиковать чанками;
- показывать ошибки партии в UI.

Для JSON-публикации адаптер передаёт технический `external_id`, slug товара, необязательные `video_url`/`video_poster_url` и массив `media`, где у каждого изображения есть HTTPS URL, `alt_text`, `sort_order` и `processing_status`. Rails сохраняет `external_id` только как ключ идемпотентной синхронизации. Финальный slug Rails формирует централизованно из бренда, названия, подтверждённых модели и цвета, а также внутреннего SEO-артикула; длинный `external_id` не попадает ни в slug товара, ни в имя изображения. При прямом обновлении существующего товара используется `PATCH /api/v1/admin/products/:id` с тем же набором медиа-полей.

Из исторического AI-snapshot можно выполнить отдельную синхронизацию в Rails:
snapshot используется как источник товаров, текущая версия партии в scraping DB
не изменяется. Существующие товары обновляются через upsert, отсутствующие в
snapshot товары этой партии удаляются из Rails по `external_id`. Перед удалением
проверяются связи с другими партиями. Медиа переиспользуются по уже известным
URL; повторная загрузка нужна только для новых или изменённых фотографий.

При публикации партия также передаёт исходный `source_supplier_id`, дату публикации
у поставщика `supplier_published_on` и `published_at`. Так как scraping DB и Rails CRM используют разные базы и разные
идентификаторы, Rails связывает товар с поставщиком по имени как с основной
связью, а исходный ID сохраняется в `metadata.source_supplier_id`. Время пуша
сохраняется в штатном поле Rails `published_at` и дублируется в
`metadata.source_published_at` для обратной совместимости. Дата альбома поставщика
хранится отдельно в `metadata.supplier_published_on`, поэтому её нельзя путать со
временем публикации в каталог; для старых партий это поле остаётся пустым.

## Этап 4. CRM

CRM-экраны живут в `AdminYeezy` и работают через Rails admin endpoints:

```text
GET  /api/v1/admin/orders
GET  /api/v1/admin/orders/:id
POST /api/v1/admin/orders/:id/transitions
POST /api/v1/admin/order_items/:id/transitions
POST /api/v1/admin/order_items/:id/supplier_requests
POST /api/v1/admin/supplier_requests/:id/responses
POST /api/v1/admin/order_items/:id/replacement_offers
GET  /api/v1/admin/refunds
POST /api/v1/admin/refunds/:id/approve
POST /api/v1/admin/refunds/:id/reject
GET  /api/v1/admin/wallet_withdrawal_requests
POST /api/v1/admin/wallet_withdrawal_requests/:id/approve
POST /api/v1/admin/wallet_withdrawal_requests/:id/reject
POST /api/v1/admin/wallet_withdrawal_requests/:id/mark_paid
GET  /api/v1/admin/customers
```

## Chromoff

Новый раздел `/admin/chromoff` использует отдельные Rails endpoints:

```text
GET    /api/v1/admin/chromoff/categories
PATCH  /api/v1/admin/chromoff/categories/:id
GET    /api/v1/admin/chromoff/listings
PATCH  /api/v1/admin/chromoff/listings/:id
```

Публичная витрина Chromoff получает только опубликованные listings через
`/api/v1/catalog/chromoff/*`. У listing есть собственная категория, legacy URL
SEO-поля, `sync_mode` и источник поставщика. Поэтому одна и та же карточка может оставаться в своей категории
YeezyUnique и одновременно иметь другое меню/SEO на Chromoff.

Пуш из `/admin/import_batches` автоматически создаёт или обновляет listing для
товаров разрешённых Chromoff-поставщиков независимо от бренда. Новые listings
создаются скрытыми до ручной проверки; listings с `sync_mode=manual` не меняются.
Если AI не выбрал категорию Chromoff, `chromoff_category_id` остаётся пустым,
listing получает `needs_review` и назначается из `/admin/chromoff`.

Не менять статусы заказов, платежи, возвраты и wallet прямым SQL.

## Проверка

1. Вход выполняется Rails-учетной записью.
2. Изменение опубликованного товара появляется на сайте.
3. Тестовая партия публикуется без дублей при повторном запуске.
4. CRM customers, orders, refunds и wallet withdrawals открываются через Rails JWT.
5. Legacy-БД `shop` не меняется в результате новой публикации.

Полная карта разделов: [admin-sections.md](./admin-sections.md).
