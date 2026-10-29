import { StudyInputError, type SessionInput } from "./study-analytics";

export type RecordedSession = SessionInput & { id: number; userId: number; createdAt: Date };
export interface StudySessionTransaction {
  lockUser(userId: number): Promise<boolean>;
  findRequest(userId: number, requestId: string): Promise<RecordedSession | undefined>;
  ownsGoal(userId: number, goalId: number): Promise<boolean>;
  overlaps(userId: number, startedAt: Date, endedAt: Date): Promise<boolean>;
  insert(userId: number, input: SessionInput): Promise<RecordedSession>;
}
export interface StudySessionDatabase {
  transaction<T>(work: (tx: StudySessionTransaction) => Promise<T>): Promise<T>;
}

export function recordStudySession(database: StudySessionDatabase, userId: number, input: SessionInput) {
  return database.transaction(async (tx) => {
    // Serializes checks and inserts across all API processes for the same account.
    if (!await tx.lockUser(userId)) throw new StudyInputError("Account unavailable.", 401);
    const existing = await tx.findRequest(userId, input.requestId);
    if (existing) {
      if (existing.goalId !== input.goalId || existing.startedAt.getTime() !== input.startedAt.getTime() || existing.endedAt.getTime() !== input.endedAt.getTime()) {
        throw new StudyInputError("This submission ID was already used for another session. Refresh before recording a different session.", 409);
      }
      return { session: existing, created: false };
    }
    if (input.goalId !== null && !await tx.ownsGoal(userId, input.goalId)) throw new StudyInputError("Goal not found.", 404, "goalId");
    if (await tx.overlaps(userId, input.startedAt, input.endedAt)) throw new StudyInputError("This time overlaps an already recorded session. Check your activity history.", 409, "startedAt");
    return { session: await tx.insert(userId, input), created: true };
  });
}

export function publicStudySession(session: RecordedSession) {
  return { id: session.id, goalId: session.goalId, startedAt: session.startedAt.toISOString(), endedAt: session.endedAt.toISOString(), minutes: (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000 };
}
