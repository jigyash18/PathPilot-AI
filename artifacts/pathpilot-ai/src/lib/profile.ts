import { customFetch } from '@workspace/api-client-react';

export type ProfilePreferences = {
  availableHours: number;
  preferredStart: string;
  preferredEnd: string;
};

export type UserProfile = {
  id: number;
  name: string;
  email: string;
  accountCreatedAt: string | null;
  preferences: ProfilePreferences;
};

export type ProfileApiError = {
  data?: { field?: string; error?: string };
  message?: string;
};

export const DEFAULT_DAILY_STUDY_HOURS = 4;

export function defaultGoalDailyHours(preferences?: ProfilePreferences): number {
  return preferences?.availableHours ?? DEFAULT_DAILY_STUDY_HOURS;
}

export function getProfile() {
  return customFetch<UserProfile>('/api/profile', { credentials: 'include' });
}

export function updateProfile(input: { name: string }) {
  return customFetch<UserProfile>('/api/profile', {
    method: 'PATCH',
    credentials: 'include',
    body: JSON.stringify(input),
  });
}

export function updateStudyPreferences(input: ProfilePreferences) {
  return customFetch<UserProfile>('/api/profile/preferences', {
    method: 'PATCH',
    credentials: 'include',
    body: JSON.stringify(input),
  });
}

export function changePassword(input: { currentPassword: string; newPassword: string; confirmPassword: string }) {
  return customFetch<{ authenticated: true; user: { id: number; name: string; email: string }; message: string }>('/api/profile/password', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(input),
  });
}

export function getProfileError(error: unknown, fallback: string): { field?: string; message: string } {
  const response = error as ProfileApiError;
  return {
    field: response.data?.field,
    message: response.data?.error || response.message || fallback,
  };
}
