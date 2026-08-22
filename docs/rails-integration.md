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
GET    /api/v1/admin/products/facets
GET    /api/v1/admin/products/facets_batch
GET    /api/v1/admin/products/:id
POST   /api/v1/admin/products
PATCH  /api/v1/admin/products/:id
DELETE /api/v1/admin/products/:id
DELETE /api/v1/admin/products/:id/force_destroy
POST   /api/v1/admin/products/:id/reindex
```

Список и фасеты админского каталога используют один scope: архивные товары
исключаются по умолчанию, а явный `status=archived` используется для просмотра
архивных товаров (в том числе в корзине).
Админский список также принимает `status=active|hidden|draft|archived` для
переключения между статусами; без параметра показываются все товары, кроме
архивных.
`category` включает дочерние категории, `subcategory` выбирает одну точную
категорию, а `subcategory_missing=true` оставляет только товары, назначенные
непосредственно родительской категории. `category_missing=true` выбирает товары
без категории. Для фильтров пола `gender_exact=true`
исключает `unisex`; без этого флага мужской и женский фильтры могут включать
унисекс-товары, а `gender_missing=true` выбирает товары без гендера.

`facets_batch` возвращает фасеты для всех фильтров одним HTTP-запросом. Rails
рассчитывает только нужное измерение для каждого фильтра, поэтому экран
каталога не запускает семь повторных полных JSONB-агрегаций. AdminYeezy
временно откатывается к отдельным запросам `/facets`, если endpoint ещё не
развёрнут в Rails.

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
- показывать ошибки партии в UI, включая поля и сообщения `details`, возвращённые Rails при `422 Validation failed`.

Для JSON-публикации адаптер передаёт технический `external_id`, slug товара, необязательные `video_url`/`video_poster_url` и массив `media`, где у каждого изображения есть HTTPS URL, `alt_text`, `sort_order` и `processing_status`. Rails сохраняет `external_id` только как ключ идемпотентной синхронизации. В `name` передаётся видимое название без бренда, но с цветом: бренд хранится отдельно, а цвет также дублируется в атрибутах. Rails централизованно записывает H1 равным `name`, а title и meta description формирует из бренда, названия и текущей цены, поэтому ручное изменение цены сразу обновляет title. Финальный slug Rails формирует из бренда, названия, подтверждённых модели и цвета, а также внутреннего SEO-артикула; длинный `external_id` не попадает ни в slug товара, ни в имя изображения. SEO-артикул присутствует в каждом slug и обеспечивает его уникальность даже для товаров с совпадающими текстовыми данными. При прямом обновлении существующего товара используется `PATCH /api/v1/admin/products/:id` с тем же набором медиа-полей. Перед таким запросом AdminYeezy преобразует категорию и подкатегорию по актуальному дереву Rails, а при отсутствии соответствия сохраняет уже назначенную Rails-категорию.

Если при публикации найден архивный Rails-товар с тем же `external_id`, Rails переиспользует эту запись независимо от её исторического поставщика: восстанавливает статус из входной строки, очищает `archived_at`, назначает текущего поставщика и синхронизирует варианты. Это предотвращает создание второго товара с теми же глобально уникальными SKU размеров; активные товары другого поставщика такой логикой не затрагиваются.

Для ручного ведения таксономии `Настройки ИИ` читает полный административный справочник брендов и категорий через `GET /api/v1/admin/catalog_taxonomy/brands` и `GET /api/v1/admin/catalog_taxonomy/categories`, а категории создаёт через `POST /api/v1/admin/catalog_taxonomy/categories` и `POST /api/v1/admin/catalog_taxonomy/subcategories`. Поэтому новый бренд или категория с `indexing_status=needs_review` сразу доступны для правил и AI, но не появляются в публичном каталоге до отдельного одобрения/публикации. AdminYeezy не записывает Rails CRM напрямую.

Если архивная карточка удерживается только историческими `order_items`, owner/admin
может удалить её через `DELETE /api/v1/admin/products/:id/force_destroy`: снимки
названия, цены и изображения в заказе остаются, удаляется лишь ссылка на товар.
Карточка с replacement offer этим endpoint не удаляется.

Из исторического AI-snapshot можно выполнить отдельную синхронизацию в Rails:
snapshot используется как источник товаров, текущая версия партии в scraping DB
не изменяется. Существующие товары обновляются через upsert, отсутствующие в
snapshot товары этой партии удаляются из Rails по `external_id`. Перед удалением
проверяются связи с другими партиями. Медиа переиспользуются по уже известным
URL; повторная загрузка нужна только для новых или изменённых фотографий.

При публикации партия также передаёт исходный `source_supplier_id` (это
`suppliers.album_id` поставщика, не внутренний числовой `suppliers.id`), дату публикации
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
GET  /api/v1/admin/customers
GET  /api/v1/admin/customers/:id
GET  /api/v1/admin/telegram_notification_recipients
POST /api/v1/admin/telegram_notification_recipients
```

Получатель CRM может быть включён отдельно для `notify_site` (регистрации и
заказы сайта от auth-бота) и `notify_telegram_mini_app` (заявки Mini App от
`@YeezyUniqueBot`). Тестовый запрос передаёт `channel=site` или
`channel=telegram_mini_app`, чтобы проверить нужного бота.

Источник клиента фиксируется при первой регистрации: Telegram-вход на обычном
сайте относится к `site`, а `telegram_mini_app` используется только для
проверенного `init_data` Telegram Mini App. Наличие `telegram_id` само по себе
не является признаком Mini App; последующий вход через другой канал источник не
переключает.

В CRM остаются четыре вкладки: «Заказы», «Клиенты», «Telegram-сообщения» и
«Настройки CRM». В заказах используются только статусы `payment_pending`,
`paid`, `shipped`, `delivered`, `refund_pending`, `cancelled`; подтверждение
оплаты приходит callback от Platega. Заявки корзины без оплаты не являются
заказами и отправляются в Telegram-коммуникацию с номером `REQ-...`.

Карточка клиента показывает источник регистрации (`Сайт` или `Telegram Mini App`),
а список клиентов можно фильтровать по
источнику. В карточке клиента доступны контакты, заполненные адреса и история заказов. В карточке заказа
показываются одно фото товара, название и ссылка, номер, количество, размер и
сумма. Балансы, производственные статусы, supplier requests и replacement
offers не входят в CRM UI.

## Chromoff

Новый раздел `/admin/chromoff` использует отдельные Rails endpoints:

```text
GET    /api/v1/admin/chromoff/categories
PATCH  /api/v1/admin/chromoff/categories/:id
GET    /api/v1/admin/chromoff/listings
PATCH  /api/v1/admin/chromoff/listings/:id
DELETE /api/v1/admin/chromoff/listings/:id
PATCH  /api/v1/admin/chromoff/listings/bulk_update
GET    /api/v1/admin/chromoff/listings/:id/ai_content
PATCH  /api/v1/admin/chromoff/listings/:id/apply_ai_content
GET    /api/v1/admin/chromoff/ai_contents?page=1&per_page=40&q=&category_id=
POST   /api/v1/admin/chromoff/imports
```

Создание новых категорий Chromoff выполняется только через
`POST /api/v1/admin/chromoff/imports` (upsert по `source_id`): ручные
подразделы со страницы `/admin/chromoff/categories` отправляются туда с
псевдо-`source_id` вида `manual-<slug>` и пустым списком товаров.

Публичная витрина Chromoff получает только опубликованные listings через
`/api/v1/catalog/chromoff/*`. У listing есть собственная категория, legacy URL
SEO-поля, `sync_mode` и источник поставщика. Поэтому одна и та же карточка может оставаться в своей категории
YeezyUnique и одновременно иметь другое меню/SEO на Chromoff.

Пуш из `/admin/import_batches` автоматически создаёт или обновляет listing для
товаров разрешённых Chromoff-поставщиков независимо от бренда. Новые listings
создаются скрытыми до ручной проверки; listings с `sync_mode=manual` не меняются.
Если AI не выбрал категорию Chromoff, `chromoff_category_id` остаётся пустым,
listing получает `needs_review` и назначается из `/admin/chromoff`.
Массовая смена поставщика на `/admin/chromoff` обновляет источник listing и
общий `Product.primary_supplier`. В ответе Chromoff API `supplier_options`
сохраняет список source-поставщиков для фильтра, а
`assignable_supplier_options` содержит всех Rails-поставщиков для массового
назначения; выбранная существующая Rails-запись переиспользуется без создания
дубля по имени. Для одного из разрешённых source ID карточка становится
автосинхронизируемой, для другого поставщика - ручной.

Не менять статусы заказов, платежи и возвраты прямым SQL.

## Проверка

1. Вход выполняется Rails-учетной записью.
2. Изменение опубликованного товара появляется на сайте.
3. Тестовая партия публикуется без дублей при повторном запуске.
4. CRM customers, orders и Telegram-настройки открываются через Rails JWT.
5. Legacy-БД `shop` не меняется в результате новой публикации.

Полная карта разделов: [admin-sections.md](./admin-sections.md).
