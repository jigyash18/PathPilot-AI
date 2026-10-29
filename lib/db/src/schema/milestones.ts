import { date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { goalsTable } from "./goals";
import { tasksTable } from "./tasks";

export const milestonesTable = pgTable("pathpilot_milestones", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => goalsTable.id),
  title: text("title").notNull(),
  targetDate: date("target_date", { mode: "string" }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("pathpilot_milestones_goal_idx").on(table.goalId)]);

export const milestoneTasksTable = pgTable("pathpilot_milestone_tasks", {
  id: serial("id").primaryKey(),
  milestoneId: integer("milestone_id").notNull().references(() => milestonesTable.id),
  taskId: integer("task_id").notNull().references(() => tasksTable.id),
}, (table) => [uniqueIndex("pathpilot_milestone_task_uq").on(table.milestoneId, table.taskId)]);

export type Milestone = typeof milestonesTable.$inferSelect;
export type MilestoneTask = typeof milestoneTasksTable.$inferSelect;
