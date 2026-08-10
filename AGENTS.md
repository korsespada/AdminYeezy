# AdminYeezy working agreements

## Project scope

AdminYeezy is a separate Next.js operational admin for `admin.yeezyunique.ru`.
It owns the technical `yeezy_scraping` workflow and uses the Rails API for the
published catalog and CRM operations.

## Documentation source of truth

- Before a non-trivial change, read `docs/README.md` and only the relevant
  documents linked from it.
- Read `docs/architecture.md` for data boundaries, `docs/rails-integration.md`
  for API integration, and `docs/deployment-runbook.md` for deployment work.
- Files under `docs/archive/` are historical evidence, not current requirements.
- If docs, code, and tests disagree, report the conflict and prefer working
  behavior and tests over stale planning text.
- Any new section, component, workflow, integration, or material change to an
  existing one must update the relevant current documentation in `docs/` in
  the same change. Add a new document when the existing ones cannot describe
  the operating workflow clearly, and update `docs/README.md` with its link.

## Data boundaries

- `yeezy_scraping` is the direct-write database for scraping, suppliers, AI
  processing, and import batches.
- Published catalog, customers, orders, payments, refunds, wallet, and CRM
  workflow belong to Rails CRM Postgres and are changed only through Rails API
  endpoints/services.
- Never point the AdminYeezy `DATABASE_URL` at Rails CRM Postgres. Use the
  dedicated `SCRAPING_DATABASE_URL` and explicitly named legacy read-only
  connection where required.
- Never commit credentials, JWTs, database URLs with passwords, or Coolify env
  values.

## Execution policy

- Preserve existing uncommitted work; do not rewrite or discard unrelated files.
- Do not create a new branch unless the user explicitly asks for one.
- After a small edit, run the smallest relevant check. Run the full check only
  after a coherent batch or before deployment; do not run full smoke tests after
  every local change.
- Do not spawn subagents by default. Use at most one read-only subagent only
  when independent parallel work materially saves time.
- Use a Goal only for multi-turn work with explicit completion criteria.
- Do not deploy, restart Coolify resources, modify shared databases, or send
  external messages without explicit authorization.
- If Coolify needs to be inspected or used, use the Coolify MCP server.

## Dependency and tool documentation

- Before changing an imported library or its API usage, obtain current
  documentation through Context7 when available (`npx ctx7 setup` first).
- If Context7 is unavailable, use the library's official documentation and
  record that fallback in the review.
- Use only the MCP servers needed for the task: Codebase for navigation,
  Context7 for library docs, and Coolify for deployment operations.
- Use UI component MCPs such as Magic UI only for an explicit UI task.

## Validation

```powershell
npm ci
npm run lint
npm test -- --run
npm run build
```

Use `npm run check` for the complete local validation after a coherent batch.
For deployment, follow `docs/deployment-runbook.md` and verify Rails API before
AdminYeezy, then verify AdminYeezy before storefront.
