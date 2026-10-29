# PathPilot AI

PathPilot turns student goals into adaptive roadmaps, tracks progress, and explains schedule changes when work is missed.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `PORT` — API and frontend process ports; `BASE_PATH` — frontend Vite base path.
- Cookie-authenticated cross-origin requests require `FRONTEND_ORIGINS`, a comma-separated list of the exact browser origins that may call the API (for example, the actual Vite development origin and the deployed frontend origin). Do not guess or use a wildcard in production; production startup fails when this allowlist is absent.
- Optional server-only AI env: `OPENAI_API_KEY` enables AI-assisted task suggestions; `OPENAI_MODEL` selects the model (defaults to `gpt-4o-mini`). Set these only in the API server's secret/environment configuration. Never add credentials to Vite/client variables or source control. If the key is absent or the provider/output is unavailable or invalid, PathPilot uses its built-in task suggestions.
- Progress dates use UTC calendar days. Weekly summaries run Monday through Sunday in UTC; actual study duration is not collected.
- Authentication schema changes are prepared in `lib/db/migrations/0001_add_auth_sessions.sql`. Review and apply that SQL explicitly; do not use `pnpm --filter @workspace/db run push` for this authentication migration or against a production/user database.
- Existing tasks receive the `Uncategorized` topic default; no topic is inferred from task names. Historical plan comparison starts when the first plan snapshot is recorded.
- Existing users without credentials are preserved and require the controlled recovery procedure in `docs/auth-recovery.md`; migration and signup never assign credentials or transfer their goals automatically.
- Task completion/missed transitions and schedule snapshot writes use database transactions. Replanning locks the goal row so concurrent schedule operations serialize version allocation.
- API code validates dependencies and milestone associations within a goal. The current Drizzle schema does not yet enforce cross-goal membership for dependency, milestone-task, or plan-version-task links; durable database enforcement needs a reviewed migration adding/backfilling goal IDs and composite foreign keys. The dependency pair unique index/self-dependency check also needs existing rows checked before schema push.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/pathpilot-ai` — React/Vite web application and the student-facing dashboard.
- `artifacts/api-server` — Express API for goals, roadmaps, task progress, recommendations, and replanning.
- `lib/api-spec/openapi.yaml` — source of truth for the typed API contract.
- `lib/db/src/schema` — Drizzle schema for users, goals, tasks, dependencies, and progress.
- `data/` — synthetic CSV dataset for demo and evaluation scenarios.

## Architecture decisions

- The planning workflow is deliberately transparent and rule-based: priorities, daily capacity, dependencies, and status drive the schedule.
- Completed tasks keep their status and scheduled date during replanning; pending tasks are the only work moved forward.
- The placement-preparation demo is seeded on first goal access so the first preview is immediately demonstrable.
- The workspace's shared Express/PostgreSQL stack is used for persistence and typed API access.

## Product

PathPilot includes a dashboard, goal studio, scheduled roadmap, progress view, recommendation queue, task completion/missed states, and a replan result with human-readable explanation.

## User preferences

The user asked for a polished, warm brown-and-cream student productivity dashboard and a working end-to-end missed-task replanning demonstration.

## Gotchas

- The API contract is generated from `lib/api-spec/openapi.yaml`; rerun codegen after changing it.
- Replanning is exposed as a separate action after marking a task missed so the before/after explanation can be demonstrated clearly.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
