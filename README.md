# AdminYeezy

Операционная Next.js-админка YeezyUnique. Она сохраняется как отдельное приложение и разворачивается на:

```text
https://admin.yeezyunique.ru
```

Проект уже содержит рабочие инструменты просмотра товаров, scraping-партий, AI-обработки, поставщиков и аналитики. Переписывать его с нуля не нужно.

## Целевая архитектура

```text
AdminYeezy -> yeezy_scraping
           -> Rails API -> Rails CRM Postgres -> storefront
```

- `yeezy_scraping` - техническая БД этой админки: поставщики, задачи парсинга, CSV-снапшоты, AI и партии.
- Rails CRM Postgres - единственный source of truth для опубликованного каталога, сайта и будущей CRM.
- `shop` - legacy-каталог, только источник bootstrap-импорта и переходных справочников.
- NocoDB - дополнительный операторский инструмент, но не обход Rails workflow.

## Быстрый старт

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Перед запуском заполнить локальные значения в `.env.local`. Секреты нельзя коммитить.

## Документация

- [Архитектура](./docs/architecture.md)
- [Интеграция с Rails API](./docs/rails-integration.md)
- [Деплой в Coolify](./docs/coolify-deployment.md)
- [NocoDB](./docs/nocodb.md)
- [Post-process скрипты](./docs/postprocess-scripts.md)

## Важное ограничение

Текущий код все еще содержит переходные прямые SQL-запросы к legacy-каталогу. До завершения Rails-интеграции не направлять `DATABASE_URL` этой админки в Rails CRM Postgres: схемы несовместимы.
