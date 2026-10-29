import { date, integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { goalsTable } from "./goals";
import { tasksTable } from "./tasks";

export const planVersionsTable = pgTable("pathpilot_plan_versions", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => goalsTable.id),
  version: integer("version").notNull(),
  dailyHours: real("daily_hours").notNull(),
  deadline: date("deadline", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("pathpilot_plan_versions_goal_version_uq").on(table.goalId, table.version)]);

export const planVersionTasksTable = pgTable("pathpilot_plan_version_tasks", {
  id: serial("id").primaryKey(),
  planVersionId: integer("plan_version_id").notNull().references(() => planVersionsTable.id),
  taskId: integer("task_id").notNull().references(() => tasksTable.id),
  scheduledDate: date("scheduled_date", { mode: "string" }),
  taskName: text("task_name"),
  topic: text("topic"),
  durationHours: real("duration_hours"),
}, (table) => [uniqueIndex("pathpilot_plan_version_task_uq").on(table.planVersionId, table.taskId)]);

export type PlanVersion = typeof planVersionsTable.$inferSelect;
export type PlanVersionTask = typeof planVersionTasksTable.$inferSelect;
