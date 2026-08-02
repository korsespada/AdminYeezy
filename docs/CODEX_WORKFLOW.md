# Codex workflow for AdminYeezy

## Before editing

1. Read `AGENTS.md`.
2. Read the relevant document from `docs/`.
3. Inspect current code, tests, and uncommitted changes.
4. For a library/API change, fetch current documentation through Context7 or
   the official library documentation.
5. Define the smallest acceptance check for the change.

## During editing

- Keep changes narrow and preserve unrelated working-tree changes.
- Prefer existing helpers and API clients over a new abstraction.
- Keep scraping writes in `yeezy_scraping` and CRM writes behind Rails API.
- Do not add a new MCP, plugin, or dependency unless the task needs it.
- Do not launch a swarm of agents. A single read-only review is the maximum
  default delegation for this repository.

## Checks

Run targeted tests first. For a coherent batch, run:

```powershell
npm run check
```

Full deployed smoke checks run after deployment, not after every local edit.

## MCP boundaries

- Codebase MCP: repository navigation and focused code context.
- Context7: current package and framework documentation.
- Coolify MCP: resolve `AdminYeezy` by project, environment, name, or
  `admin.yeezyunique.ru` before inspecting or changing a resource.

Do not print secrets or request their values. Use SSH only for host-level work
that Coolify MCP cannot provide.

## Review checklist

- Does the change preserve the database boundary?
- Are auth and admin mutations routed through the Rails API?
- Is the change covered by a focused test or validation command?
- Are docs and README instructions still executable?
- Did the change avoid an unnecessary dependency, MCP, subagent, or full smoke
  run?
