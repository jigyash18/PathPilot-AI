import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Request, RequestHandler, Response } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { safeErrorDiagnostics } from "./safe-error-logging";

export const SESSION_COOKIE = "pathpilot_session";
export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
export const REMEMBER_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 32 * 1024 * 1024;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

function deriveKey(password: string, salt: string, keyLength: number, parameters: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { ...parameters, maxmem: SCRYPT_MAXMEM }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export type AuthUser = { id: number; name: string; email: string };

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

export function sessionDuration(rememberMe: boolean): number {
  return rememberMe ? REMEMBER_SESSION_DURATION_MS : SESSION_DURATION_MS;
}

export function isSessionExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function canAccessOwnedResource(resourceUserId: number, sessionUserId: number): boolean {
  return resourceUserId === sessionUserId;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await deriveKey(password, salt, PASSWORD_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const parts = encoded.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, salt, expectedEncoded] = parts;
    if (n !== String(SCRYPT_N) || r !== String(SCRYPT_R) || p !== String(SCRYPT_P)) return false;
    if (!/^[A-Za-z0-9_-]{22}$/.test(salt!) || !/^[A-Za-z0-9_-]{86}$/.test(expectedEncoded!)) return false;
    const expected = Buffer.from(expectedEncoded!, "base64url");
    if (expected.length !== PASSWORD_KEY_LENGTH) return false;
    const actual = await deriveKey(password, salt!, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toPublicUser(user: { id: number; name: string; email: string | null }): AuthUser | null {
  return user.email ? { id: user.id, name: user.name, email: user.email } : null;
}

export function buildSessionRecord(userId: number, rememberMe: boolean): { token: string; values: { userId: number; tokenHash: string; expiresAt: Date; rememberMe: boolean } } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    values: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + sessionDuration(rememberMe)),
      rememberMe,
    },
  };
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date()));
}

export async function createSession(userId: number, rememberMe: boolean): Promise<string> {
  await purgeExpiredSessions();
  const session = buildSessionRecord(userId, rememberMe);
  await db.insert(sessionsTable).values(session.values);
  return session.token;
}

export function setSessionCookie(res: Response, token: string, rememberMe: boolean): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(rememberMe ? { maxAge: REMEMBER_SESSION_DURATION_MS } : {}),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function getSessionUser(req: Request): Promise<AuthUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== "string") return null;
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.tokenHash, hashSessionToken(token))).limit(1);
  if (!session) return null;
  if (isSessionExpired(session.expiresAt)) {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id));
    return null;
  }
  const [user] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
  const result = user ? toPublicUser(user) : null;
  if (!result) {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id));
    return null;
  }
  await db.update(sessionsTable).set({ lastUsedAt: new Date() }).where(eq(sessionsTable.id, session.id));
  return result;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    req.auth = user;
    next();
  } catch (error) {
    logger.error({ operation: "session_authentication", error: safeErrorDiagnostics(error) }, "Authentication operation failed");
    res.status(500).json({ error: "Could not verify the current session." });
  }
};

export async function revokeSession(req: Request): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token && typeof token === "string") {
    await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, hashSessionToken(token)));
  }
}
