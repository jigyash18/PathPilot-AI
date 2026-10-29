import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, goalsTable, studySessionsTable, tasksTable, usersTable } from "@workspace/db";
import { goalSummary } from "./pathpilot/planner";
import { taskCompletionProgress } from "./pathpilot/progress-analytics";
import { currentStudyStreak, fillStudyDays, studyInsights, type StudyRange } from "./study-analytics";
import type { StudySessionDatabase } from "./study-session-service";

export const studySessionDatabase: StudySessionDatabase = {
  transaction: (work) => db.transaction((tx) => work({
    lockUser: async (id) => (await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id)).for("update")).length === 1,
    findRequest: async (userId, requestId) => (await tx.select().from(studySessionsTable).where(and(eq(studySessionsTable.userId, userId), eq(studySessionsTable.requestId, requestId))).limit(1))[0],
    ownsGoal: async (userId, id) => (await tx.select({ id: goalsTable.id }).from(goalsTable).where(and(eq(goalsTable.id, id), eq(goalsTable.userId, userId))).for("key share")).length === 1,
    overlaps: async (userId, start, end) => (await tx.select({ id: studySessionsTable.id }).from(studySessionsTable).where(and(eq(studySessionsTable.userId, userId), lt(studySessionsTable.startedAt, end), gt(studySessionsTable.endedAt, start))).limit(1)).length > 0,
    insert: async (userId, input) => (await tx.insert(studySessionsTable).values({ ...input, userId }).returning())[0]!,
  })),
};

export async function loadStudyAnalytics(userId: number, range: StudyRange, offset: number, now = new Date()) {
  return db.transaction(async (tx) => {
    // UTC clipping splits sessions that cross midnight; [start, end) avoids double counts.
    const daily = await tx.execute<{ date: string; minutes: number }>(sql`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
        sum(extract(epoch FROM (
          least(s.ended_at, (d.day + interval '1 day') AT TIME ZONE 'UTC') -
          greatest(s.started_at, d.day AT TIME ZONE 'UTC')
        )) / 60)::double precision AS minutes
      FROM public.pathpilot_study_sessions s
      CROSS JOIN LATERAL generate_series(
        date_trunc('day', greatest(s.started_at, ${range.start}) AT TIME ZONE 'UTC'),
        date_trunc('day', (least(s.ended_at, ${range.end}) - interval '1 microsecond') AT TIME ZONE 'UTC'),
        interval '1 day'
      ) AS d(day)
      WHERE s.user_id = ${userId} AND s.started_at < ${range.end} AND s.ended_at > ${range.start}
      GROUP BY d.day ORDER BY d.day`);
    const sessionStats = await tx.execute<{ count: number; average: number | null }>(sql`
      SELECT count(*)::int AS count, avg(extract(epoch FROM (ended_at - started_at)) / 60)::double precision AS average
      FROM public.pathpilot_study_sessions
      WHERE user_id = ${userId} AND ended_at >= ${range.start} AND ended_at < ${range.end}`);
    const completionDays = await tx.execute<{ date: string; completedTasks: number }>(sql`
      SELECT p.date::text AS date, count(DISTINCT p.task_id)::int AS "completedTasks"
      FROM public.pathpilot_progress p
      JOIN public.pathpilot_tasks t ON t.id = p.task_id
      JOIN public.pathpilot_goals g ON g.id = t.goal_id
      WHERE p.user_id = ${userId} AND g.user_id = ${userId} AND p.status = 'completed'
        AND p.date >= ${range.from}::date AND p.date <= ${range.to}::date
      GROUP BY p.date`);
    const completed = await tx.execute<{ count: number }>(sql`
      SELECT count(DISTINCT p.task_id)::int AS count FROM public.pathpilot_progress p
      JOIN public.pathpilot_tasks t ON t.id = p.task_id JOIN public.pathpilot_goals g ON g.id = t.goal_id
      WHERE p.user_id = ${userId} AND g.user_id = ${userId} AND p.status = 'completed'
        AND p.date >= ${range.from}::date AND p.date <= ${range.to}::date`);
    const streakDays = await tx.execute<{ date: string }>(sql`
      SELECT DISTINCT to_char(d.day, 'YYYY-MM-DD') AS date FROM public.pathpilot_study_sessions s
      CROSS JOIN LATERAL generate_series(
        date_trunc('day', s.started_at AT TIME ZONE 'UTC'),
        date_trunc('day', (s.ended_at - interval '1 microsecond') AT TIME ZONE 'UTC'), interval '1 day'
      ) AS d(day) WHERE s.user_id = ${userId} AND s.ended_at <= ${now}`);
    const goals = await tx.select().from(goalsTable).where(eq(goalsTable.userId, userId));
    const rows = await tx.select({ task: tasksTable }).from(tasksTable).innerJoin(goalsTable, eq(tasksTable.goalId, goalsTable.id)).where(eq(goalsTable.userId, userId));
    const tasks = rows.map((row) => row.task);
    const summaries = goals.map((goal) => goalSummary(goal, tasks.filter((task) => task.goalId === goal.id)));
    const [user] = await tx.select({ dailyTarget: usersTable.availableHours }).from(usersTable).where(eq(usersTable.id, userId));
    const dailyTargetHours = Number.isFinite(user?.dailyTarget) && Number(user?.dailyTarget) > 0 ? Number(user?.dailyTarget) : 4;
    // Progress dates have no time-of-day: explicitly label them date-only in the response.
    const activity = await tx.execute<{ key: string; kind: "session" | "completed" | "missed" | "recovered"; at: string; dateOnly: boolean; title: string; minutes: number | null }>(sql`
      SELECT key, kind, at, "dateOnly", title, minutes FROM (
        SELECT 'session:' || s.id AS key, 'session' AS kind,
          to_char(s.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
          false AS "dateOnly", coalesce(g.goal_name, 'General study / removed goal') AS title,
          (extract(epoch FROM (s.ended_at - s.started_at)) / 60)::double precision AS minutes
        FROM public.pathpilot_study_sessions s
        LEFT JOIN public.pathpilot_goals g ON g.id = s.goal_id AND g.user_id = ${userId}
        WHERE s.user_id = ${userId} AND s.started_at < ${range.end} AND s.ended_at > ${range.start}
        UNION ALL
        SELECT 'progress:' || p.id, p.status, p.date::text || 'T00:00:00.000Z', true, t.task_name, null::double precision
        FROM public.pathpilot_progress p JOIN public.pathpilot_tasks t ON t.id = p.task_id
        JOIN public.pathpilot_goals g ON g.id = t.goal_id
        WHERE p.user_id = ${userId} AND g.user_id = ${userId} AND p.status IN ('completed', 'missed', 'recovered')
          AND p.date >= ${range.from}::date AND p.date <= ${range.to}::date
      ) activity ORDER BY at DESC, key DESC LIMIT 51 OFFSET ${offset}`);
    const days = fillStudyDays(range, daily.rows, completionDays.rows);
    return {
      range: { from: range.from, to: range.to, timeZone: "UTC" as const, weekStartsOn: "Monday" as const },
      summary: {
        recordedMinutes: Number(days.reduce((sum, day) => sum + day.minutes, 0).toFixed(2)),
        completedSessions: sessionStats.rows[0]?.count ?? 0,
        averageSessionMinutes: sessionStats.rows[0]?.average ?? null,
        completedTasksInRange: completed.rows[0]?.count ?? 0,
        currentCompletionPercent: taskCompletionProgress(tasks),
        currentTaskCounts: { completed: tasks.filter((task) => task.status === "completed").length, pending: tasks.filter((task) => task.status === "pending").length, missed: tasks.filter((task) => task.status === "missed").length },
        activeGoals: summaries.filter((goal) => goal.taskCount === 0 || goal.completedCount < goal.taskCount).length,
        currentStreak: currentStudyStreak(streakDays.rows.map((day) => day.date), now),
        dailyTargetHours,
      },
      days, goals: summaries,
      activity: activity.rows.slice(0, 50), activityHasMore: activity.rows.length > 50,
      insights: studyInsights(days, dailyTargetHours, summaries, now),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
