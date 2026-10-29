import { customFetch } from '@workspace/api-client-react';

export type AuthUser = {
  id: number | string;
  name: string;
  email: string;
};

export type AuthSession = {
  authenticated: boolean;
  user: AuthUser | null;
};

type AuthErrorResponse = { error: string };

const sessionRequest = { credentials: 'include' as const };

export function getAuthSession() {
  return customFetch<AuthSession>('/api/auth/session', sessionRequest);
}

export function signIn(input: { email: string; password: string; rememberMe: boolean }) {
  return customFetch<AuthSession>('/api/auth/signin', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(input),
  });
}

export function signUp(input: { name: string; email: string; password: string }) {
  return customFetch<AuthSession>('/api/auth/signup', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(input),
  });
}

export function signOut() {
  return customFetch<unknown>('/api/auth/signout', {
    method: 'POST',
    credentials: 'include',
  });
}

export function getAuthErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  const response = error as { data?: AuthErrorResponse; message?: string };
  if (response.data?.error) return response.data.error;
  if (response.message) return response.message;
  return fallback;
}

export function getUserInitials(user: AuthUser) {
  const initials = user.name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return initials || user.email.slice(0, 2).toUpperCase();
}
