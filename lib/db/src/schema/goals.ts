import { date, integer, pgTable, real, serial, text } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const goalsTable = pgTable("pathpilot_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  goalName: text("goal_name").notNull(),
  goalType: text("goal_type").notNull(),
  deadline: date("deadline", { mode: "string" }).notNull(),
  dailyHours: real("daily_hours").notNull(),
  priority: text("priority").notNull(),
  description: text("description").notNull().default(""),
  skills: text("skills").array().notNull().default([]),
});

export type Goal = typeof goalsTable.$inferSelect;
export type InsertGoal = typeof goalsTable.$inferInsert;