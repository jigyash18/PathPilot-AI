export type DateDisplayOptions = Intl.DateTimeFormatOptions;

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/;

export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const day = match[1]!;
  const date = new Date(`${day}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? date : null;
}

export function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDate(value: unknown, options?: DateDisplayOptions, fallback = "Date unavailable — review goal data") {
  const date = typeof value === "string" && DATE_ONLY.test(value) ? parseDateOnly(value) : parseTimestamp(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat("en-US", options ?? { month: "short", day: "numeric" }).format(date);
}

export function daysUntil(value: unknown, now = new Date()): number | null {
  const deadline = parseDateOnly(value);
  if (!deadline || !Number.isFinite(now.getTime())) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const target = Date.parse(`${deadline.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(today) || !Number.isFinite(target)) return null;
  return Math.max(0, Math.round((target - today) / 86_400_000));
}

export function isDateOnly(value: unknown): value is string {
  return parseDateOnly(value) !== null;
}
