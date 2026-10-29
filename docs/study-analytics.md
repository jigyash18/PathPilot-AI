# Study Analytics & activity tracking

## Availability and migration approval

The existing authenticated `/progress` page is now **Analytics**. Selected-goal
task estimates, milestones and plan history remain in the expandable ledger.
Existing authentication, profile, planning and task-completion APIs are reused.

New persistence requires `lib/db/migrations/0002_add_study_sessions.sql`.
**This migration has not been applied to `pathpilot_dev`.** Until approval and
application, authenticated analytics requests return a generic 503 storage-not-ready
message with a retry button. Existing goal history remains available below it.

Exact change: create `public.pathpilot_study_sessions`, its serial primary key,
user and optional goal foreign keys, duration check, four secondary indexes
(including unique user/request ID). No existing table or row is updated, deleted,
transferred or backfilled. Goal deletion clears the optional association while
preserving recorded study time. User deletion is restricted by the foreign key.

The migration uses BEGIN/COMMIT, a 5-second lock timeout and a 60-second statement
timeout. It deliberately fails on existing same-named objects. It must not be
rerun or replaced with a schema push. Obtain explicit approval and a verified
backup of the intended database before applying once with:

```bash
cd /home/kowshik/pathpilot-ai-verification-copy-wsl
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f lib/db/migrations/0002_add_study_sessions.sql
```

## Session model and security

- `POST /api/study-sessions`: `{requestId, goalId, startedAt, endedAt}`.
  Request ID is a UUID v4; `goalId` may be null. Timestamps must be ISO UTC with
  seconds and an optional three-digit millisecond part, ending in `Z`.
- Completed, manually recorded sessions only: 1 minute–12 hours, starting within
  the last 366 days, ending no later than the server clock. Exclude breaks.
- Duration is calculated from timestamps, never accepted from the client.
- The authenticated session determines the owner; unknown payload fields including
  `userId` and `durationMinutes` are rejected. Optional goals must belong to that user.
- A database transaction locks the user row, checks replay/goal ownership/overlap,
  and inserts once. Concurrent submissions across server processes are serialized.
  Identical retries return 200; first saves return 201. Changed payloads using the
  same ID or overlapping sessions return 409. Adjacent intervals are allowed.
- These are self-reported records, not a stopwatch, background monitor or proof
  of attention. No synthetic history, automatic task completion or implicit replanning.
  Records are append-only in this release (no edit/delete endpoint).
- CSRF/CORS middleware and secure session authentication apply. Responses use
  `Cache-Control: no-store`; diagnostics log only a fixed operation name and SQLSTATE,
  never request bodies, ORM query strings, credentials or raw exception messages.

## Analytics contract and definitions

`GET /api/study-analytics?range=week|last-week|30-days|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&offset=0`

All queries are owner-scoped, parameterized and read in one repeatable-read,
read-only transaction. `from`/`to` are used only for custom ranges. Pages contain
50 activity events; offsets must be multiples of 50 up to 10,000. Narrow the range
to inspect more events. Concurrent new records can shift offset pages; Refresh
and returning to the first page shows the latest view.

- **Dates:** UTC throughout; Monday begins a week. This week = Monday through
  today, last week = preceding Monday–Sunday, last 30 days includes today. Custom
  ranges are inclusive and at most 366 days, with no future end date. SQL uses
  half-open timestamp intervals to avoid double counting midnight.
- **Recorded time:** sum of the portions of sessions within the selected period.
  Midnight-crossing sessions are split into the actual UTC days. No task estimates
  or profile targets contribute recorded minutes.
- **Completed sessions:** records with finish timestamps in the period. Average
  session duration uses their full durations. Therefore a clipped boundary session
  can contribute minutes without contributing to this count.
- **Tasks completed:** distinct task IDs with existing completed progress events
  in the period. A repeated completion counts once for the whole range; daily
  counts deduplicate per day. Historical events do not override current task state.
- **Current task progress:** same average completion-percent calculation used by
  existing goal summaries. Current completed/pending/missed counts, active goals
  and deadline indicators are explicitly independent of the date filter.
- **Streak:** consecutive UTC days with any recorded study time, ending today or
  yesterday. Uses all recorded activity, not just the selected range. No old
  records are inferred. Missing logs do not prove inactivity.
- **Configured target:** current profile daily hours, explicitly not hours studied.
  Target insights compare records with the current preference, not a reconstructed
  historical setting.
- **Activity:** sessions overlapping the period plus task completed/missed/recovered
  events. Most recent first with stable tie ordering; task events have dates only,
  not fabricated clock times. Sessions show full duration in history, even if
  their chart contribution is clipped to the range.
- **Insights:** deterministic explanations for recorded activity, current target
  comparisons, deadlines due within 7 days/overdue, and recent versus preceding
  seven-day totals when there is sufficient data. They never change data.

Charts use the existing Recharts dependency and brown/cream theme tokens.
The analytics route is lazy-loaded. Text summaries and a daily data table provide
accessible equivalents. Daily chart units are minutes; task chart units are tasks.
Trend charts require a range of at least 7 days and 4 recorded activity days.

## Verification and repeatable tests

From the project root:

```bash
pnpm run typecheck
node node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs --test artifacts/api-server/src/lib/study-analytics.test.ts artifacts/api-server/src/lib/study-session-service.test.ts artifacts/pathpilot-ai/src/lib/study-client.test.ts
node node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs artifacts/api-server/src/lib/study-integration.ts
node artifacts/api-server/build.mjs
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/pathpilot-ai run build
```

The integration runner requires `/usr/lib/postgresql/18/bin`. It creates a private,
temporary Unix-socket cluster **inside this project**, overrides any inherited
DATABASE_URL, applies migrations only there, and uses synthetic accounts/records.
It stops and removes that cluster in `finally`. It never uses the live database.
Coverage includes real signup/signin/session/signout, migration failure before
application and fail-closed rerun, constraints/indexes, ownership, CSRF, concurrent
idempotency/overlap, UTC clipping/midnight, event semantics, paging, persistence,
and preserving session records when an associated goal is deleted.

Browser rendering, keyboard/mobile interaction and live persistence still require
manual verification after migration approval. No browser automation dependency
or browser runner is installed in the WSL project.

## Manual acceptance steps (after approved migration)

1. Open `http://localhost:5173`, sign in, select **Analytics** (`/progress`).
2. Confirm empty records show zero minutes and no invented trend or history.
3. Enter UTC start/end times for a genuine completed study session, optionally
   select one of your goals, and save. Do not enter passwords or notes here.
4. Select a range containing that session. Confirm minutes/chart/history agree.
   Refresh, sign out and sign back in; confirm persistence.
5. Retry the same submission: no duplicate. Try an overlapping interval: helpful
   error. Use a midnight-crossing interval to check daily allocation.
6. Switch this week / last week / 30 days / custom dates. Check the applied dates,
   charts and paged history together. Current-state cards remain explicitly labeled.
7. Complete a real task using the existing roadmap workflow. Refresh Analytics;
   completion events and status update, but recorded minutes do not change.
8. Check another account has its own records. Open Analytics signed out and confirm
   the sign-in gate. Inspect Profile and existing goal history/navigation.
9. At mobile widths, check stacked cards/forms, charts, data-table scrolling and
   the bottom navigation. Use keyboard-only navigation and retry error states.

## Implementation verification record

- Workspace TypeScript checks: passed.
- All repository `*.test.ts` files under artifacts: 29 runner entries passed
  (some existing entries contain several internal assertions/cases).
- Isolated PostgreSQL integration runner: passed, including actual migration
  execution there, failure before migration, fail-closed rerun, real signup,
  signin, signout and session middleware, owner isolation, transactional
  duplicate/overlap protection, UTC aggregation, paging and persistence.
- API and frontend production builds: passed. The frontend retains the existing
  non-blocking tooltip sourcemap warning. Charts are in a lazy-loaded bundle.
- Feature-file whitespace review: passed. Repository-wide `git diff --check`
  reports pre-existing CRLF/trailing whitespace in generated API files and
  `pnpm-workspace.yaml`; those files were not reformatted for this feature.
- Restarted the development API preserving its process environment, with the
  explicit localhost/127.0.0.1 frontend origins. Health returns 200. GET analytics
  and POST study-session endpoints return 401 without authentication through Vite.
  `/progress` serves its frontend document with HTTP 200 (not a browser rendering test).
- No live database migration or fixture writes. No live authenticated study
  persistence or desktop/mobile browser interaction test was performed.
- Prepared migration SHA-256:
  `5a060949677833192e3b0aa489f2aafdc933b4ccfbec6d0e32a9c3cc9ff708cb`.
  This identifies the prepared file for review, not an approval to execute it.

## Feature file map

| File | Purpose |
| --- | --- |
| `lib/db/src/schema/study-sessions.ts` | Persistent study records, FK/check/index definitions |
| `lib/db/src/schema/index.ts` | Schema export |
| `lib/db/migrations/0002_add_study_sessions.sql` | Reviewed, unapplied live migration |
| `artifacts/api-server/src/lib/study-analytics.ts` | Validation, UTC ranges, daily series, streak and insights |
| `artifacts/api-server/src/lib/study-session-service.ts` | Transactional ownership, overlap and idempotency rules |
| `artifacts/api-server/src/lib/study-repository.ts` | Parameterized persistence and owner-scoped analytics queries |
| `artifacts/api-server/src/routes/study-analytics.ts` | Protected endpoints, safe errors and diagnostics |
| `artifacts/api-server/src/routes/index.ts` | Router wiring |
| `artifacts/api-server/src/lib/pathpilot/progress-analytics.ts` | Shared existing task-progress calculation |
| `artifacts/api-server/src/lib/pathpilot/planner.ts` | Reuse shared task-progress calculation in goal summaries |
| `lib/api-client-react/src/study-analytics.ts` | Typed API contracts and client calls |
| `lib/api-client-react/src/index.ts` | Client exports |
| `artifacts/pathpilot-ai/src/pages/study-analytics.tsx` | Filters, charts, records, goal progress, logging and insights |
| `artifacts/pathpilot-ai/src/App.tsx` | Navigation, lazy loading, cache refresh and honest task-ledger labels |
| `artifacts/api-server/src/lib/study-analytics.test.ts` | UTC, validation, streak and insight tests |
| `artifacts/api-server/src/lib/study-session-service.test.ts` | Ownership/replay/overlap and safe-diagnostics tests |
| `artifacts/api-server/src/lib/study-integration.ts` | Disposable PostgreSQL and real API integration runner |
| `artifacts/pathpilot-ai/src/lib/study-client.test.ts` | Filter/paging/cancellation and cookie-auth request tests |
| `docs/study-analytics.md` | Definitions, migration review, verification and manual test steps |
