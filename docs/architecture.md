# Архитектура AdminYeezy

## Назначение

`AdminYeezy` - отдельная операционная админка на `https://admin.yeezyunique.ru`. Она не является частью публичного storefront и разворачивается независимо.

## Целевая схема

```text
AdminYeezy -> yeezy_scraping
           -> Rails API -> Rails CRM Postgres -> storefront

legacy shop DB -> Rails bootstrap importer
NocoDB         -> yeezy_scraping
NocoDB         -> Rails CRM read-only access
```

## Границы данных

| Система | Что хранит | Кто пишет |
|---|---|---|
| `yeezy_scraping` | Поставщики, scraping-задачи, CSV-снапшоты, AI-результаты, партии | `AdminYeezy` |
| Rails CRM Postgres | Опубликованный каталог, клиенты, заказы, платежи, возвраты, wallet | Rails services |
| Legacy `shop` | Старый каталог и переходные справочники | Старый контур до завершения миграции |
| Elasticsearch | Поисковая read model | Rails search jobs |
| S3/CDN | Изображения | Media pipeline |

Rails CRM Postgres является единственным source of truth для сайта. `yeezy_scraping` не заменяет CRM-БД, а `shop` не должен использоваться как основная БД нового сайта.

## Почему отдельный сервис

- В админке есть Python-скрипты, worker-задачи и техническая БД.
- Деплой админки не должен рисковать публичным storefront.
- Storefront и `AdminYeezy` используют разные версии Next.js.
- Доступ к `admin.yeezyunique.ru` проще ограничивать отдельно.

## Этапы развития

1. Сохранить работающие scraping, AI и analytics экраны.
2. Перевести вход и опубликованный каталог на Rails API.
3. Публиковать партии через Rails import API.
4. Развивать CRM-экраны заказов, клиентов, возвратов, wallet и supplier workflow поверх Rails API.

Актуальная карта разделов: [admin-sections.md](./admin-sections.md).
Порядок деплоя и smoke-checks: [deployment-runbook.md](./deployment-runbook.md).
