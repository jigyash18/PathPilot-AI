/** Explicit integration runner: owns an isolated Unix-socket PostgreSQL cluster.
 * Never connects to DATABASE_URL supplied by the caller. No live fixtures.
 * Run from project root with tsx artifacts/api-server/src/lib/study-integration.ts.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { loadStudyAnalytics } from "./study-repository";
import type { publicStudySession } from "./study-session-service";

type AnalyticsResult = Awaited<ReturnType<typeof loadStudyAnalytics>>;
const analyticsBody = async (response: Response) => await response.json() as AnalyticsResult;

const project = process.cwd();
assert.ok(readFileSync(resolve(project, "package.json"), "utf8").includes('"workspace"'), "Run from the project root");
const scratch = mkdtempSync(resolve(project, ".study-test-"));
chmodSync(scratch, 0o700);
const bin = "/usr/lib/postgresql/18/bin";
const data = resolve(scratch, "pgdata");
let started = false;
let server: Server | undefined;
let pool: { end(): Promise<void> } | undefined;
let step = "cluster startup";
const origin = "http://localhost:5173";
try {
  execFileSync(`${bin}/initdb`, ["-D", data, "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
  execFileSync(`${bin}/pg_ctl`, ["-D", data, "-l", resolve(scratch, "postgres.log"), "-o", `-k ${scratch} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
  started = true;
  process.env.DATABASE_URL = `postgresql://postgres@localhost/postgres?host=${encodeURIComponent(scratch)}`;
  process.env.FRONTEND_ORIGINS = origin;
  process.env.NODE_ENV = "production";
  process.env.LOG_LEVEL = "silent";
  const database = await import("@workspace/db");
  pool = database.pool;
  const query = database.pool.query.bind(database.pool);
  step = "isolated baseline migration and safe rerun";
  const baseline = readFileSync(resolve(project, "lib/db/migrations/0000_baseline_core.sql"), "utf8");
  await query(baseline);
  await query("INSERT INTO pathpilot_users(name) VALUES ('baseline-preserved')");
  await query(baseline);
  assert.equal((await query("SELECT count(*)::int AS count FROM pathpilot_users WHERE name='baseline-preserved'")).rows[0].count, 1,
    "reapplying the baseline preserves existing rows");
  await query(readFileSync(resolve(project, "lib/db/migrations/0001_add_auth_sessions.sql"), "utf8"));
  const app = (await import("../app")).default;
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server!.once("listening", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const request = (path: string, cookie = "", method = "GET", body?: unknown, requestOrigin = origin) => fetch(`${base}${path}`, {
    method, headers: { origin: requestOrigin, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const signup = async (name: string) => {
    const response = await request("/auth/signup", "", "POST", { name, email: `${name}@example.invalid`, password: "isolated-integration-password" });
    assert.equal(response.status, 201);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    return { cookie, user: (await response.json() as { user: { id: number } }).user };
  };
  const a = await signup("study-a"); const b = await signup("study-b");
  assert.equal((await request("/study-analytics")).status, 401);
  assert.equal((await request("/study-analytics", a.cookie)).status, 503, "unapplied storage has a safe error");
  await query(readFileSync(resolve(project, "lib/db/migrations/0002_add_study_sessions.sql"), "utf8"));
  // Fail-closed reapplication must roll back, not reuse potentially incompatible objects.
  const connection = await database.pool.connect();
  try {
    await assert.rejects(connection.query(readFileSync(resolve(project, "lib/db/migrations/0002_add_study_sessions.sql"), "utf8")));
    await connection.query("ROLLBACK");
  } finally { connection.release(); }
  assert.equal((await query("SELECT count(*)::int AS count FROM pathpilot_users")).rows[0].count, 3);
  const goal = (await query("INSERT INTO pathpilot_goals(user_id,goal_name,goal_type,deadline,daily_hours,priority) VALUES($1,'Test goal','Study',current_date + 5,4,'high') RETURNING id", [a.user.id])).rows[0].id as number;
  const day = new Date(); day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() - 2);
  const from = day.toISOString().slice(0, 10);
  const following = new Date(day.getTime() + 86_400_000).toISOString().slice(0, 10);
  const range = `range=custom&from=${from}&to=${following}`;
  const session = { requestId: randomUUID(), goalId: goal, startedAt: `${from}T23:30:00.000Z`, endedAt: `${following}T00:30:00.000Z` };
  step = "ownership, validation and CSRF";
  assert.equal((await request("/study-sessions", b.cookie, "POST", session)).status, 404);
  assert.equal((await request("/study-sessions", a.cookie, "POST", { ...session, userId: b.user.id })).status, 400);
  assert.equal((await request("/study-sessions", a.cookie, "POST", session, "https://untrusted.invalid")).status, 403);
  assert.equal((await request("/study-sessions", a.cookie, "POST", { ...session, endedAt: session.startedAt })).status, 400);
  step = "concurrent persistence and idempotency";
  const responses = await Promise.all([request("/study-sessions", a.cookie, "POST", session), request("/study-sessions", a.cookie, "POST", session)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  const publicRow = await responses[0]!.json() as ReturnType<typeof publicStudySession>;
  assert.equal(publicRow.minutes, 60); assert.equal('userId' in publicRow, false); assert.equal('requestId' in publicRow, false);
  assert.equal((await request("/study-sessions", a.cookie, "POST", { ...session, requestId: randomUUID() })).status, 409);
  assert.equal((await request("/study-sessions", a.cookie, "POST", { ...session, goalId: null })).status, 409);
  const adjacent = { requestId: randomUUID(), goalId: goal, startedAt: `${following}T00:30:00.000Z`, endedAt: `${following}T01:00:00.000Z` };
  assert.equal((await request("/study-sessions", a.cookie, "POST", adjacent)).status, 201);
  const concurrent = await Promise.all([1, 2].map(() => request("/study-sessions", a.cookie, "POST", { ...adjacent, requestId: randomUUID(), startedAt: `${following}T10:00:00.000Z`, endedAt: `${following}T11:00:00.000Z` })));
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
  step = "UTC aggregation, event semantics and isolation";
  const task = (await query("INSERT INTO pathpilot_tasks(goal_id,task_name,duration_hours,priority,difficulty,status,completion_percent) VALUES($1,'Practice',99,'high','easy','completed',100) RETURNING id", [goal])).rows[0].id;
  await query("INSERT INTO pathpilot_progress(user_id,task_id,date,status,completion_percent) VALUES($1,$2,$3,'completed',100),($1,$2,$4,'completed',100)", [a.user.id, task, from, following]);
  const analytics = await request(`/study-analytics?${range}`, a.cookie);
  assert.equal(analytics.status, 200);
  assert.equal(analytics.headers.get("cache-control"), "no-store");
  const result = await analyticsBody(analytics);
  assert.equal(result.summary.recordedMinutes, 150, "99 estimated hours never count as study time");
  assert.equal(result.days[0].minutes, 30); assert.equal(result.days[1].minutes, 120);
  assert.equal(result.summary.completedSessions, 3); assert.equal(result.summary.averageSessionMinutes, 50);
  assert.equal(result.summary.completedTasksInRange, 1, "unique tasks across the whole period");
  assert.equal(result.summary.currentCompletionPercent, 100);
  assert.equal(result.summary.currentStreak, 2);
  assert.equal(result.activity.length, 5);
  assert.ok(result.activity.filter((item: { kind: string }) => item.kind !== "session").every((item: { dateOnly: boolean }) => item.dateOnly));
  const other = await analyticsBody(await request(`/study-analytics?${range}&userId=${a.user.id}`, b.cookie));
  assert.equal(other.summary.recordedMinutes, 0); assert.equal(other.goals.length, 0); assert.equal(other.activity.length, 0);
  const clipped = await analyticsBody(await request(`/study-analytics?range=custom&from=${from}&to=${from}`, a.cookie));
  assert.equal(clipped.summary.recordedMinutes, 30); assert.equal(clipped.summary.completedSessions, 0);
  step = "persistence across authentication and goal deletion";
  assert.equal((await request("/auth/signout", a.cookie, "POST")).status, 204);
  assert.equal((await request("/study-analytics", a.cookie)).status, 401);
  const signin = await request("/auth/signin", "", "POST", { email: "study-a@example.invalid", password: "isolated-integration-password" });
  assert.equal(signin.status, 200);
  const cookie = signin.headers.get("set-cookie")!.split(";", 1)[0]!;
  assert.equal((await analyticsBody(await request(`/study-analytics?${range}`, cookie))).summary.recordedMinutes, 150);
  assert.equal((await request("/auth/session", cookie)).status, 200);
  const emptyGoal = (await query("INSERT INTO pathpilot_goals(user_id,goal_name,goal_type,deadline,daily_hours,priority) VALUES($1,'Removable','Study',current_date + 5,4,'high') RETURNING id", [a.user.id])).rows[0].id;
  assert.equal((await request("/study-sessions", cookie, "POST", { ...adjacent, requestId: randomUUID(), goalId: emptyGoal, startedAt: `${following}T12:00:00.000Z`, endedAt: `${following}T12:30:00.000Z` })).status, 201);
  await query("DELETE FROM pathpilot_goals WHERE id=$1", [emptyGoal]);
  assert.equal((await query("SELECT count(*)::int AS count FROM pathpilot_study_sessions WHERE goal_id IS NULL")).rows[0].count, 1);
  const constraints = await query("SELECT count(*)::int AS count FROM pg_indexes WHERE tablename='pathpilot_study_sessions'");
  assert.equal(constraints.rows[0].count, 5);
  await assert.rejects(query("INSERT INTO pathpilot_study_sessions(user_id,request_id,started_at,ended_at) VALUES($1,$2,now(),now())", [a.user.id, randomUUID()]));
  step = "pagination and exact midnight boundaries";
  const midnight = { requestId: randomUUID(), goalId: null, startedAt: `${from}T23:00:00.000Z`, endedAt: `${following}T00:00:00.000Z` };
  assert.equal((await request("/study-sessions", b.cookie, "POST", midnight)).status, 201);
  const midnightResult = await analyticsBody(await request(`/study-analytics?${range}`, b.cookie));
  assert.deepEqual(midnightResult.days.map((item) => item.minutes), [60, 0]);
  for (let i = 0; i < 51; i++) {
    const start = new Date(`${following}T14:00:00.000Z`).getTime() + i * 120_000;
    await query("INSERT INTO pathpilot_study_sessions(user_id,request_id,started_at,ended_at) VALUES($1,$2,$3,$4)", [a.user.id, randomUUID(), new Date(start), new Date(start + 60_000)]);
  }
  const page1 = await analyticsBody(await request(`/study-analytics?${range}`, cookie));
  const page2 = await analyticsBody(await request(`/study-analytics?${range}&offset=50`, cookie));
  assert.equal(page1.activity.length, 50); assert.equal(page1.activityHasMore, true);
  assert.equal(page2.activity.length, 7); assert.equal(page2.activityHasMore, false);
  assert.ok(page2.activity.every((item) => !page1.activity.some((first) => first.key === item.key)));
  assert.equal(page1.summary.recordedMinutes, page2.summary.recordedMinutes);
  assert.equal((await request('/study-analytics?range=custom&from=not-a-date&to=2026-10-27', cookie)).status, 400);
  console.log("PASS: isolated PostgreSQL migration, fail-closed rerun, constraints/indexes, real auth, CSRF, ownership, concurrent overlap/idempotency, UTC splitting/clipping, task-event semantics, persistence, goal-deletion preservation.");
} catch (error) {
  console.error(`Study integration failed at: ${step}`);
  // Assertion values are counts/statuses only. Never dump database errors/parameters.
  if (error instanceof assert.AssertionError) console.error(error.message);
  else console.error("Check the isolated test setup; no live database was used.");
  process.exitCode = 1;
} finally {
  if (server) await new Promise<void>((done) => { server!.close(() => done()); server!.closeAllConnections(); });
  if (pool) await pool.end();
  if (started) execFileSync(`${bin}/pg_ctl`, ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  rmSync(scratch, { recursive: true, force: true });
}
