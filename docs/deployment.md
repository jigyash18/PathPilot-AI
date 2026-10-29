# PathPilot AI deployment

## Render Blueprint

The root `render.yaml` defines a Render static site and a Node API web service.
The static site publishes `artifacts/pathpilot-ai/dist/public`, rewrites `/api`
and `/api/*` to the API service, and sends other paths to `index.html` for the
React router. This keeps browser API calls and cookie authentication on the
frontend's origin. The API's CORS and CSRF checks still require the exact
frontend origin in `FRONTEND_ORIGINS`.

The Blueprint does not define a database, run migrations, or run a schema
push. Supply `DATABASE_URL` for the already provisioned production database
through Render's secret/environment settings. Set `FRONTEND_ORIGINS` to the
deployed static site's exact origin (for the configured service name, normally
`https://pathpilot-ai-ndl.onrender.com`). If Render assigns a different service
URL or a custom domain is used, update both the API's `FRONTEND_ORIGINS` value
and the API destinations in `render.yaml` before deploying. The API service
uses Render's `PORT`, and its health check is `/api/healthz`.

Both services have automatic deploys disabled in the Blueprint, so later Git
pushes will not trigger builds automatically. Creating or syncing the
Blueprint can provision and deploy services; do that only when explicitly
ready. Render's static-site rewrite destinations must use the public API
service URL. Render documents this same static-site-to-API rewrite pattern for
full-stack applications.

For the manually managed Nginx arrangement, `deploy/nginx.conf` remains an
alternative. It is not used by the Render Blueprint.

This repository builds the PathPilot frontend and Express API as separate
artifacts. Use a Linux x64 glibc build/runtime (for example, a Debian-based
Node image); the workspace intentionally excludes native packages for other
platforms. Keep the frontend and API behind one public HTTPS origin so the
existing cookie authentication and relative `/api` requests continue to work.

## Toolchain and build

The repository pins Node.js in `.node-version` and pnpm through the root
`packageManager` field. Install with Corepack and the committed lockfile:

```sh
corepack pnpm install --frozen-lockfile
PORT=5173 BASE_PATH=/ corepack pnpm run build:production
```

The Render services run equivalent package-specific builds after installing
from the repository root. Render uses the pinned Node version from
`.node-version` (also set as `NODE_VERSION` on the API service) and Corepack
uses the root `packageManager` pin for pnpm.

`build:production` type-checks the workspace and builds only the production
frontend and API packages. The frontend static output is
`artifacts/pathpilot-ai/dist/public`; the API entry point is
`artifacts/api-server/dist/index.mjs`. `PORT` and `BASE_PATH` are read while
Vite loads its config, including during builds. Set `BASE_PATH` to the public
mount path (normally `/`). The frontend/API routing below assumes `/`.

Run the API with the package start script:

```sh
corepack pnpm --filter @workspace/api-server start
```

The cloud runtime must provide `PORT`; the API listens on that port. Do not
use Vite preview as the production web server.

## Same-origin routing

`deploy/nginx.conf` serves the frontend files, forwards `/api` and `/api/*` to
the internal API service `api:3000`, and falls back to `index.html` for
frontend routes. Configure the web service to use
`artifacts/pathpilot-ai/dist/public` as `/usr/share/nginx/html`, and make the
API service reachable by the internal name `api` on port 3000. If the hosting
platform assigns a different service name or port, update the Nginx upstream.
Terminate public TLS at Nginx or a trusted platform ingress. The public
frontend and API must share the same origin; do not expose the API directly to
browser traffic on a separate site without separately reviewing cookie and
client configuration.

## Runtime environment

Set these in the cloud platform's secret/environment configuration, never in
source control:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string for the deployed database. |
| `PORT` | Yes | API listen port supplied by the runtime. |
| `NODE_ENV` | Yes | Set to `production`; enables secure session cookies and production origin checks. |
| `FRONTEND_ORIGINS` | Yes | Comma-separated exact public frontend origin allowlist, with scheme and host and no path. |
| `BASE_PATH` | Build | Vite asset base path; use `/` for the routing config in this document. |
| `OPENAI_API_KEY` | Optional | Enables OpenAI task suggestions; built-in suggestions remain available without it. |
| `OPENAI_MODEL` | Optional | OpenAI model override; code default is `gpt-4o-mini`. |
| `LOG_LEVEL` | Optional | Backend logging level. |

Do not commit `.env` files, database dumps, local database files, or the
project's `data/` records. The existing `.gitignore` excludes these. Production
user data belongs in the provisioned PostgreSQL database, not GitHub.

## Database changes

The SQL files in `lib/db/migrations/` are reviewed migration scripts, but the
repository has no Drizzle migration journal or automatic migration runner.
The `@workspace/db` `push` command performs schema push; `push-force` is
especially unsuitable for unattended production deployment. Neither is run
by `build:production` or the API start command.

These two SQL files cover authentication/session additions and study-session
storage; they assume the core `pathpilot_users`, `pathpilot_goals`, and other
application tables already exist. They are not a baseline initializer for a
new empty database. Before provisioning a fresh production database, prepare
and review a baseline migration from the checked-in Drizzle schema; do not
substitute an unattended `push` for that review.

Before changing a production schema, provision the intended production
database, verify a restorable backup, inspect its current schema read-only,
and determine which migration files are not already applied. After explicit
operator approval, apply only the pending files, in order, from the repository
root using a `psql` client and a `DATABASE_URL` supplied by the secret store:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/0001_add_auth_sessions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/0002_add_study_sessions.sql
```

Each file manages its own transaction. The second migration intentionally
fails if its table already exists, so do not blindly rerun it. These scripts
do not record themselves in a migration journal; record applied versions in
the deployment process and verify the resulting table definitions and
constraints. Do not use `push-force` as a migration or rollback mechanism.
Dropping the study-session table would permanently discard recorded study
sessions; rollback requires a separately reviewed recovery plan and backup.

## Post-merge behavior

The Replit post-merge hook installs locked dependencies but never changes the
database schema. Production migrations must use the separately reviewed
procedure above.
