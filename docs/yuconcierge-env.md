# Переменные окружения AdminYeezy для YUCONCIERGE

Справочник для приложения `admin` в Coolify (`admin.yuconcierge.com`). Составлен 07.11.2026 при восстановлении после потери Beget: какие переменные нужны и откуда берётся каждое значение. Значения секретов здесь не хранятся.

Порядок запуска на пустом сервере: создать приложение из образа `ghcr.io/korsespada/adminyeezy:production`, внести переменные, выполнить `npm run db:migrate:scraping` и `node scripts/setup-analytics-db.js` против `yu_scraping`, затем задеплоить.

## Генерируются случайно (`openssl rand -hex 32`)

| Переменная | Назначение |
| --- | --- |
| `AI_PROVIDER_ENCRYPTION_KEY` | Шифрует ключи AI-провайдеров в `yu_scraping`. Потеря ключа делает сохранённые ключи нечитаемыми |
| `ADMIN_API_KEY` | Доступ скриптов и агентов к API админки |
| `ANALYTICS_API_KEY` | Ключ для приёма событий аналитики |
| `BATCH_AI_WORKER_TOKEN` | Токен воркеров batch-AI и очистки фото (`PHOTO_CLEAN_WORKER_TOKEN` берёт его по умолчанию) |
| `SCRAPER_WORKER_SECRET` | Токен воркера парсеров |

## Совпадают со значениями backend

| Переменная | Где взять |
| --- | --- |
| `FRONTEND_API_KEY` | `FRONTEND_API_KEY` приложения `backend` в Coolify. Нужен для чтения `/catalog/*` (заголовок `X-Frontend-Key`) |
| `AI_CATALOG_WORKER_TOKEN` | `AI_CATALOG_WORKER_TOKEN` приложения `backend` |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Те же ключи S3 Reg.ru, что `S3_ACCESS_KEY_ID` и `S3_SECRET_ACCESS_KEY` у backend |

## Внутренние адреса сервера

| Переменная | Значение |
| --- | --- |
| `SCRAPING_DATABASE_URL` | `postgres://yu_scraping:<пароль>@<UUID Postgres>:5432/yu_scraping`. Пароль лежит на сервере в `/root/yu-secrets/yu_scraping.env` |
| `ANALYTICS_DATABASE_URL` | Тот же адрес `yu_scraping`: таблица `analytics_events` живёт там |
| `DATABASE_URL` | Не задавать: это совместимость со старыми скриптами, указывать на базу Rails нельзя |
| `LEGACY_CATALOG_DATABASE_URL` | Не задавать: база `shop` не восстанавливается |
| `ES_HOST` | Не задавать, пока админке не нужен свой поиск; ES backend доступен как `http://elasticsearch-<UUID>:9200` |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Не задавать: Redis не развёрнут |

## Обычные значения

| Переменная | Значение |
| --- | --- |
| `ADMIN_BASE_URL`, `ADMIN_URL`, `VITE_API_URL` | `https://admin.yuconcierge.com` |
| `RAILS_API_URL`, `RAILS_LOOKUPS_URL` | `https://api.yuconcierge.com/api/v1` |
| `NEXT_PUBLIC_FRONTEND_URL` | `https://yuconcierge.com` (ссылка «открыть на сайте» в карточке товара) |
| `S3_ENDPOINT` | `https://s3.regru.cloud` |
| `S3_REGION` | `ru-1` |
| `S3_BUCKET` | `static-yu` |
| `S3_PUBLIC_DOMAIN` | `https://static.yuconcierge.com` |
| `AI_CATALOG_MEDIA_HOSTS` | `static.yuconcierge.com,xcimg.szwego.com` |
| `RAILS_IMPORT_ASYNC`, `RAILS_IMPORT_POLL_MS`, `MEDIA_UPLOAD_CONCURRENCY` и прочие тайм-ауты | Как в `.env.example` |

## Вносит владелец

| Переменная | Откуда |
| --- | --- |
| `RAILS_ADMIN_EMAIL`, `RAILS_ADMIN_PASSWORD` | Служебный пользователь админки в Rails (не владелец). Создаётся в CRM после первого входа |
| `BOT_TOKEN`, `MANAGER_CHAT_ID` | Бот уведомлений админки и чат менеджера |
| `BOT_PROXY` | Прокси для Telegram (`http://`, `socks5://`), если сервер не достаёт `api.telegram.org` |
| `OPENROUTER_API_KEY`, `BYESU_API_KEY`, `BYESU_API_GROUP` | Ключи AI-провайдеров |
| `YANDEX_METRIKA_TOKEN` / `YM_API_TOKEN`, `YM_COUNTER_ID`, `GA_MEASUREMENT_ID` | Метрика и GA для дашборда аналитики (новый счётчик под `yuconcierge.com`) |
| `DEFAULT_SZWEGO_COOKIE` | Cookie szwego для парсера, если используется |
| `CHROMOFF_SUPABASE_URL`, `CHROMOFF_SUPABASE_SERVICE_ROLE_KEY` | Только если восстанавливаем Chromoff |

## CI

Workflow `.github/workflows/docker.yml` берёт адрес панели и приложение из repository variables `COOLIFY_URL` и `COOLIFY_APP_UUID`. Пока `COOLIFY_APP_UUID` не задан, CI только собирает образ. Деплой переводит тег `:production` на собранный коммит и вызывает `POST /api/v1/deploy`; токен Coolify с правом `deploy` хранится в secret `COOLIFY_DEPLOY_TOKEN`.
