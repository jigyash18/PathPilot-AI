import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const usersTable = pgTable("pathpilot_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  passwordHash: text("password_hash"),
  availableHours: real("available_hours").notNull().default(4),
  preferredStart: text("preferred_start").notNull().default("09:00"),
  preferredEnd: text("preferred_end").notNull().default("18:00"),
}, (table) => [uniqueIndex("pathpilot_users_email_uq").on(sql`lower(${table.email})`).where(sql`${table.email} IS NOT NULL`)]);

export const sessionsTable = pgTable("pathpilot_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  rememberMe: boolean("remember_me").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  uniqueIndex("pathpilot_sessions_token_hash_uq").on(table.tokenHash),
  index("pathpilot_sessions_user_idx").on(table.userId),
  index("pathpilot_sessions_expiry_idx").on(table.expiresAt),
]);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
