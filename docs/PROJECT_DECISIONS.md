# Current project decisions

| Area | Decision |
| --- | --- |
| Application | AdminYeezy remains a separate Next.js operational admin. |
| Technical database | Scraping, suppliers, AI results, and import batches use `yeezy_scraping`. |
| CRM database | Rails CRM Postgres is the source of truth for published catalog, customers, orders, payments, refunds, and wallet. |
| Integration | Published catalog and CRM mutations go through Rails admin API/services. |
| Legacy catalog | `shop` is read-only and used only for bootstrap or migration work. |
| Deployment | Coolify resource `AdminYeezy` serves `https://admin.yeezyunique.ru`. |
| Release order | Rails API, then AdminYeezy, then storefront. |
| Validation | Targeted checks after small edits; full lint, tests, and build after a coherent batch. |
| Agent policy | Minimal MCP set, no default swarm, no full smoke after every edit. |

If a new proposal conflicts with this table, update this document and the
architecture/runbook together before implementing the behavior.
