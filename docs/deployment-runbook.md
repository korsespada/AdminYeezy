# Runbook деплоя AdminYeezy и сайта

## Порядок деплоя

1. Rails CRM API.
2. AdminYeezy.
3. Smoke-check AdminYeezy на реальных данных.
4. Storefront.
5. Smoke-check публичного сайта.

Такой порядок нужен потому, что AdminYeezy уже зависит от новых Rails admin endpoints, включая customers, refunds, wallet и CRM order workflows.

## Перед деплоем

Проверить локально:

```bash
npm run lint
npm run build
npm test -- --run __tests__/unit/lib/rails-admin.test.ts
```

Для Rails API:

```bash
bin/rails test test/controllers/api/v1/admin/customers_controller_test.rb \
  test/controllers/api/v1/admin/orders_controller_test.rb \
  test/controllers/api/v1/refunds_wallet_controller_test.rb
```

Секреты не хранить в репозитории. Пароли, токены, SSH-доступы и Coolify env должны передаваться только через защищенный канал/панель сервера.

Для сохранённых AI-провайдеров добавьте в Coolify `AI_PROVIDER_ENCRYPTION_KEY` — длинный случайный секрет. Он используется для AES-256-GCM шифрования ключей в `yeezy_scraping.ai_providers`; без него кнопка добавления провайдера отклоняется. При ротации этого секрета ранее сохранённые ключи потребуется перенести заново.

## Rails API deploy

Обязательные изменения перед AdminYeezy:

- route `GET /api/v1/admin/customers`;
- `Api::V1::Admin::CustomersController`;
- действующие endpoints для orders, order_items, supplier_requests, replacement_offers, refunds, wallet withdrawals;
- CORS разрешает `https://admin.yeezyunique.ru`.

Минимальный env Rails:

```env
CORS_ORIGINS=https://yeezyunique.ru,https://tg.yeezyunique.ru,https://admin.yeezyunique.ru
```

Smoke-check Rails:

```bash
curl -i https://api.yeezyunique.ru/api/v1/health
curl -i https://api.yeezyunique.ru/api/v1/catalog/brands
```

Admin endpoints проверять только с валидным admin JWT:

```bash
curl -i -H "Authorization: Bearer $ADMIN_JWT" \
  https://api.yeezyunique.ru/api/v1/admin/customers
```

## AdminYeezy deploy

Домен:

```text
https://admin.yeezyunique.ru
```

Минимальный production env:

```env
ADMIN_BASE_URL=https://admin.yeezyunique.ru
RAILS_API_URL=https://api.yeezyunique.ru/api/v1
SCRAPING_DATABASE_URL=postgresql://...
```

Перед запуском нового образа применить все scraping/AI-миграции:

```bash
npm run db:migrate:scraping
npm run db:audit:batches
```

При старте контейнера дополнительно автоматически выполняется идемпотентная
миграция `db:migrate:media-seo`, которая гарантирует наличие полей SEO/медиа
(`products.slug`, `products.photo_alts`, `products.photo_slugs`,
`products.supplier_published_on`) и имени цветовой семьи
(`products.variant_group_name`). Поэтому открытие выгрузок не зависит от того,
была ли ручная полная миграция выполнена до redeploy.

При старте также выполняется узкая идемпотентная миграция
`db:migrate:supplier-ai`, которая гарантирует наличие
`suppliers.ai_processing_options`. Это покрывает redeploy после обновлений
настроек поставщика и не заменяет полную `db:migrate:scraping` перед крупным
изменением схемы.

При старте также выполняется `db:migrate:measurement-templates`; она создаёт
таблицу `measurement_templates`, нужную библиотеке шаблонов замеров. Поэтому
после первого деплоя с этой функцией отдельно выполнять миграцию в контейнере
не требуется.

При старте также выполняется `db:migrate:catalog-deletion`; она добавляет
идемпотентное поле `scraping_batches.catalog_deleted_at`, чтобы история могла
отличать удаление товаров с сайта от удаления локальной выгрузки.

При старте также выполняется `db:migrate:chromoff-ai`; она создаёт технические
таблицы очереди `chromoff_ai_runs` и `chromoff_ai_items` в scraping DB.

Команда идемпотентна. В том числе она создаёт блокировки операций, реестр публикаций, уникальный активный запуск парсера на поставщика и ограничения связей задач/партий/товаров.

При наличии старой очереди с колонкой `settings` её настройки переносятся в
`settings_snapshot`, а старые `pending/running` items переводятся в `failed` с
сообщением о ручном возобновлении. После деплоя проверьте очередь в разделе
`/admin/chromoff/ai-seo` и нажмите «Возобновить» для таких запусков.

Auth:

- production UI login идет через `POST /api/v1/admin/auth/login`;
- browser session хранит Rails JWT в HttpOnly cookie `admin_token`;
- browser-запросы к Rails используют только `admin_token`; если cookie истёк, пользователь повторно входит через `/login`;
- `RAILS_ADMIN_EMAIL`, `RAILS_ADMIN_PASSWORD` и `RAILS_ADMIN_TOKEN` допустимы только для явных server/background операций или временного override;
- plaintext `admins` fallback не должен работать в production.

Smoke-check AdminYeezy:

```text
https://admin.yeezyunique.ru/login
https://admin.yeezyunique.ru/admin/home
https://admin.yeezyunique.ru/admin
https://admin.yeezyunique.ru/admin/crm
https://admin.yeezyunique.ru/admin/crm/orders
https://admin.yeezyunique.ru/admin/crm/customers
https://admin.yeezyunique.ru/admin/crm/refunds
https://admin.yeezyunique.ru/admin/crm/wallet-withdrawals
```

Проверить вручную:

- без login `/admin/*` редиректит на `/login`;
- после login brand в header ведет на `/admin/home`;
- `/admin` открывает каталог товаров;
- `/admin/brands` и `/admin/categories` грузятся из Rails lookups;
- CRM customers открывается и ищет по email/phone/Telegram/referral;
- order detail открывается из списка заказов;
- refund approve/reject и wallet approve/reject/mark paid отправляют запросы в Rails, а не в локальную БД;
- scraping/batches/suppliers продолжают видеть `yeezy_scraping`.

## Storefront deploy

Деплоить после успешного AdminYeezy smoke-check.

Проверить публичные решения:

- storefront `/admin` и `/admin/login` permanent redirect на `https://admin.yeezyunique.ru`;
- `/brand/{slug}` permanent redirect на `/collections/{slug}` с query params;
- sitemap не содержит `/admin`, `/admin/login`, `/brand/*`;
- `/collections/{brand-slug}` canonical/metadata указывают на collections URL.

Smoke-check storefront:

```text
https://yeezyunique.ru/
https://yeezyunique.ru/collections
https://yeezyunique.ru/collections/{brand-slug}
https://yeezyunique.ru/product/{product-slug}
https://yeezyunique.ru/lk/orders
```

## Rollback

Если Rails API не проходит smoke-check, не деплоить AdminYeezy.

Если AdminYeezy не проходит login или CRM smoke-check:

- откатить AdminYeezy к предыдущему образу/коммиту;
- Rails API можно оставить, если публичный сайт и старые endpoints работают;
- storefront не деплоить до восстановления AdminYeezy.

Если storefront deploy ломает публичный сайт:

- откатить storefront;
- AdminYeezy и Rails API не откатывать автоматически, если CRM smoke-check зеленый.
