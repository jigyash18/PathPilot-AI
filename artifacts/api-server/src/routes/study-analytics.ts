import { Router, type RequestHandler } from "express";
import { StudyInputError, studyRange, validateStudySession } from "../lib/study-analytics";
import { publicStudySession, recordStudySession, type StudySessionDatabase } from "../lib/study-session-service";
import type { loadStudyAnalytics } from "../lib/study-repository";

// Never serialize an ORM error, query parameters, body, cookie, or error message.
export function safeStudyErrorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const item = current as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string" && /^[0-9A-Z]{5}$/.test(item.code)) return item.code;
    current = item.cause;
  }
  return "UNKNOWN";
}

export function createStudyAnalyticsRouter(dependencies: {
  authenticate: RequestHandler;
  database: StudySessionDatabase;
  load: typeof loadStudyAnalytics;
  log: (operation: string, code: string) => void;
}) {
  const router = Router();
  const failure = (res: Parameters<RequestHandler>[1], error: unknown, operation: string) => {
    if (error instanceof StudyInputError) { res.status(error.status).json({ error: error.message, field: error.field }); return; }
    const code = safeStudyErrorCode(error);
    dependencies.log(operation, code);
    if (code === "42P01" || code === "42703") {
      res.status(503).json({ error: "Study analytics storage is not ready. Ask the operator to review and approve the study-session migration.", code: "STUDY_STORAGE_UNAVAILABLE" });
      return;
    }
    res.status(500).json({ error: "Could not process study activity. Please retry." });
  };
  router.get("/study-analytics", dependencies.authenticate, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const now = new Date();
      const range = studyRange(req.query, now);
      const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || offset % 50 !== 0 || (req.query.offset !== undefined && typeof req.query.offset !== "string")) {
        throw new StudyInputError("Choose a valid activity page (up to 10,000 records; narrow the range for older activity).");
      }
      res.json(await dependencies.load(req.auth!.id, range, offset, now));
    } catch (error) { failure(res, error, "study_analytics"); }
  });
  router.post("/study-sessions", dependencies.authenticate, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const input = validateStudySession(req.body);
      const result = await recordStudySession(dependencies.database, req.auth!.id, input);
      res.status(result.created ? 201 : 200).json(publicStudySession(result.session));
    } catch (error) { failure(res, error, "study_record"); }
  });
  return router;
}
