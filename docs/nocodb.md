# NocoDB для AdminYeezy и Rails CRM

## Цель

Сохранить существующий `yeezy_scraping` в NocoDB и добавить безопасный доступ к Rails CRM. Рекомендуемый адрес:

```text
https://nocodb.yeezyunique.ru
```

Не использовать публичный `IP:порт` как постоянный способ доступа.

## Аудит перед изменениями

На сервере выполнить:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
docker inspect NOCODB_CONTAINER
docker volume ls
```

Найти текущий контейнер NocoDB, mounted volumes и metadata storage. Не удалять контейнер до backup.

## Backup

Если metadata хранится в Postgres:

```bash
pg_dump -Fc -h HOST -U USER DB_NAME > nocodb-meta.backup
```

Если используется SQLite внутри Docker volume, остановить контейнер и скопировать volume целиком.

## Источники данных

| Data source | Права | Назначение |
|---|---|---|
| `yeezy_scraping` | Read/write | Сохранить существующие поставщики, задачи и партии |
| `rails_crm_readonly` | `SELECT` | Просмотр CRM и опубликованного каталога |
| `rails_catalog_editor` | Ограниченные views | Будущее контролируемое редактирование каталога |

## Ограничения

Через NocoDB нельзя напрямую менять:

- заказы и позиции заказов;
- платежи и payment events;
- возвраты;
- wallet и заявки на вывод;
- workflow-статусы;
- audit trail.

Эти операции выполняются только через Rails API/services.

## HTTPS

Добавить DNS:

```text
nocodb.yeezyunique.ru  A  SERVER_IP
```

Подключить существующий контейнер к reverse proxy или перенести его в Coolify после backup. Внутренний порт NocoDB и PostgreSQL не открывать наружу.
