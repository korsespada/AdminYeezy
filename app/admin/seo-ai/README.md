# AI SEO Studio

Раздел: `/admin/seo-ai`.

## Зачем это нужно

AI SEO Studio генерирует SEO-черновики для товаров, брендов, категорий и SEO-лендингов. AI никогда не публикует изменения сразу: сначала создается draft, затем менеджер смотрит результат и вручную применяет нужные поля.

## Где хранится ключ OpenRouter

`OPENROUTER_API_KEY` хранится в server env проекта `AdminYeezy`.

AdminYeezy не отдает ключ в браузер. Server actions добавляют ключ только во внутренний server-to-server запрос к Rails API при запуске генерации, batch или идей лендингов.

Rails API использует этот ключ как runtime override и не сохраняет его в `seo_ai_generations`, `prompt_snapshot`, `model_snapshot` или других draft-полях.

Если ключ не задан в AdminYeezy env, генерация вернет ошибку `OPENROUTER_API_KEY is not configured`.

## Почему Rails все еще участвует

Rails API остается SEO engine и source of truth для:

- настроек AI задач;
- входного snapshot товара/бренда/категории;
- drafts;
- batch-запусков;
- apply/reject/delete;
- обновления товаров, alt-текстов, категорий и SEO-лендингов.

Так менеджер работает в AdminYeezy, а изменения применяются там же, где живут реальные catalog данные.

## Основные вкладки

- `Настройки`: модели, temperature, max tokens, system prompt и user prompt template.
- `Тестовый товар`: поиск товара, запуск text/vision/writer, просмотр draft.
- `Массово`: batch до 100 товаров, по умолчанию без фото.
- `Бренды`: генерация брендовых SEO-страниц.
- `Категории`: SEO для категорий и подкатегорий.
- `Идеи лендингов`: идеи новых SEO collection pages.
- `Черновики`: просмотр output/error, apply, reject и delete.

## Жизненный цикл draft

1. AdminYeezy server action вызывает Rails `/api/v1/admin/seo_ai/...`.
2. Rails собирает context, вызывает OpenRouter с ключом из AdminYeezy request body.
3. Rails сохраняет `SeoAiGeneration` со status `draft` или `failed`.
4. Менеджер в AdminYeezy применяет, отклоняет или удаляет draft.
5. Apply обновляет только выбранные поля. Для brand/category/landing новые страницы получают `needs_review`, а не `indexable`.

## Delete

Кнопка `Удалить` физически удаляет запись `SeoAiGeneration`.

Удаление не откатывает уже примененные изменения. Если draft был `applied`, удаляется только история AI draft.

## Env

AdminYeezy:

```env
OPENROUTER_API_KEY=...
RAILS_API_URL=https://...
RAILS_ADMIN_EMAIL=...
RAILS_ADMIN_PASSWORD=...
```

Rails:

```env
DATABASE_URL=...
```

`OPENROUTER_API_KEY` в Rails больше не обязателен для генерации из AdminYeezy. Его можно оставить как fallback для прямых Rails-only запусков.
