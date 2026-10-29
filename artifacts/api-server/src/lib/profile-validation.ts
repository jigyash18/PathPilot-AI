export const PROFILE_NAME_MAX_LENGTH = 120;
export const STUDY_HOURS_MIN = 0.5;
export const STUDY_HOURS_MAX = 24;

export type StudyPreferencesInput = {
  availableHours: number;
  preferredStart: string;
  preferredEnd: string;
};

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function minutesFromTime(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours === undefined || minutes === undefined || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function validateProfileName(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") return { ok: false, error: "Full name is required." };
  const name = value.trim();
  if (name.length < 1) return { ok: false, error: "Full name is required." };
  if (name.length > PROFILE_NAME_MAX_LENGTH) return { ok: false, error: `Full name must be ${PROFILE_NAME_MAX_LENGTH} characters or fewer.` };
  return { ok: true, data: name };
}

export function validateStudyPreferences(input: {
  availableHours?: unknown;
  preferredStart?: unknown;
  preferredEnd?: unknown;
}): ValidationResult<StudyPreferencesInput> {
  const availableHours = typeof input.availableHours === "number" ? input.availableHours : Number(input.availableHours);
  if (!Number.isFinite(availableHours) || availableHours < STUDY_HOURS_MIN || availableHours > STUDY_HOURS_MAX) {
    return { ok: false, error: `Daily study target must be between ${STUDY_HOURS_MIN} and ${STUDY_HOURS_MAX} hours.` };
  }
  if (typeof input.preferredStart !== "string" || minutesFromTime(input.preferredStart) === null) {
    return { ok: false, error: "Study start time must use HH:MM format." };
  }
  if (typeof input.preferredEnd !== "string" || minutesFromTime(input.preferredEnd) === null) {
    return { ok: false, error: "Study end time must use HH:MM format." };
  }
  const start = minutesFromTime(input.preferredStart);
  const end = minutesFromTime(input.preferredEnd);
  if (start === null || end === null || start >= end) {
    return { ok: false, error: "Study time must stay within the same day, with the end time after the start time." };
  }
  return {
    ok: true,
    data: {
      availableHours: Number(availableHours.toFixed(2)),
      preferredStart: input.preferredStart,
      preferredEnd: input.preferredEnd,
    },
  };
}
