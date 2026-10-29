import type { RequestHandler } from "express";
import { validateConfirmedTaskPlan } from "../lib/pathpilot/task-generation.ts";

export const requireConfirmedTaskPlan: RequestHandler = (req, res, next) => {
  const body = req.body as { confirmedTasks?: unknown; skills?: unknown; dailyHours?: unknown } | null;
  if (!body || !Array.isArray(body.skills) || body.skills.some((skill) => typeof skill !== "string")) {
    res.status(400).json({ error: "Goal skills and confirmedTasks are required." });
    return;
  }
  if (typeof body.dailyHours !== "number" || body.dailyHours < 0.5 || body.dailyHours > 24) {
    res.status(400).json({ error: "dailyHours must be between 0.5 and 24." });
    return;
  }
  const tasks = validateConfirmedTaskPlan(body.confirmedTasks, body.skills);
  if (!tasks) {
    res.status(400).json({ error: "Confirm a valid task plan before creating the goal. Request task-plan-preview first, then submit confirmedTasks." });
    return;
  }
  res.locals.confirmedTasks = tasks;
  next();
};

