import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CompleteTaskParams,
  CompleteTaskResponse,
  CreateGoalBody,
  CreateGoalResponse,
  GenerateRoadmapParams,
  GenerateRoadmapResponse,
  GetGoalProgressParams,
  GetGoalProgressResponse,
  GetGoalRecommendationsParams,
  GetGoalRecommendationsResponse,
  GetRoadmapParams,
  GetRoadmapResponse,
  ListGoalsResponse,
  MissTaskParams,
  MissTaskResponse,
  ReplanGoalParams,
  ReplanGoalResponse,
  PreviewAlternativePlansResponse,
  PreviewGoalTaskPlanBody,
  PreviewGoalTaskPlanResponse,
  GetProgressDashboardResponse,
  ConfirmMilestoneBody,
  ConfirmMilestoneResponse,
} from "@workspace/api-zod";
import {
  db,
  dependenciesTable,
  goalsTable,
  milestoneTasksTable,
  milestonesTable,
  planVersionTasksTable,
  planVersionsTable,
  progressTable,
  tasksTable,
} from "@workspace/db";
import {
  dateToString,
  buildSchedule,
  getGoalDependencies,
  getGoalTasks,
  goalSummary,
  parseDate,
  recoverMissedTasks,
  recommendationScore,
  scheduleGoal,
  taskView,
  type ScheduleResult,
} from "../lib/pathpilot";
import { createOpenAITaskSuggestionGenerator } from "../lib/pathpilot/openai-task-provider";
import { generateGoalTasks, type GeneratedTask } from "../lib/pathpilot/task-generation";
import { requireConfirmedTaskPlan } from "./task-confirmation";
import { compareReplan, explainReplan, increasedDailyCapacity, previewAlternativePlans } from "../lib/pathpilot/planning-explanations";
import { confirmedMilestoneState, isIsoDate, milestoneTaskIdsBelongToGoal, plannedCompletedTimeline, suggestMilestones, topicProgress, utcCalendarDate, weeklyProgress } from "../lib/pathpilot/progress-analytics";
import { transitionTaskStatus, type LifecycleDatabase } from "../lib/pathpilot/task-lifecycle";
import { deleteGoalRecords, type GoalDeletionDatabase } from "../lib/pathpilot/goal-deletion";
import { loadOwnedGoal } from "../lib/pathpilot/goal-ownership";
import { requireAuth } from "../lib/auth";
import { buildSmartRoadmap, prioritizeTasks } from "../lib/pathpilot/smart-roadmap";
import { planFingerprint } from "../lib/pathpilot/plan-fingerprint";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

async function getGoal(goalId: number, userId?: number) {
  const predicates = [eq(goalsTable.id, goalId), ...(userId === undefined ? [] : [eq(goalsTable.userId, userId)])];
  const [goal] = await db.select().from(goalsTable).where(and(...predicates));
  return goal;
}

async function getOwnedGoal(goalId: number, userId: number) {
  return loadOwnedGoal((id) => getGoal(id, userId), goalId, userId);
}

const lifecycleDatabase: LifecycleDatabase = {
  transaction: (work) => db.transaction((tx) => work({
    findTaskForUpdate: async (taskId, userId) => {
      const [task] = await tx.select().from(tasksTable).where(eq(tasksTable.id, taskId)).for("update");
      if (!task || userId === undefined) return task ?? null;
      const [goal] = await tx.select({ userId: goalsTable.userId }).from(goalsTable).where(eq(goalsTable.id, task.goalId));
      return goal?.userId === userId ? task : null;
    },
    findGoalUserId: async (goalId) => {
      const [goal] = await tx.select({ userId: goalsTable.userId }).from(goalsTable).where(eq(goalsTable.id, goalId));
      return goal?.userId ?? null;
    },
    updateTask: async (taskId, patch) => {
      const [task] = await tx.update(tasksTable).set(patch).where(eq(tasksTable.id, taskId)).returning();
      if (!task) throw new Error("Task disappeared during a locked transition.");
      return task;
    },
    insertProgress: async (event) => { await tx.insert(progressTable).values(event); },
  })),
};

const goalDeletionDatabase: GoalDeletionDatabase = {
  transaction: (work) => db.transaction((tx) => work({
    findGoalForUpdate: async (goalId, userId) => {
      const predicates = [eq(goalsTable.id, goalId), ...(userId === undefined ? [] : [eq(goalsTable.userId, userId)])];
      const [goal] = await tx.select({ id: goalsTable.id }).from(goalsTable)
        .where(and(...predicates)).for("update");
      return goal;
    },
    listTaskIds: async (goalId) => (await tx.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.goalId, goalId))).map((task) => task.id),
    listMilestoneIds: async (goalId) => (await tx.select({ id: milestonesTable.id }).from(milestonesTable).where(eq(milestonesTable.goalId, goalId))).map((milestone) => milestone.id),
    listPlanVersionIds: async (goalId) => (await tx.select({ id: planVersionsTable.id }).from(planVersionsTable).where(eq(planVersionsTable.goalId, goalId))).map((version) => version.id),
    deleteDependencyEdgesForTasks: async (taskIds) => {
      if (taskIds.length) await tx.delete(dependenciesTable).where(or(inArray(dependenciesTable.taskId, taskIds), inArray(dependenciesTable.dependsOn, taskIds)));
    },
    deleteProgressForTasks: async (taskIds) => {
      if (taskIds.length) await tx.delete(progressTable).where(inArray(progressTable.taskId, taskIds));
    },
    deleteMilestoneTaskLinks: async (milestoneIds, taskIds) => {
      const predicates = [
        ...(milestoneIds.length ? [inArray(milestoneTasksTable.milestoneId, milestoneIds)] : []),
        ...(taskIds.length ? [inArray(milestoneTasksTable.taskId, taskIds)] : []),
      ];
      if (predicates.length) await tx.delete(milestoneTasksTable).where(or(...predicates));
    },
    deletePlanVersionTaskLinks: async (planVersionIds, taskIds) => {
      const predicates = [
        ...(planVersionIds.length ? [inArray(planVersionTasksTable.planVersionId, planVersionIds)] : []),
        ...(taskIds.length ? [inArray(planVersionTasksTable.taskId, taskIds)] : []),
      ];
      if (predicates.length) await tx.delete(planVersionTasksTable).where(or(...predicates));
    },
    deleteMilestones: async (milestoneIds) => {
      if (milestoneIds.length) await tx.delete(milestonesTable).where(inArray(milestonesTable.id, milestoneIds));
    },
    deletePlanVersions: async (planVersionIds) => {
      if (planVersionIds.length) await tx.delete(planVersionsTable).where(inArray(planVersionsTable.id, planVersionIds));
    },
    deleteTasks: async (taskIds) => {
      if (taskIds.length) await tx.delete(tasksTable).where(inArray(tasksTable.id, taskIds));
    },
    deleteGoal: async (goalId) => (await tx.delete(goalsTable).where(eq(goalsTable.id, goalId)).returning({ id: goalsTable.id })).length > 0,
  })),
};

async function getTaskPlan(input: { goalName: string; goalType: string; deadline: string; dailyHours: number; priority: string; description: string; skills: string[] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  return generateGoalTasks(input, {
    apiKey,
    generate: apiKey ? createOpenAITaskSuggestionGenerator(apiKey) : undefined,
  });
}

router.post("/goals/task-plan-preview", async (req, res): Promise<void> => {
  const parsed = PreviewGoalTaskPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const plan = await getTaskPlan({ ...parsed.data, deadline: typeof parsed.data.deadline === "string" ? parsed.data.deadline : dateToString(parsed.data.deadline) });
    res.json(PreviewGoalTaskPlanResponse.parse(plan));
  } catch {
    res.status(500).json({ error: "Could not prepare task suggestions." });
  }
});

function scheduleStatus(result: ScheduleResult, tasks: { id: number; taskName: string; status: string }[]) {
  const pending = tasks.filter((task) => task.status === "pending");
  const unscheduled = pending.filter((task) => !result.scheduledDates.has(task.id));
  const unscheduledTaskNames = unscheduled.map((task) => task.taskName);
  const infeasibleById = new Map(result.infeasibleTasks.map((task) => [task.taskId, task]));
  const reasons = new Set(unscheduled.map((task) => infeasibleById.get(task.id)?.reason).filter(Boolean));
  const unclassified = unscheduled.some((task) => !infeasibleById.has(task.id));
  const details = [
    reasons.has("exceeds_daily_capacity") ? "some tasks exceed the daily study-hour limit" : null,
    reasons.has("deadline_capacity") ? "the remaining daily capacity is insufficient before the deadline" : null,
    reasons.has("dependency_unavailable") ? "some tasks depend on work that cannot be scheduled" : null,
    unclassified ? "some pending tasks were not assigned a date by the scheduler" : null,
  ].filter((reason): reason is string => Boolean(reason));
  return {
    isFeasible: unscheduledTaskNames.length === 0,
    unscheduledTaskNames,
    infeasibilityExplanation: details.length
      ? `The plan cannot fit all pending work by the deadline because ${details.join("; ")}. Reduce task durations, increase daily study time, or move the deadline.`
      : null,
  };
}

async function roadmapData(goalId: number, userId: number, scheduleResult?: ScheduleResult) {
  const goal = await getOwnedGoal(goalId, userId);
  if (!goal) return null;
  const tasks = await getGoalTasks(goalId);
  const dependencies = await getGoalDependencies(goalId);
  return {
    goal: goalSummary(goal, tasks),
    tasks: tasks
      .sort((left, right) =>
        String(left.scheduledDate ?? "").localeCompare(
          String(right.scheduledDate ?? ""),
        ),
      )
      .map((task) => taskView(task, tasks, dependencies)),
    ...scheduleStatus(scheduleResult ?? buildSchedule(tasks, dependencies, Number(goal.dailyHours), goal.deadline), tasks),
    generatedAt: new Date().toISOString(),
  };
}

function roadmapSnapshot(goal: typeof goalsTable.$inferSelect, tasks: Awaited<ReturnType<typeof getGoalTasks>>, dependencies: { taskId: number; dependsOn: number }[]) {
  return planFingerprint(goal, tasks, dependencies);
}

function smartTaskInput(tasks: Awaited<ReturnType<typeof getGoalTasks>>) {
  return tasks.map((task) => ({
    id: task.id,
    taskName: task.taskName,
    durationHours: task.durationHours,
    priority: task.priority,
    difficulty: task.difficulty,
    status: task.status,
    scheduledDate: task.scheduledDate,
    completionPercent: Number(task.completionPercent),
    completedAt: task.completedAt,
    topic: task.topic,
  }));
}

router.get("/goals", async (req, res): Promise<void> => {
  const goals = await db.select().from(goalsTable).where(eq(goalsTable.userId, req.auth!.id)).orderBy(asc(goalsTable.id));
  const summaries = await Promise.all(
    goals.map(async (goal) => goalSummary(goal, await getGoalTasks(goal.id))),
  );
  res.json(ListGoalsResponse.parse(summaries));
});

router.delete("/goals/:goalId", async (req, res): Promise<void> => {
  const params = GetRoadmapParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (!(await getOwnedGoal(params.data.goalId, req.auth!.id))) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  try {
    const deleted = await deleteGoalRecords(goalDeletionDatabase, params.data.goalId, req.auth!.id);
    if (!deleted) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    res.status(204).end();
  } catch (error) {
    logger.error({ operation: "delete_goal", errorCode: "UNKNOWN" }, "Goal deletion failed");
    res.status(500).json({ error: "Failed to delete goal. Please try again." });
  }
});

router.post("/goals", requireConfirmedTaskPlan, async (req, res): Promise<void> => {
  const parsed = CreateGoalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const confirmedTasks = res.locals.confirmedTasks as GeneratedTask[];
    const taskPlan = { tasks: confirmedTasks, status: "user_confirmed" as const, message: "Task topics were reviewed and confirmed before saving." };
    const [goal] = await db
      .insert(goalsTable)
      .values({
        userId: req.auth!.id,
        goalName: parsed.data.goalName,
        goalType: parsed.data.goalType,
        deadline:
          typeof parsed.data.deadline === "string"
            ? parsed.data.deadline
            : dateToString(parsed.data.deadline),
      dailyHours: parsed.data.dailyHours,
      priority: parsed.data.priority,
      description: parsed.data.description,
      skills: parsed.data.skills,
    })
    .returning();

    const insertedTaskIds: number[] = [];
    for (const task of taskPlan.tasks) {
      const [insertedTask] = await db
        .insert(tasksTable)
        .values({
          goalId: goal.id,
          taskName: task.taskName,
          topic: task.topic,
          durationHours: task.durationHours,
          priority: task.priority,
          difficulty: task.difficulty,
          status: "pending",
          completionPercent: 0,
        })
        .returning();
      insertedTaskIds.push(insertedTask!.id);
    }
    const taskDependencies = taskPlan.tasks.flatMap((task, taskIndex) =>
      task.dependsOn.map((dependencyIndex) => ({
        taskId: insertedTaskIds[taskIndex]!,
        dependsOn: insertedTaskIds[dependencyIndex]!,
      })),
    );
    if (taskDependencies.length > 0) {
      await db.insert(dependenciesTable).values(taskDependencies);
    }
    await scheduleGoal(goal.id);

    const created = await getGoal(goal.id);
    const tasks = await getGoalTasks(goal.id);
    res.status(201).json(
      CreateGoalResponse.parse({
        ...goalSummary(created!, tasks),
        taskGenerationStatus: taskPlan.status,
        taskGenerationMessage: taskPlan.message,
      }),
    );
  } catch (error) {
    logger.error({ operation: "create_goal", errorCode: "UNKNOWN" }, "Goal creation failed");
    res.status(500).json({ error: "Failed to create goal. Please try again." });
  }
});

router.post("/goals/:goalId/generate-roadmap", async (req, res): Promise<void> => {
  const params = GenerateRoadmapParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await getOwnedGoal(params.data.goalId, req.auth!.id))) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  try {
    const scheduleResult = await scheduleGoal(params.data.goalId);
     const roadmap = await roadmapData(params.data.goalId, req.auth!.id, scheduleResult);
    res.json(GenerateRoadmapResponse.parse(roadmap));
  } catch (error) {
    logger.error({ operation: "generate_roadmap", errorCode: "UNKNOWN" }, "Roadmap generation failed");
    res.status(500).json({ error: "Failed to generate roadmap. Please try again." });
  }
});

router.get("/goals/:goalId/roadmap", async (req, res): Promise<void> => {
  const params = GetRoadmapParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await getOwnedGoal(params.data.goalId, req.auth!.id))) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
   const roadmap = await roadmapData(params.data.goalId, req.auth!.id);
  res.json(GetRoadmapResponse.parse(roadmap));
});

router.get("/goals/:goalId/smart-roadmap", async (req, res): Promise<void> => {
  const params = GetRoadmapParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  try {
    const tasks = await getGoalTasks(goal.id);
    const dependencies = await getGoalDependencies(goal.id);
    const smart = buildSmartRoadmap(smartTaskInput(tasks), dependencies, { dailyHours: Number(goal.dailyHours), deadline: goal.deadline });
    const taskStates = new Map(smart.taskStates.map((item) => [item.task.id, item]));
    res.json({
      goal: goalSummary(goal, tasks),
      risk: smart.risk,
      nextTask: smart.next ? { task: taskView(tasks.find((task) => task.id === smart.next!.task.id)!, tasks, dependencies), score: smart.next.score, explanation: smart.next.explanation } : null,
      tasks: tasks.map((task) => ({ ...taskView(task, tasks, dependencies), roadmapState: taskStates.get(task.id)!.state, blockedBy: taskStates.get(task.id)!.blockedBy, unlockCount: taskStates.get(task.id)!.unlockCount, smartExplanation: taskStates.get(task.id)!.explanation })),
      stages: smart.stages,
      dependencyEdges: smart.dependencyEdges,
      assumptions: ["Risk uses current task durations, daily goal capacity, UTC calendar days, and existing dependency edges.", "Recommendations never mark tasks complete, alter goals, or apply a replan."],
      planFingerprint: roadmapSnapshot(goal, tasks, dependencies),
    });
  } catch (error) {
    logger.error({ operation: "smart_roadmap", errorCode: error instanceof Error && error.message === "STALE_PLAN_PREVIEW" ? "STALE_PLAN_PREVIEW" : "UNKNOWN" }, "Smart roadmap failed");
    res.status(500).json({ error: "Could not prepare the smart roadmap." });
  }
});

router.post("/goals/:goalId/preview-alternatives", async (req, res): Promise<void> => {
  const params = GetRoadmapParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  try {
    const tasks = await getGoalTasks(goal.id);
    const dependencies = await getGoalDependencies(goal.id);
    const preview = previewAlternativePlans(
      { dailyHours: Number(goal.dailyHours), deadline: goal.deadline },
      tasks,
      dependencies,
      buildSchedule,
      new Date(),
    );
    res.json({
      ...PreviewAlternativePlansResponse.parse(preview),
      previewToken: roadmapSnapshot(goal, tasks, dependencies),
      assumptions: ["The current daily target and deadline are the baseline.", "The capacity option adds at least 1 hour/day and can rise to fit the longest individual pending task, capped at 8 hours/day. Tasks are not split across days.", "The deadline option extends the deadline by exactly 14 days.", "Previews do not change the saved goal, tasks, dependencies, or history."],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid saved planning data.";
    res.status(422).json({ error: message });
  }
});

router.post("/goals/:goalId/apply-alternative", async (req, res): Promise<void> => {
  const params = GetRoadmapParams.safeParse(req.params);
  const scenario = req.body?.scenario;
  const previewToken = req.body?.previewToken;
  if (!params.success || !["current", "more_daily_time", "extended_deadline"].includes(scenario) || typeof previewToken !== "string") {
    res.status(400).json({ error: "Choose a valid alternative and refresh its preview before applying it." }); return;
  }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  const tasks = await getGoalTasks(goal.id);
  const dependencies = await getGoalDependencies(goal.id);
  if (roadmapSnapshot(goal, tasks, dependencies) !== previewToken) { res.status(409).json({ error: "This plan preview is stale. Refresh the alternatives before applying one." }); return; }
  const goalPatch = scenario === "more_daily_time"
    ? { dailyHours: increasedDailyCapacity(Number(goal.dailyHours), tasks) }
    : scenario === "extended_deadline"
      ? { deadline: dateToString(new Date(parseDate(goal.deadline).getTime() + 14 * 86_400_000)) }
      : undefined;
  try {
    const scheduleResult = await scheduleGoal(goal.id, new Date(), { goalPatch, expectedPlanFingerprint: previewToken });
    const next = await roadmapData(goal.id, req.auth!.id, scheduleResult);
    res.json(GenerateRoadmapResponse.parse(next));
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_PLAN_PREVIEW") { res.status(409).json({ error: "This plan preview is stale. Refresh the alternatives before applying one." }); return; }
    logger.error({ operation: "apply_alternative", errorCode: "UNKNOWN" }, "Alternative plan application failed");
    res.status(500).json({ error: "Could not apply that plan alternative. No partial schedule change was saved." });
  }
});

router.post("/goals/:goalId/replan-preview", async (req, res): Promise<void> => {
  const params = ReplanGoalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  try {
    const beforeTasks = await getGoalTasks(goal.id);
    const dependencies = await getGoalDependencies(goal.id);
    const recovery = recoverMissedTasks(beforeTasks);
    const scheduleResult = buildSchedule(recovery.tasks, dependencies, Number(goal.dailyHours), goal.deadline, new Date());
    const changes = compareReplan(beforeTasks, scheduleResult);
    const status = scheduleStatus(scheduleResult, recovery.tasks);
    const previewTasks = recovery.tasks.map((task) => ({ ...task, scheduledDate: scheduleResult.scheduledDates.get(task.id) ?? null }));
    const risk = buildSmartRoadmap(smartTaskInput(beforeTasks), dependencies, { dailyHours: Number(goal.dailyHours), deadline: goal.deadline }).risk;
    res.json({
      previewToken: roadmapSnapshot(goal, beforeTasks, dependencies),
      goal: goalSummary(goal, beforeTasks),
      currentTasks: beforeTasks.map((task) => taskView(task, beforeTasks, dependencies)),
      proposedTasks: previewTasks.map((task) => taskView(task, previewTasks, dependencies)),
      changes,
      isFeasible: status.isFeasible,
      unscheduledTaskNames: status.unscheduledTaskNames,
      explanation: explainReplan(changes, status.infeasibilityExplanation),
      risk,
      assumptions: ["Missed tasks return to pending for this preview only.", "Completed tasks, task IDs, dependencies, deadline, and daily target remain unchanged.", "Applying requires this exact preview token; any intervening edit requires a fresh preview."],
    });
  } catch (error) {
    logger.error({ operation: "replan_preview", errorCode: "UNKNOWN" }, "Replan preview failed");
    res.status(500).json({ error: "Could not prepare a replan preview." });
  }
});

router.post("/goals/:goalId/replan", async (req, res): Promise<void> => {
  const params = ReplanGoalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  const previewToken = req.body?.previewToken;
  if (typeof previewToken !== "string") {
    res.status(400).json({ error: "Preview the revised route before applying it." });
    return;
  }

  try {
    const beforeTasks = await getGoalTasks(goal.id);
    const beforeDependencies = await getGoalDependencies(goal.id);
    const recovery = recoverMissedTasks(beforeTasks);
    const missedTaskNames = recovery.recoveredTaskNames;
    const previousTasks = beforeTasks.map((task) =>
      taskView(task, beforeTasks, beforeDependencies),
    );

    // Fix: Start replanning from today instead of tomorrow
     const scheduleResult = await scheduleGoal(goal.id, new Date(), { recoverMissed: true, expectedPlanFingerprint: previewToken });

    const changes = compareReplan(beforeTasks, scheduleResult);
    const changedTaskNames = changes
      .filter((item) => item.change !== "unchanged")
      .map((item) => item.taskName);

     const roadmap = roadmapData(goal.id, req.auth!.id, scheduleResult);
    const next = await roadmap;
    const status = scheduleStatus(scheduleResult, recovery.tasks);
    const infeasibility = status.infeasibilityExplanation;
    const unscheduledNames = status.unscheduledTaskNames;
    const explanation = explainReplan(
      changes,
      infeasibility ? `${infeasibility} Unscheduled: ${unscheduledNames.join(", ")}.` : null,
    );

    res.json(
      ReplanGoalResponse.parse({
        ...next,
        changedTaskNames,
        missedTaskName: missedTaskNames.join(", ") || "No task",
        explanation,
        previousTasks,
        changes,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_PLAN_PREVIEW") { res.status(409).json({ error: "This replan preview is stale. Review a fresh preview before applying it." }); return; }
    logger.error({ operation: "replan_apply", errorCode: "UNKNOWN" }, "Replan application failed");
    res.status(500).json({ error: "Failed to replan. Please try again." });
  }
});

router.get("/goals/:goalId/progress", async (req, res): Promise<void> => {
  const params = GetGoalProgressParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  const tasks = await getGoalTasks(goal.id);
  const completedTasks = tasks.filter((task) => task.status === "completed");
  res.json(
    GetGoalProgressResponse.parse({
      overallProgress: goalSummary(goal, tasks).overallProgress,
      completed: completedTasks.length,
      pending: tasks.filter((task) => task.status === "pending").length,
      missed: tasks.filter((task) => task.status === "missed").length,
      totalHours: tasks.reduce((sum, task) => sum + Number(task.durationHours), 0),
      completedHours: completedTasks.reduce(
        (sum, task) => sum + Number(task.durationHours),
        0,
      ),
    }),
  );
});

router.get("/goals/:goalId/progress-dashboard", async (req, res): Promise<void> => {
  const params = GetGoalProgressParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  const tasks = await getGoalTasks(goal.id);
  const taskIds = tasks.map((task) => task.id);
  const taskProgress = tasks.map((task) => ({ ...task, topic: task.topic || "Uncategorized" }));
  const events = taskIds.length ? await db.select().from(progressTable).where(and(inArray(progressTable.taskId, taskIds), eq(progressTable.userId, goal.userId))) : [];
  const versions = await db.select().from(planVersionsTable).where(eq(planVersionsTable.goalId, goal.id)).orderBy(asc(planVersionsTable.version));
  const versionIds = versions.map((version) => version.id);
  const versionRows = versionIds.length ? await db.select().from(planVersionTasksTable).where(inArray(planVersionTasksTable.planVersionId, versionIds)) : [];
  const snapshots = versions.map((version) => ({
    id: version.id,
    version: version.version,
    createdAt: version.createdAt,
    taskDates: versionRows.filter((row) => row.planVersionId === version.id).map((row) => ({
      taskId: row.taskId,
      scheduledDate: row.scheduledDate,
      taskName: row.taskName,
      topic: row.topic,
      durationHours: row.durationHours,
    })),
  }));
  const savedMilestones = await db.select().from(milestonesTable).where(eq(milestonesTable.goalId, goal.id));
  const milestoneIds = savedMilestones.map((milestone) => milestone.id);
  const milestoneLinks = milestoneIds.length ? await db.select().from(milestoneTasksTable).where(inArray(milestoneTasksTable.milestoneId, milestoneIds)) : [];
  const milestones: { key: string; id: number | null; title: string; targetDate: string | null; taskIds: number[]; confirmed: boolean; completed: boolean; completedTaskCount: number; taskCount: number }[] = savedMilestones.map((milestone) => {
    const associated = milestoneLinks.filter((link) => link.milestoneId === milestone.id).map((link) => link.taskId);
    return {
      key: `saved:${milestone.id}`,
      id: milestone.id,
      title: milestone.title,
      targetDate: milestone.targetDate,
      taskIds: associated,
      ...confirmedMilestoneState(associated, taskProgress, true),
    };
  });
  const confirmedTaskSets = new Set(milestones.map((milestone) => [...milestone.taskIds].sort((a, b) => a - b).join(",")));
  for (const suggestion of suggestMilestones(taskProgress)) {
    if (confirmedTaskSets.has([...suggestion.taskIds].sort((a, b) => a - b).join(","))) continue;
    milestones.push({ key: suggestion.key, id: null, title: suggestion.title, targetDate: suggestion.targetDate, taskIds: suggestion.taskIds, confirmed: false, completed: false, completedTaskCount: 0, taskCount: suggestion.taskIds.length });
  }
  res.json(GetProgressDashboardResponse.parse({
    timeZone: "UTC",
    weekStartsOn: "Monday",
    weeks: weeklyProgress(events, snapshots).weeks,
    topics: topicProgress(taskProgress),
    milestones,
    timeline: plannedCompletedTimeline(snapshots, taskProgress, events),
    historyStartsAt: snapshots.length ? new Date(snapshots[0]!.createdAt).toISOString() : null,
  }));
});

router.post("/goals/:goalId/milestones", async (req, res): Promise<void> => {
  const params = GetGoalProgressParams.safeParse(req.params);
  const body = ConfirmMilestoneBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  const targetDate = body.data.targetDate === null ? null : typeof body.data.targetDate === "string" ? body.data.targetDate : dateToString(body.data.targetDate);
  if (targetDate !== null && !isIsoDate(targetDate)) { res.status(400).json({ error: "Milestone date must be a valid ISO calendar date." }); return; }
  const tasks = await getGoalTasks(goal.id);
  if (!milestoneTaskIdsBelongToGoal(body.data.taskIds, tasks.map((task) => task.id))) { res.status(400).json({ error: "Milestones require unique tasks from this goal." }); return; }
  if (!body.data.title.trim() || body.data.title.trim().length > 100) { res.status(400).json({ error: "Milestone title must contain 1 to 100 characters." }); return; }
  const milestone = await db.transaction(async (tx) => {
    const [created] = await tx.insert(milestonesTable).values({ goalId: goal.id, title: body.data.title.trim(), targetDate }).returning();
    await tx.insert(milestoneTasksTable).values(body.data.taskIds.map((taskId) => ({ milestoneId: created!.id, taskId })));
    return created!;
  });
  res.status(201).json(ConfirmMilestoneResponse.parse({
    id: milestone.id,
    title: milestone.title,
    targetDate: milestone.targetDate,
    taskIds: body.data.taskIds,
    ...confirmedMilestoneState(body.data.taskIds, tasks, true),
    completionRule: "Complete when every associated task has status completed.",
  }));
});

router.get("/goals/:goalId/recommendations", async (req, res): Promise<void> => {
  const params = GetGoalRecommendationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const goal = await getOwnedGoal(params.data.goalId, req.auth!.id);
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  const tasks = await getGoalTasks(goal.id);
  const dependencies = await getGoalDependencies(goal.id);
  const recommendations = prioritizeTasks(smartTaskInput(tasks), dependencies, { dailyHours: Number(goal.dailyHours), deadline: goal.deadline })
    .filter((item) => item.state !== "blocked" && item.state !== "completed")
    .map((item) => ({ task: taskView(tasks.find((task) => task.id === item.task.id)!, tasks, dependencies), reason: item.explanation, score: Math.max(0, Math.round(item.score)) }))
    .slice(0, 4);
  res.json(GetGoalRecommendationsResponse.parse(recommendations));
});

router.post("/tasks/:taskId/complete", async (req, res): Promise<void> => {
  const params = CompleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const completedDate = utcCalendarDate(new Date());
    const result = await transitionTaskStatus(lifecycleDatabase, params.data.taskId, "completed", completedDate, req.auth!.id);
    if (result.kind !== "ok") {
      res.status(result.kind === "not_found" ? 404 : 409).json({ error: result.kind === "not_found" ? "Task not found" : "Task cannot transition to completed from its current state." });
      return;
    }
    const tasks = await getGoalTasks(result.task.goalId);
    const dependencies = await getGoalDependencies(result.task.goalId);
    res.json(CompleteTaskResponse.parse(taskView(tasks.find((task) => task.id === result.task.id)!, tasks, dependencies)));
  } catch {
    res.status(500).json({ error: "Failed to complete task. No partial progress update was saved." });
  }
});

router.post("/tasks/:taskId/miss", async (req, res): Promise<void> => {
  const params = MissTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const missedDate = dateToString(new Date());
    const result = await transitionTaskStatus(lifecycleDatabase, params.data.taskId, "missed", missedDate, req.auth!.id);
    if (result.kind !== "ok") {
      res.status(result.kind === "not_found" ? 404 : 409).json({ error: result.kind === "not_found" ? "Task not found" : "Task cannot transition to missed from its current state." });
      return;
    }
    const tasks = await getGoalTasks(result.task.goalId);
    const dependencies = await getGoalDependencies(result.task.goalId);
    res.json(MissTaskResponse.parse(taskView(tasks.find((task) => task.id === result.task.id)!, tasks, dependencies)));
  } catch {
    res.status(500).json({ error: "Failed to mark task missed. No partial progress update was saved." });
  }
});

export default router;
