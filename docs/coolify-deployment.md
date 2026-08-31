# Деплой AdminYeezy в Coolify

## Сервис

Использовать отдельный Coolify-проект:

```text
Name: AdminYeezy
Domain: https://admin.yeezyunique.ru
Port: 3000
Dockerfile: ./Dockerfile
```

Не встраивать приложение внутрь storefront.

## Env

Взять полный шаблон из [`.env.example`](../.env.example). Для production обязательно задать:

```env
ADMIN_BASE_URL=https://admin.yeezyunique.ru
RAILS_API_URL=https://api.yeezyunique.ru/api/v1
RAILS_ADMIN_EMAIL=admin@yeezyunique.ru
RAILS_ADMIN_PASSWORD=replace_me
SCRAPING_DATABASE_URL=postgresql://.../yeezy_scraping
LEGACY_CATALOG_DATABASE_URL=postgresql://readonly_user:.../shop
```

`DATABASE_URL` не задавать как основной production env для AdminYeezy. Для переходного чтения справочников из legacy-каталога использовать только `LEGACY_CATALOG_DATABASE_URL`, а для технической БД админки - `SCRAPING_DATABASE_URL`.

Публикация партий логинится в Rails через `POST /api/v1/admin/auth/login` и кэширует выданный JWT. `RAILS_ADMIN_TOKEN` можно использовать только как временный override с уже выданным Rails admin JWT.

## Rails CORS

В env Rails API добавить:

```env
CORS_ORIGINS=https://yeezyunique.ru,https://tg.yeezyunique.ru,https://admin.yeezyunique.ru
```

## Redeploy

1. Проверить, что `.env.example` не содержит секретов.
2. Выполнить поиск захардкоженных токенов, паролей и S3-ключей в отслеживаемых Git-файлах.
3. Удалить найденные credentials из кода, перенести их в Coolify env и выполнить ротацию скомпрометированных ключей.
4. Закоммитить изменения.
5. Отправить ветку в удаленный репозиторий.
6. Выполнить redeploy проекта `AdminYeezy` в Coolify.
7. Проверить логи контейнера.

### Runtime-образ и память сборки

Основной `Dockerfile` не устанавливает Python, ffmpeg и Python-зависимости при
каждом деплое. Они находятся в заранее собранном локальном образе
`adminyeezy-runtime:python311-ffmpeg`. Перед первым деплоем или после изменения
`requirements.txt` образ нужно собрать на сервере с ограничением ресурсов:

```bash
./scripts/build-runtime-image.sh
```

Скрипт использует заранее созданный BuildKit-builder `coolify-safe`, ограниченный
одним builder-контейнером до 2 ГБ RAM и 3 ГБ RAM+swap. Обычный деплой после этого
собирает только Node/Next.js-часть.
Если используется другой registry или тег, передайте его первым аргументом и
задайте в Coolify build variable `RUNTIME_IMAGE` с тем же значением.

### Самовосстановление runtime-образа

Базовый образ не используется ни одним контейнером напрямую, поэтому плановая
чистка Docker в Coolify (ежедневная задача, около 00:00 UTC) считает его
«неиспользуемым» и может удалить. Тогда очередной деплой падает с
`pull access denied ... adminyeezy-runtime:python311-ffmpeg`.

Чтобы это не повторялось, на сервере стоит ежедневная проверка: cron
(`30 5 * * *`) запускает `/opt/adminyeezy-runtime/ensure-runtime-image.sh`
(каноничная копия — `scripts/ensure-runtime-image.sh`). Скрипт проверяет наличие
тега `adminyeezy-runtime:python311-ffmpeg`, при отсутствии пересобирает образ
через builder `coolify-safe` и поддерживает минимальный контейнер
`adminyeezy-runtime-keepalive`. Контейнер запускает только `sleep infinity` без
сети, файловой записи и Linux capabilities, но его ссылка не позволяет очистке
Coolify удалить runtime-образ непосредственно перед сборкой. Слои кэшируются,
поэтому восстановление занимает секунды.
Рядом лежат `Dockerfile.runtime` и `requirements.txt`, лог —
`/var/log/adminyeezy-runtime-guard.log`.

При пересоздании сервера с нуля вернуть защиту:

```bash
mkdir -p /opt/adminyeezy-runtime && cd /opt/adminyeezy-runtime
# скопировать scripts/ensure-runtime-image.sh, Dockerfile.runtime, requirements.txt из репозитория
chmod +x ensure-runtime-image.sh && ./ensure-runtime-image.sh
(crontab -l; echo '30 5 * * * /opt/adminyeezy-runtime/ensure-runtime-image.sh >> /var/log/adminyeezy-runtime-guard.log 2>&1') | crontab -
```

Ограничение `limits_memory` в Coolify относится к запущенному контейнеру и не
ограничивает BuildKit. Поэтому для тяжёлого runtime-образа используется именно
отдельный BuildKit-builder с лимитами; Node-сборка дополнительно ограничена через
`NODE_OPTIONS=--max-old-space-size=768` в builder-stage.

Сервер небольшой (4 vCPU / 5.8 ГБ RAM) и во время деплоя остаётся занят
прод-контейнерами (Elasticsearch ~1 ГБ, Postgres, само приложение). Чтобы сборка
Next не вымывала у них память, в `next.config.js` ограничены воркеры
(`experimental.cpus: 2`) и память движка Turbopack
(`experimental.turbopackMemoryLimit`, байты), а на сервере есть запасной swap
`/swapfile2` на 2 ГБ (итого 4 ГБ, записан в `/etc/fstab`) — при пике сборки
сервер замедляется, но остаётся доступным и не требует ребута.

### Сборка через GitHub Actions (основной путь)

`.github/workflows/docker.yml` собирает оба образа на раннерах GitHub и пушит их
в GitHub Container Registry (`ghcr.io`), поэтому прод-сервер вообще не строит
ничего и не испытывает нагрузок деплоя:

- job `runtime` — образ из `Dockerfile.runtime` →
  `ghcr.io/korsespada/adminyeezy-runtime:{latest,<sha>}`; слои кэшируются через
  GHA-cache, поэтому без изменений `requirements.txt` пересборка занимает
  секунды;
- job `app` — основной образ из `Dockerfile` с
  `RUNTIME_IMAGE=ghcr.io/korsespada/adminyeezy-runtime:<sha>` →
  `ghcr.io/korsespada/adminyeezy:{latest,<sha>}`; build-args
  `RAILS_ADMIN_EMAIL` и `RAILS_API_URL` берутся из секретов репозитория.

Нужные secrets в настройках репозитория (Settings → Secrets and variables →
Actions):

| Secret | Назначение |
|---|---|
| `RAILS_ADMIN_EMAIL` | Значение build-переменной Coolify `RAILS_ADMIN_EMAIL` |
| `RAILS_API_URL` | Обычно `https://api.yeezyunique.ru/api/v1` |

Чтобы Coolify перестал собирать сам и начал тянуть готовый образ:

1. Создать PAT на GitHub с правом `read:packages`
   (Settings → Developer settings → Personal access tokens).
2. В Coolify: Sources → добавить Docker Registry `ghcr.io` с логином
   `korsespada` и этим токеном.
3. В приложении AdminYeezy сменить Source с «Git Repository» на «Docker Image»,
   указать `ghcr.io/korsespada/adminyeezy:latest`, привязать registry из шага 2.
4. Удалить ставшие ненужными build-переменные (`RUNTIME_IMAGE`,
   `RAILS_ADMIN_EMAIL`, `RAILS_API_URL`) — они больше не участвуют в сборке.
5. Redeploy. Дальше каждый пуш в main обновляет образ в ghcr.io, а Coolify
   просто подтягивает новую версию.

Пока Coolify не переключён, он продолжает локальную сборку по инструкции выше —
workflow от этого не ломается и просто готовит образы заранее.

Минимальная ручная проверка перед production deploy:

```bash
git grep -nE 'SECRET|TOKEN|PASSWORD|ACCESS_KEY|PRIVATE_KEY'
```

## Проверка

```text
https://admin.yeezyunique.ru/login
https://api.yeezyunique.ru/api/v1/health
```

После подключения Rails API проверить вход, список товаров, scraping-партии, публикацию тестовой партии, CRM-разделы и отображение товара на storefront.

Подробный порядок деплоя Rails API -> AdminYeezy -> storefront описан в [deployment-runbook.md](./deployment-runbook.md).
