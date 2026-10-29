import { check, integer, pgTable, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tasksTable } from "./tasks";

export const dependenciesTable = pgTable("pathpilot_dependencies", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id),
  dependsOn: integer("depends_on").notNull().references(() => tasksTable.id),
}, (table) => [
  uniqueIndex("pathpilot_dependency_pair_uq").on(table.taskId, table.dependsOn),
  check("pathpilot_dependency_not_self_ck", sql`${table.taskId} <> ${table.dependsOn}`),
]);

export type Dependency = typeof dependenciesTable.$inferSelect;
export type InsertDependency = typeof dependenciesTable.$inferInsert;
