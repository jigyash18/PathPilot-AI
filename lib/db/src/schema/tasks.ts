import { date, index, integer, pgTable, real, serial, text } from "drizzle-orm/pg-core";
import { goalsTable } from "./goals";

export const tasksTable = pgTable("pathpilot_tasks", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => goalsTable.id),
  taskName: text("task_name").notNull(),
  topic: text("topic").notNull().default("Uncategorized"),
  durationHours: real("duration_hours").notNull(),
  priority: text("priority").notNull(),
  difficulty: text("difficulty").notNull(),
  status: text("status").notNull().default("pending"),
  scheduledDate: date("scheduled_date", { mode: "string" }),
  completionPercent: real("completion_percent").notNull().default(0),
  completedAt: date("completed_at", { mode: "string" }),
}, (table) => [index("pathpilot_tasks_goal_idx").on(table.goalId)]);

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;
