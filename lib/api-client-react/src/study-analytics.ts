import { customFetch } from "./custom-fetch";
import type { Goal } from "./generated/api.schemas";

export type StudyRangeSelection = { range: "week" | "last-week" | "30-days" | "custom"; from?: string; to?: string };
export type StudySessionInput = { requestId: string; goalId: number | null; startedAt: string; endedAt: string };
export type StudyActivity = { key: string; kind: "session" | "completed" | "missed" | "recovered"; at: string; dateOnly: boolean; title: string; minutes: number | null };
export type StudyAnalytics = {
  range: { from: string; to: string; timeZone: "UTC"; weekStartsOn: "Monday" };
  summary: { recordedMinutes: number; completedSessions: number; averageSessionMinutes: number | null; completedTasksInRange: number; currentCompletionPercent: number; currentTaskCounts: { completed: number; pending: number; missed: number }; activeGoals: number; currentStreak: number; dailyTargetHours: number };
  days: { date: string; minutes: number; completedTasks: number }[];
  goals: Goal[];
  activity: StudyActivity[];
  activityHasMore: boolean;
  insights: { title: string; detail: string; href: string }[];
};

export function getStudyAnalytics(selection: StudyRangeSelection, offset = 0, signal?: AbortSignal) {
  const query = new URLSearchParams({ range: selection.range, offset: String(offset) });
  if (selection.range === "custom") { query.set("from", selection.from ?? ""); query.set("to", selection.to ?? ""); }
  return customFetch<StudyAnalytics>(`/api/study-analytics?${query}`, { credentials: "include", signal });
}
export function recordStudySession(input: StudySessionInput) {
  return customFetch<{ id: number; goalId: number | null; startedAt: string; endedAt: string; minutes: number }>("/api/study-sessions", { method: "POST", credentials: "include", body: JSON.stringify(input) });
}
