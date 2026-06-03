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

## Этап 4. CRM позже

Добавить в `AdminYeezy` страницы заказов, карточку заказа, возвраты и supplier workflow через готовые Rails admin endpoints. Не менять статусы заказов, платежи, возвраты и wallet прямым SQL.

## Проверка

1. Вход выполняется Rails-учетной записью.
2. Изменение опубликованного товара появляется на сайте.
3. Тестовая партия публикуется без дублей при повторном запуске.
4. Legacy-БД `shop` не меняется в результате новой публикации.
