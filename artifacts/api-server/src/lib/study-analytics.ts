import { isIsoDate, mondayWeekStart, utcCalendarDate } from "./pathpilot/progress-analytics";

const DAY = 86_400_000;
export class StudyInputError extends Error {
  constructor(message: string, public status = 400, public field?: string) { super(message); }
}
export type StudyRange = { from: string; to: string; start: Date; end: Date };
export function studyRange(query: Record<string, unknown>, now = new Date()): StudyRange {
  const today = utcCalendarDate(now);
  const shift = (date: string, days: number) => utcCalendarDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY));
  let from: string;
  let to = today;
  switch (query.range ?? "week") {
    case "week": from = mondayWeekStart(now); break;
    case "last-week": to = shift(mondayWeekStart(now), -1); from = shift(to, -6); break;
    case "30-days": from = shift(today, -29); break;
    case "custom":
      if (typeof query.from !== "string" || typeof query.to !== "string" || !isIsoDate(query.from) || !isIsoDate(query.to)) {
        throw new StudyInputError("Choose valid start and end dates (YYYY-MM-DD).");
      }
      from = query.from; to = query.to; break;
    default: throw new StudyInputError("Choose a supported date range.");
  }
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + DAY);
  if (from > to || to > today || (end.getTime() - start.getTime()) / DAY > 366) {
    throw new StudyInputError("Choose up to 366 days, with the end on or before today (UTC).");
  }
  return { from, to, start, end };
}

export type SessionInput = { requestId: string; goalId: number | null; startedAt: Date; endedAt: Date };
export function validateStudySession(body: unknown, now = new Date()): SessionInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new StudyInputError("Enter a completed study session.");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["requestId", "goalId", "startedAt", "endedAt"].includes(key))) {
    throw new StudyInputError("Unexpected session fields. Ownership and duration are determined by the server.");
  }
  if (typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)) {
    throw new StudyInputError("A valid request ID is required.", 400, "requestId");
  }
  const parse = (field: "startedAt" | "endedAt") => {
    const text = value[field];
    // Explicit UTC timestamps only: neither server locale nor browser timezone is implicit.
    if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(text)) {
      throw new StudyInputError("Use a valid UTC date and time.", 400, field);
    }
    const date = new Date(text);
    if (!Number.isFinite(date.getTime()) || date.toISOString().replace(".000Z", "Z") !== text.replace(".000Z", "Z")) {
      throw new StudyInputError("Use a valid UTC date and time.", 400, field);
    }
    return date;
  };
  const startedAt = parse("startedAt");
  const endedAt = parse("endedAt");
  const duration = endedAt.getTime() - startedAt.getTime();
  if (duration < 60_000 || duration > 12 * 3_600_000) throw new StudyInputError("A session must last between 1 minute and 12 hours.", 400, "endedAt");
  if (endedAt > now) throw new StudyInputError("Only completed sessions can be recorded; the end cannot be in the future.", 400, "endedAt");
  if (startedAt.getTime() < now.getTime() - 366 * DAY) throw new StudyInputError("Record sessions from the last 366 days.", 400, "startedAt");
  if (value.goalId != null && (!Number.isSafeInteger(value.goalId) || Number(value.goalId) <= 0)) throw new StudyInputError("Choose a valid goal.", 400, "goalId");
  return { requestId: value.requestId.toLowerCase(), goalId: value.goalId == null ? null : Number(value.goalId), startedAt, endedAt };
}

export type DailyStudy = { date: string; minutes: number; completedTasks: number };
export function fillStudyDays(range: StudyRange, recorded: { date: string; minutes: number }[], completed: { date: string; completedTasks: number }[]): DailyStudy[] {
  const minutes = new Map(recorded.map((day) => [day.date, Number(day.minutes)]));
  const tasks = new Map(completed.map((day) => [day.date, Number(day.completedTasks)]));
  const days: DailyStudy[] = [];
  for (let at = range.start.getTime(); at < range.end.getTime(); at += DAY) {
    const date = utcCalendarDate(new Date(at));
    days.push({ date, minutes: Number((minutes.get(date) ?? 0).toFixed(2)), completedTasks: tasks.get(date) ?? 0 });
  }
  return days;
}

export function currentStudyStreak(dates: string[], now = new Date()): number {
  const recorded = new Set(dates);
  let at = Date.parse(`${utcCalendarDate(now)}T00:00:00Z`);
  if (!recorded.has(utcCalendarDate(new Date(at)))) at -= DAY;
  let streak = 0;
  while (recorded.has(utcCalendarDate(new Date(at)))) { streak++; at -= DAY; }
  return streak;
}

export function studyInsights(days: DailyStudy[], dailyTargetHours: number, goals: { id: number; goalName: string; deadline: string; taskCount: number; completedCount: number }[], now = new Date()) {
  const result: { title: string; detail: string; href: string }[] = [];
  const activeDays = days.filter((day) => day.minutes > 0).length;
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  result.push(total === 0
    ? { title: "Start your study record", detail: "No study time was recorded in this range. Log a completed session; missing records do not prove you did not study.", href: "#record-study" }
    : { title: "Your recorded rhythm", detail: `${Math.round(total)} minutes across ${activeDays} of ${days.length} days in this range. This is self-reported time, not task-duration estimates.`, href: "#study-activity" });
  if (Number.isFinite(dailyTargetHours) && dailyTargetHours > 0 && total > 0) {
    const met = days.filter((day) => day.minutes >= dailyTargetHours * 60).length;
    result.push({ title: "Target check-in", detail: `${met} days reached your current ${dailyTargetHours} h/day preference. This compares historical records with today's setting, not a historical target. Adjust it if your schedule has changed.`, href: "/profile" });
  }
  const today = utcCalendarDate(now);
  const soon = utcCalendarDate(new Date(now.getTime() + 7 * DAY));
  const urgent = goals.filter((goal) => goal.completedCount < goal.taskCount && goal.deadline <= soon);
  if (urgent.length) result.push({ title: "Review approaching deadlines", detail: `${urgent.length} unfinished goals are overdue or due within 7 days as of ${today} UTC. Review pending work in Goal studio before explicitly replanning.`, href: "/goals" });
  if (days.length >= 14 && activeDays >= 4) {
    const recent = days.slice(-7).reduce((sum, day) => sum + day.minutes, 0);
    const previous = days.slice(-14, -7).reduce((sum, day) => sum + day.minutes, 0);
    result.push({ title: "Two-week comparison", detail: `Last 7 days of this range: ${Math.round(recent)} recorded minutes; preceding 7 days: ${Math.round(previous)}. Incomplete logging can affect this comparison.`, href: "#study-activity" });
  }
  return result;
}
