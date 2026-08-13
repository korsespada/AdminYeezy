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
| `/admin/chromoff` | Каталог Chromoff: карточки товаров Chrome Hearts, фильтры по разделу, подкатегории, цене и публикации | Rails Chromoff API |
| `/admin/trash` | Архивированные товары | Rails admin/products |

Все изменения опубликованного каталога идут через Rails API. Прямые SQL-записи в Rails CRM Postgres запрещены.
В карточке товара основной сетки показываются только основные данные и цветовая
семья; поставщик, даты публикации и сводка атрибутов из сетки скрыты. Полный
список цветовых вариантов доступен внутри формы товара.

## Scraping и публикация

| URL | Назначение | Источник |
|---|---|---|
| `/admin/batches` | Партии и выгрузки | `yeezy_scraping` + Rails import API |
| `/admin/suppliers` | Поставщики, альбомы, настройки | `yeezy_scraping` |
| `/admin/scraping` | Запуск и контроль scraping-задач | `yeezy_scraping`, scripts |
| `/admin/measurement-templates` | Библиотека скриншотов и структурированных таблиц замеров для назначения в карточках выгрузки и массового назначения в каталоге | `yeezy_scraping.measurement_templates` |

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

## Шаблоны замеров

Оператор загружает скриншот размерной сетки, может распознать его через
настроенный OpenRouter/BYESU AI и проверяет структурированную таблицу перед
сохранением под типом одежды. В карточке товара
выгрузки видны только шаблоны поставщика этой партии; шаблон применяется явной
кнопкой и заменяет только
`attributes.measurements`: описание, фотографии, видео и другие атрибуты не
изменяются. Удаление шаблона не удаляет уже назначенные таблицы у товаров.
В основном каталоге выбранный шаблон можно назначить сразу отмеченным товарам
через нижнюю панель массовых действий; существующие атрибуты товаров сохраняются,
а размеры шаблона объединяются с уже указанными размерами.

## Фильтры и характеристики

| URL | Назначение | Источник |
|---|---|---|
| `/admin/filter-characteristics` | Реестр атрибутов каталога и их режимов | Rails CRM: `catalog_attribute_definitions`, `catalog_attribute_values` |
| `/admin/catalog-attributes` | Проверка и подтверждение предложений AI | Rails catalog attribute suggestions |

В реестре можно отдельно включить показ атрибута в карточке, фильтрацию на сайте и использование как варианта товара. Подписи и алиасы применяются API при построении фасетов, поэтому старые варианты объединяются без массовой перезаписи товаров.

## CRM

| URL | Назначение | Rails API |
|---|---|---|
| `/admin/crm` | CRM с четырьмя вкладками | `/api/v1/admin/*` |
| `/admin/crm/orders` | Список оплачиваемых заказов и шесть статусов | `GET /admin/orders` |
| `/admin/crm/orders/[id]` | Карточка заказа | `GET /admin/orders/:id` |
| `/admin/crm/customers` | Клиенты, фильтр по источнику регистрации и адреса | `GET /admin/customers` |
| `/admin/crm/customers/[id]` | Контакты, адреса и история клиента | `GET /admin/customers/:id` |
| `/admin/crm/telegram` | Telegram-сообщения и рассылки | `GET/POST /admin/store_telegram_*` |
| `/admin/crm/settings` | Получатели уведомлений сайта и Mini App, с отдельными тестами ботов | `GET/POST /admin/telegram_notification_recipients` |

Карточка заказа включает:

- переход только между шестью статусами заказа;
- одно фото товара, название и ссылку, количество, размер и сумму;
- платежи, возвраты, данные клиента, адрес доставки и историю статусов.

Неоплаченные заявки из Mini App и кнопки «сообщить цену» не создают заказов.

## SEO и аналитика

| URL | Назначение | Источник |
|---|---|---|
| `/admin/seo-ai` | AI-каталог: очередь, сравнение, массовая обработка и настройки | Rails SEO AI API + worker (BYESU по умолчанию, также OpenRouter/Cockpit) |
| `/admin/ai-rules` | Глобальные настройки batch AI: OpenRouter/Cockpit, модель, temperature, max tokens и системный промпт китайского каталога | `yeezy_scraping.app_settings` + Cockpit heartbeat |
| `/admin/analytics` | Операционные метрики | AdminYeezy analytics |

SEO landings, redirects, audits и AI-каталог относятся к Rails CRM/API. Production создаёт задания и хранит черновики, а локальный worker забирает их через защищённые `/api/v1/admin/seo_ai/worker/*` endpoints. Прямые записи в CRM-БД запрещены.

## Что важно не сломать

- `AdminYeezy` остается отдельным Next.js приложением.
- Rails CRM - source of truth для каталога, заказов, клиентов, платежей и возвратов.
- `yeezy_scraping` остается технической БД для парсинга, supplier/import batches и AI-процессов.
- NocoDB допустим только для контролируемого просмотра/ограниченной операторской работы, не для прямого CRM workflow.
- Storefront `/admin` не развивается как UI.
