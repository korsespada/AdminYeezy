# Архитектура AdminYeezy

## Назначение

`AdminYeezy` - отдельная операционная админка на `https://admin.yeezyunique.ru`. Она не является частью публичного storefront и разворачивается независимо.

## Целевая схема

```text
AdminYeezy -> yeezy_scraping
           -> Rails API -> Rails CRM Postgres -> storefront
                                      -> Chromoff storefront

legacy shop DB -> Rails bootstrap importer
NocoDB         -> yeezy_scraping
NocoDB         -> Rails CRM read-only access
```

## Границы данных

| Система | Что хранит | Кто пишет |
|---|---|---|
| `yeezy_scraping` | Поставщики, scraping-задачи, JSONB-снимки, AI-результаты, партии | `AdminYeezy` |
| Rails CRM Postgres | Опубликованный каталог, клиенты, заказы, платежи и возвраты | Rails services |
| Legacy `shop` | Старый каталог и переходные справочники | Старый контур до завершения миграции |
| Elasticsearch | Поисковая read model | Rails search jobs |
| S3/CDN | Изображения | Media pipeline |

Rails CRM Postgres является единственным source of truth для сайта. `yeezy_scraping` не заменяет CRM-БД, а `shop` не должен использоваться как основная БД нового сайта.

Responsive layout is presentation-only across the in-scope admin surfaces:
mobile cards, filter drawers/sheets, editors, navigation surfaces, and desktop
branches reuse the same routes, loaders, identifiers, callbacks, and source
boundaries. The responsive breakpoint is 1024 px; it does not introduce mobile
routes, a second data-fetch path, or a second mutation contract. Ordinary
catalog, CRM, Chromoff, and batch collections use cards below the breakpoint;
desktop tables/rows remain available at and above it. Horizontal scrolling is
reserved for real measurement/data matrices and is not used as a workaround
for ordinary entity collections.

## Chromoff catalog

`Chromoff` остаётся отдельной витриной Chrome Hearts, но не получает отдельную
операционную БД каталога. В Rails хранятся:

- общий товар и медиа;
- отдельная `ChromoffListing` с ручной публикацией, legacy URL и SEO overrides;
- отдельная `ChromoffCategory` hierarchy, сохраняющая меню Chromoff;
- техническая связь каждой Chromoff-категории с общей Rails taxonomy, которая
  не изменяет меню YeezyUnique.

Заказы, Telegram-пользователи, корзины и история старого Supabase-контура не
переносятся этим каталоговым контуром. До cutover Supabase используется только
как источник read-only dry-run и импорта; запись в него из AdminYeezy не нужна.

## Почему отдельный сервис

- В админке есть Python-скрипты, worker-задачи и техническая БД.
- Деплой админки не должен рисковать публичным storefront.
- Storefront и `AdminYeezy` используют разные версии Next.js.
- Доступ к `admin.yeezyunique.ru` проще ограничивать отдельно.

## Этапы развития

1. Сохранить работающие scraping, AI и analytics экраны.
2. Перевести вход и опубликованный каталог на Rails API.
3. Публиковать партии через Rails import API.
4. Развивать CRM-экраны заказов, клиентов и Telegram-коммуникации поверх Rails API.

Актуальная карта разделов: [admin-sections.md](./admin-sections.md).
Порядок деплоя и smoke-checks: [deployment-runbook.md](./deployment-runbook.md).
