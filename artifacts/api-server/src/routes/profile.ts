import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { buildSessionRecord, hashPassword, isValidPassword, requireAuth, setSessionCookie, verifyPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../lib/auth";
import { logger } from "../lib/logger";
import { validateProfileName, validateStudyPreferences } from "../lib/profile-validation";

const router: IRouter = Router();
router.use(requireAuth);

function publicProfile(user: {
  id: number;
  name: string;
  email: string | null;
  availableHours: number | string;
  preferredStart: string;
  preferredEnd: string;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    accountCreatedAt: null,
    preferences: {
      availableHours: Number(user.availableHours),
      preferredStart: user.preferredStart,
      preferredEnd: user.preferredEnd,
    },
  };
}

function logProfileFailure(operation: string, error: unknown): void {
  if (error instanceof Error) {
    const databaseError = error as Error & { code?: unknown };
    logger.error({
      operation,
      error: {
        name: error.name,
        message: error.message.split("\nparams:", 1)[0],
        ...(typeof databaseError.code === "string" ? { code: databaseError.code } : {}),
      },
    }, "Profile operation failed");
    return;
  }
  logger.error({ operation, errorType: typeof error }, "Profile operation failed");
}

router.get("/profile", async (req, res): Promise<void> => {
  try {
    const [user] = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      availableHours: usersTable.availableHours,
      preferredStart: usersTable.preferredStart,
      preferredEnd: usersTable.preferredEnd,
    }).from(usersTable).where(eq(usersTable.id, req.auth!.id)).limit(1);
    if (!user || !user.email) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json(publicProfile(user));
  } catch (error) {
    logProfileFailure("profile_lookup", error);
    res.status(500).json({ error: "Could not load your profile." });
  }
});

router.patch("/profile", async (req, res): Promise<void> => {
  const name = validateProfileName(req.body?.name);
  if (!name.ok) {
    res.status(400).json({ field: "name", error: name.error });
    return;
  }
  try {
    const [user] = await db.update(usersTable).set({ name: name.data }).where(eq(usersTable.id, req.auth!.id)).returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      availableHours: usersTable.availableHours,
      preferredStart: usersTable.preferredStart,
      preferredEnd: usersTable.preferredEnd,
    });
    if (!user || !user.email) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json(publicProfile(user));
  } catch (error) {
    logProfileFailure("profile_update", error);
    res.status(500).json({ error: "Could not save your profile." });
  }
});

router.patch("/profile/preferences", async (req, res): Promise<void> => {
  const preferences = validateStudyPreferences(req.body ?? {});
  if (!preferences.ok) {
    res.status(400).json({ field: "preferences", error: preferences.error });
    return;
  }
  try {
    const [user] = await db.update(usersTable).set(preferences.data).where(eq(usersTable.id, req.auth!.id)).returning({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      availableHours: usersTable.availableHours,
      preferredStart: usersTable.preferredStart,
      preferredEnd: usersTable.preferredEnd,
    });
    if (!user || !user.email) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json(publicProfile(user));
  } catch (error) {
    logProfileFailure("preferences_update", error);
    res.status(500).json({ error: "Could not save your study preferences." });
  }
});

router.post("/profile/password", async (req, res): Promise<void> => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";
  if (!currentPassword) {
    res.status(400).json({ field: "currentPassword", error: "Current password is required." });
    return;
  }
  if (!isValidPassword(newPassword)) {
    res.status(400).json({ field: "newPassword", error: `New password must contain ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.` });
    return;
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ field: "confirmPassword", error: "New password confirmation does not match." });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ field: "newPassword", error: "Choose a new password different from the current password." });
    return;
  }
  try {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, passwordHash: usersTable.passwordHash })
      .from(usersTable).where(eq(usersTable.id, req.auth!.id)).limit(1);
    if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      res.status(401).json({ field: "currentPassword", error: "Current password is incorrect." });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    const session = buildSessionRecord(req.auth!.id, false);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, req.auth!.id));
      await tx.delete(sessionsTable).where(eq(sessionsTable.userId, req.auth!.id));
      await tx.insert(sessionsTable).values(session.values);
    });
    setSessionCookie(res, session.token, false);
    res.json({ authenticated: true, user: { id: req.auth!.id, name: user.name, email: user.email }, message: "Password changed. Other sessions were signed out." });
  } catch (error) {
    logProfileFailure("password_change", error);
    res.status(500).json({ error: "Could not change your password." });
  }
});

export default router;
