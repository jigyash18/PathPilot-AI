import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { buildSessionRecord, clearSessionCookie, createSession, getSessionUser, hashPassword, isValidEmail, isValidPassword, normalizeEmail, revokeSession, setSessionCookie, verifyPassword } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

class DuplicateEmailError extends Error {}

function logAuthFailure(operation: string, error: unknown): void {
  if (error instanceof Error) {
    const databaseError = error as Error & { code?: unknown };
    const safeMessage = error.message.split("\nparams:", 1)[0];
    logger.error({
      operation,
      error: {
        name: error.name,
        message: safeMessage,
        ...(typeof databaseError.code === "string" ? { code: databaseError.code } : {}),
      },
    }, "Authentication operation failed");
    return;
  }
  logger.error({ operation, errorType: typeof error }, "Authentication operation failed");
}

router.get("/auth/session", async (req, res): Promise<void> => {
  try {
    const user = await getSessionUser(req);
    res.json(user ? { authenticated: true, user } : { authenticated: false, user: null });
  } catch (error) {
    logAuthFailure("session_lookup", error);
    res.status(500).json({ error: "Could not read the current session." });
  }
});

router.post("/auth/signup", async (req, res): Promise<void> => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (name.length < 1 || name.length > 120) { res.status(400).json({ error: "Full name must contain 1 to 120 characters." }); return; }
  if (!isValidEmail(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
   if (!isValidPassword(password)) { res.status(400).json({ error: "Password must contain 8 to 200 characters." }); return; }
  try {
    const passwordHash = await hashPassword(password);
    const created = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.email}) = ${email}`).limit(1);
      if (existing) throw new DuplicateEmailError();
      const [user] = await tx.insert(usersTable).values({ name, email, passwordHash }).returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email });
      if (!user?.email) throw new Error("Account creation did not return a usable identity.");
      const session = buildSessionRecord(user.id, false);
      await tx.insert(sessionsTable).values(session.values);
      return { user, token: session.token };
    });
    const { user, token } = created;
    setSessionCookie(res, token, false);
    res.status(201).json({ authenticated: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    if (error instanceof DuplicateEmailError || error instanceof Error && /unique|duplicate/i.test(error.message)) { res.status(409).json({ error: "An account with that email already exists." }); return; }
    logAuthFailure("signup", error);
    res.status(500).json({ error: "Could not create the account." });
  }
});

router.post("/auth/signin", async (req, res): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const rememberMe = req.body?.rememberMe === true;
  if (!isValidEmail(email) || !password) { res.status(400).json({ error: "Enter your email and password." }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${email}`).limit(1);
    if (!user?.passwordHash || !user.email || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    const token = await createSession(user.id, rememberMe);
    setSessionCookie(res, token, rememberMe);
    res.json({ authenticated: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    logAuthFailure("signin", error);
    res.status(500).json({ error: "Could not sign you in." });
  }
});

router.post("/auth/signout", async (req, res): Promise<void> => {
  try {
    await revokeSession(req);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    logAuthFailure("signout", error);
    res.status(500).json({ error: "Could not sign you out." });
  }
});

export default router;
