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

Минимальная ручная проверка перед production deploy:

```bash
git grep -nE 'SECRET|TOKEN|PASSWORD|ACCESS_KEY|PRIVATE_KEY'
```

## Проверка

```text
https://admin.yeezyunique.ru/login
https://api.yeezyunique.ru/api/v1/health
```

После подключения Rails API проверить вход, список товаров, scraping-партии, публикацию тестовой партии и отображение товара на storefront.
