import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pathpilotRouter from "./pathpilot";
import authRouter from "./auth";
import profileRouter from "./profile";
import { createStudyAnalyticsRouter } from "./study-analytics";
import { loadStudyAnalytics, studySessionDatabase } from "../lib/study-repository";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(createStudyAnalyticsRouter({
  authenticate: requireAuth,
  database: studySessionDatabase,
  load: loadStudyAnalytics,
  log: (operation, code) => logger.error({ operation, code }, "Study activity operation failed"),
}));
router.use(profileRouter);
router.use(pathpilotRouter);

export default router;
