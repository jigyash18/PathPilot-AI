import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { goalsTable } from "./goals";

// Recorded study activity, distinct from authentication sessions and task estimates.
export const studySessionsTable = pgTable("pathpilot_study_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  goalId: integer("goal_id").references(() => goalsTable.id, { onDelete: "set null" }),
  requestId: uuid("request_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pathpilot_study_sessions_request_uq").on(table.userId, table.requestId),
  index("pathpilot_study_sessions_user_start_idx").on(table.userId, table.startedAt),
  index("pathpilot_study_sessions_user_end_idx").on(table.userId, table.endedAt),
  index("pathpilot_study_sessions_goal_idx").on(table.goalId),
  check("pathpilot_study_sessions_duration_check", sql`${table.endedAt} - ${table.startedAt} between interval '1 minute' and interval '12 hours'`),
]);
