import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/pathpilot_test";

const {
  REMEMBER_SESSION_DURATION_MS,
  SESSION_DURATION_MS,
  buildSessionRecord,
  canAccessOwnedResource,
  hashPassword,
  isSessionExpired,
  sessionDuration,
  verifyPassword,
} = await import("./auth.ts");

test("password hashes are salted, non-plaintext, and verifiable", async () => {
  const password = "correct horse battery staple";
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword(password, "scrypt$999999$8$1$bad$bad"), false);
});

test("remember me selects the longer server-side session lifetime", () => {
  assert.equal(sessionDuration(false), SESSION_DURATION_MS);
  assert.equal(sessionDuration(true), REMEMBER_SESSION_DURATION_MS);
  const now = new Date("2026-10-23T00:00:00.000Z");
  assert.equal(isSessionExpired(new Date(now.getTime() + 1), now), false);
  assert.equal(isSessionExpired(now, now), true);
});

test("resource ownership rejects a different authenticated user", () => {
  assert.equal(canAccessOwnedResource(7, 7), true);
  assert.equal(canAccessOwnedResource(7, 8), false);
});

test("session records contain only a hash and the selected expiration policy", () => {
  const session = buildSessionRecord(7, true);
  assert.equal(session.values.userId, 7);
  assert.notEqual(session.values.tokenHash, session.token);
  assert.equal(session.values.rememberMe, true);
  assert.ok(session.values.expiresAt.getTime() > Date.now() + REMEMBER_SESSION_DURATION_MS - 1_000);
});
