import { date, index, integer, pgTable, real, serial, text } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

export const progressTable = pgTable("pathpilot_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  taskId: integer("task_id").notNull().references(() => tasksTable.id),
  date: date("date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  completionPercent: real("completion_percent").notNull().default(0),
}, (table) => [index("pathpilot_progress_user_task_date_idx").on(table.userId, table.taskId, table.date)]);

export type Progress = typeof progressTable.$inferSelect;
export type InsertProgress = typeof progressTable.$inferInsert;
