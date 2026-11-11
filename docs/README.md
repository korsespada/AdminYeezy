# AdminYeezy documentation

## Current documents

- [Architecture](./architecture.md) — data ownership and service boundaries.
- [Rails integration](./rails-integration.md) — API contract and migration
  boundary.
- [Admin sections](./admin-sections.md) — current UI areas.
- [Chromoff catalog](./chromoff-catalog.md) — catalog ownership, import and operator workflow.
- [David Studio import](./david-studio-import.md) — supplier export, photo cleaning queue and AI draft worker contract.
- [Batch AI workflow](./batch-ai-workflow.md) — AI processing and review flow.
- [AI usage](./ai-usage.md) — учёт токенов и стоимости ИИ, цены моделей, DeepSeek.
- [Export history](./exports.md) — export history, stages and publication.
- [Медиа в S3](./s3-media.md) — схема ключей, Cache-Control и уборка неиспользуемых файлов.
- [Deployment runbook](./deployment-runbook.md) — validation and release order.
- [Coolify deployment](./coolify-deployment.md) — environment and operations.
- [Переменные для YUCONCIERGE](./yuconcierge-env.md) — что внести в Coolify на новом сервере и откуда каждое значение.
- [Codex workflow](./CODEX_WORKFLOW.md) — project-specific agent rules.
- [Project decisions](./PROJECT_DECISIONS.md) — short current decisions.

## Archive policy

Historical plans, dated audits, superseded runbooks, and completed investigations
belong in [`docs/archive/`](./archive/README.md). Archived documents may explain
why a decision was made but must not be treated as active requirements.

When a current document changes, update links from this index and remove stale
instructions instead of leaving two competing workflows.
