import { eq } from "drizzle-orm";
import {
  db,
  dependenciesTable,
  goalsTable,
  tasksTable,
  usersTable,
  type InsertTask,
} from "@workspace/db";
import { scheduleGoal } from "./planner";

const demoTasks: Omit<InsertTask, "goalId">[] = [
  {
    taskName: "Python foundations",
    durationHours: 4,
    priority: "high",
    difficulty: "medium",
    status: "pending",
    completionPercent: 0,
  },
  {
    taskName: "DSA problem solving",
    durationHours: 4,
    priority: "high",
    difficulty: "hard",
    status: "pending",
    completionPercent: 0,
  },
  {
    taskName: "SQL querying",
    durationHours: 3,
    priority: "high",
    difficulty: "medium",
    status: "pending",
    completionPercent: 0,
  },
  {
    taskName: "Aptitude practice",
    durationHours: 2,
    priority: "medium",
    difficulty: "medium",
    status: "pending",
    completionPercent: 0,
  },
  {
    taskName: "Power BI case study",
    durationHours: 3,
    priority: "medium",
    difficulty: "medium",
    status: "pending",
    completionPercent: 0,
  },
  {
    taskName: "Resume preparation",
    durationHours: 2,
    priority: "high",
    difficulty: "easy",
    status: "pending",
    completionPercent: 0,
  },
  {
    taskName: "Mock interview",
    durationHours: 2,
    priority: "high",
    difficulty: "hard",
    status: "pending",
    completionPercent: 0,
  },
];

export async function ensureDemoData(): Promise<void> {
  const existing = await db
    .select({ id: goalsTable.id })
    .from(goalsTable)
    .where(eq(goalsTable.goalName, "Placement Preparation"));
  if (existing.length > 0) return;

  const [user] = await db
    .insert(usersTable)
    .values({
      name: "Aarav Mehta",
      availableHours: 4,
      preferredStart: "18:00",
      preferredEnd: "22:00",
    })
    .returning();

  const [goal] = await db
    .insert(goalsTable)
    .values({
      userId: user.id,
      goalName: "Placement Preparation",
      goalType: "Career readiness",
      deadline: "2026-10-30",
      dailyHours: 4,
      priority: "high",
      description:
        "Build confidence across the skills and practice needed for placement season.",
      skills: ["Python", "DSA", "SQL"],
    })
    .returning();

  const insertedTasks = await db
    .insert(tasksTable)
    .values(demoTasks.map((task) => ({ ...task, goalId: goal.id })))
    .returning();
  const byName = new Map(insertedTasks.map((task) => [task.taskName, task.id]));

  await db.insert(dependenciesTable).values([
    { taskId: byName.get("DSA problem solving")!, dependsOn: byName.get("Python foundations")! },
    { taskId: byName.get("Mock interview")!, dependsOn: byName.get("Resume preparation")! },
    { taskId: byName.get("Mock interview")!, dependsOn: byName.get("DSA problem solving")! },
  ]);

  await scheduleGoal(goal.id);
}
