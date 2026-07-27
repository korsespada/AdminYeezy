# Разделы AdminYeezy

`AdminYeezy` - операционная админка на `https://admin.yeezyunique.ru`. Публичный storefront не содержит админский UI; `/admin` на сайте должен редиректить сюда.

## Главный экран

| URL | Назначение | Источники |
|---|---|---|
| `/` | Redirect по auth-состоянию | cookie `admin_token` / `/login` |
| `/login` | Вход через Rails admin auth | `POST /api/v1/admin/auth/login` |
| `/admin/home` | Launchpad со всеми разделами | Rails API, `yeezy_scraping` status |

Production-доступ к `/admin/*` должен быть только по Rails JWT cookie `admin_token`. Локальные fallback-логины допустимы только в development.

## Каталог

| URL | Назначение | Режим |
|---|---|---|
| `/admin` | Опубликованные товары | Rails admin/products |
| `/admin/brands` | Бренды | Rails catalog lookups, read-only |
| `/admin/categories` | Категории и подкатегории | Rails catalog lookups, read-only |
| `/admin/trash` | Архивированные товары | Rails admin/products |

Все изменения опубликованного каталога идут через Rails API. Прямые SQL-записи в Rails CRM Postgres запрещены.

## Scraping и публикация

| URL | Назначение | Источник |
|---|---|---|
| `/admin/batches` | Партии и выгрузки | `yeezy_scraping` + Rails import API |
| `/admin/suppliers` | Поставщики, альбомы, настройки | `yeezy_scraping` |
| `/admin/scraping` | Запуск и контроль scraping-задач | `yeezy_scraping`, scripts |

Целевой поток публикации:

```text
yeezy_scraping batch
  -> AdminYeezy CSV/import adapter
  -> POST /api/v1/admin/import_batches
  -> Rails CRM Postgres
  -> search/media jobs
  -> storefront
```

Подробная инструкция по работе с партиями, CSV-совместимости и атрибутам: [exports.md](./exports.md).

## Фильтры и характеристики

| URL | Назначение | Источник |
|---|---|---|
| `/admin/filter-characteristics` | Реестр атрибутов каталога и их режимов | Rails CRM: `catalog_attribute_definitions`, `catalog_attribute_values` |
| `/admin/catalog-attributes` | Проверка и подтверждение предложений AI | Rails catalog attribute suggestions |

В реестре можно отдельно включить показ атрибута в карточке, фильтрацию на сайте и использование как варианта товара. Подписи и алиасы применяются API при построении фасетов, поэтому старые варианты объединяются без массовой перезаписи товаров.

## CRM

| URL | Назначение | Rails API |
|---|---|---|
| `/admin/crm` | CRM launchpad и очереди | `/api/v1/admin/*` |
| `/admin/crm/orders` | Список заказов, queue/status/search | `GET /admin/orders` |
| `/admin/crm/orders/[id]` | Карточка заказа | `GET /admin/orders/:id` |
| `/admin/crm/refunds` | Возвраты, approve/reject | `/admin/refunds` |
| `/admin/crm/wallet-withdrawals` | Заявки на вывод wallet | `/admin/wallet_withdrawal_requests` |
| `/admin/crm/customers` | Пользователи/клиенты | `GET /admin/customers` |

Карточка заказа включает:

- order status transition;
- item-level status transition;
- supplier requests and supplier responses;
- replacement offers с поиском товара/variant picker;
- payments, refunds, customer info и timeline.

Refunds и wallet actions должны выполняться только Rails service endpoints:

```text
POST /api/v1/admin/refunds/:id/approve
POST /api/v1/admin/refunds/:id/reject
POST /api/v1/admin/wallet_withdrawal_requests/:id/approve
POST /api/v1/admin/wallet_withdrawal_requests/:id/reject
POST /api/v1/admin/wallet_withdrawal_requests/:id/mark_paid
```

## SEO и аналитика

| URL | Назначение | Источник |
|---|---|---|
| `/admin/seo-ai` | AI-каталог: очередь, сравнение, массовая обработка и настройки | Rails SEO AI API + local Cockpit Tools worker |
| `/admin/ai-rules` | AI processing rules | local/scraping settings |
| `/admin/analytics` | Операционные метрики | AdminYeezy analytics |

SEO landings, redirects, audits и AI-каталог относятся к Rails CRM/API. Production создаёт задания и хранит черновики, а локальный worker забирает их через защищённые `/api/v1/admin/seo_ai/worker/*` endpoints. Прямые записи в CRM-БД запрещены.

## Что важно не сломать

- `AdminYeezy` остается отдельным Next.js приложением.
- Rails CRM - source of truth для каталога, заказов, клиентов, платежей, возвратов и wallet.
- `yeezy_scraping` остается технической БД для парсинга, supplier/import batches и AI-процессов.
- NocoDB допустим только для контролируемого просмотра/ограниченной операторской работы, не для прямого CRM workflow.
- Storefront `/admin` не развивается как UI.
