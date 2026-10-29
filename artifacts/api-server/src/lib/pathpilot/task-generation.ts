type AiTaskSuggestion = {
  taskName: string;
  topic: string;
  durationHours: number;
  priority: "high" | "medium" | "low";
  difficulty: "easy" | "medium" | "hard";
  dependsOn: number[];
};

export type GoalTaskGenerationInput = {
  goalName: string;
  goalType: string;
  deadline: string;
  dailyHours: number;
  priority: string;
  description: string;
  skills: string[];
};

export type GeneratedTask = {
  taskName: string;
  topic: string;
  durationHours: number;
  priority: "high" | "medium" | "low";
  difficulty: "easy" | "medium" | "hard";
  dependsOn: number[];
};

export type TaskGenerationStatus =
  | "ai_generated"
  | "fallback_missing_credentials"
  | "fallback_provider_error"
  | "fallback_invalid_output";

export type TaskGenerationResult = {
  tasks: GeneratedTask[];
  status: TaskGenerationStatus;
  message: string;
};

export type TaskSuggestionGenerator = (
  input: GoalTaskGenerationInput,
) => Promise<unknown>;

export function deterministicGoalTasks(input: GoalTaskGenerationInput): GeneratedTask[] {
  const skills = input.skills.length > 0 ? input.skills : ["First milestone"];
  return skills.map((skill, index) => ({
    taskName: skill.toLowerCase().includes("practice") ? skill : `${skill} foundations`,
    topic: input.skills[index] ?? "Uncategorized",
    durationHours: Math.min(4, Math.max(1, 2 + (index % 3))),
    priority: index === 0 ? "high" : "medium",
    difficulty: index === 0 ? "hard" : "medium",
    dependsOn: [],
  }));
}

function parseTaskSuggestions(output: unknown): AiTaskSuggestion[] | null {
  if (!output || typeof output !== "object" || !Array.isArray((output as { tasks?: unknown }).tasks)) return null;
  const source = (output as { tasks: unknown[] }).tasks;
  if (source.length === 0 || source.length > 20) return null;
  const priorities = new Set(["high", "medium", "low"]);
  const difficulties = new Set(["easy", "medium", "hard"]);
  const tasks: AiTaskSuggestion[] = [];

  for (const value of source) {
    if (!value || typeof value !== "object") return null;
    const task = value as Record<string, unknown>;
    if (
      typeof task.taskName !== "string" || task.taskName.trim().length < 3 || task.taskName.trim().length > 100 ||
      typeof task.topic !== "string" || task.topic.trim().length < 1 || task.topic.trim().length > 80 ||
      typeof task.durationHours !== "number" || task.durationHours < 0.5 || task.durationHours > 100 ||
      typeof task.priority !== "string" || !priorities.has(task.priority) ||
      typeof task.difficulty !== "string" || !difficulties.has(task.difficulty) ||
      !Array.isArray(task.dependsOn) || task.dependsOn.length > 20 ||
      task.dependsOn.some((index) => !Number.isInteger(index) || Number(index) < 0)
    ) {
      return null;
    }
    tasks.push({
      taskName: task.taskName.trim(),
      topic: task.topic.trim(),
      durationHours: task.durationHours,
      priority: task.priority as AiTaskSuggestion["priority"],
      difficulty: task.difficulty as AiTaskSuggestion["difficulty"],
      dependsOn: task.dependsOn as number[],
    });
  }
  return tasks;
}

function hasValidDependencies(tasks: AiTaskSuggestion[]): boolean {
  const names = new Set<string>();
  const dependencies: number[][] = [];

  for (const [index, task] of tasks.entries()) {
    const normalizedName = task.taskName.toLocaleLowerCase();
    if (names.has(normalizedName)) return false;
    names.add(normalizedName);

    const uniqueDependencies = new Set(task.dependsOn);
    if (
      uniqueDependencies.size !== task.dependsOn.length ||
      task.dependsOn.some((dependency) => dependency >= tasks.length || dependency === index)
    ) {
      return false;
    }
    dependencies.push(task.dependsOn);
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number): boolean => {
    if (visiting.has(index)) return false;
    if (visited.has(index)) return true;
    visiting.add(index);
    for (const dependency of dependencies[index] ?? []) {
      if (!visit(dependency)) return false;
    }
    visiting.delete(index);
    visited.add(index);
    return true;
  };

  return tasks.every((_task, index) => visit(index));
}

export function validateConfirmedTaskPlan(rawTasks: unknown, skills: string[]): GeneratedTask[] | null {
  const parsed = parseTaskSuggestions({ tasks: rawTasks });
  const allowed = skills.length ? skills.slice(0, 20).map((skill) => skill.slice(0, 80)) : ["Uncategorized"];
  if (!parsed || parsed.some((task) => !allowed.includes(task.topic)) || !hasValidDependencies(parsed)) return null;
  return parsed;
}

function fallback(
  input: GoalTaskGenerationInput,
  status: Exclude<TaskGenerationStatus, "ai_generated">,
): TaskGenerationResult {
  const messages: Record<typeof status, string> = {
    fallback_missing_credentials:
      "AI task suggestions are unavailable because OPENAI_API_KEY is not configured. Built-in task suggestions were used.",
    fallback_provider_error:
      "AI task suggestions are temporarily unavailable. Built-in task suggestions were used.",
    fallback_invalid_output:
      "AI task suggestions did not pass validation. Built-in task suggestions were used.",
  };
  return { tasks: deterministicGoalTasks(input), status, message: messages[status] };
}

export async function generateGoalTasks(
  input: GoalTaskGenerationInput,
  options: { apiKey?: string; generate?: TaskSuggestionGenerator },
): Promise<TaskGenerationResult> {
  if (!options.apiKey || !options.generate) {
    return fallback(input, "fallback_missing_credentials");
  }

  try {
    const output = await options.generate(input);
    const tasks = parseTaskSuggestions(output);
    const allowedTopics =
      input.skills.length > 0
        ? input.skills.slice(0, 20).map((skill) => skill.slice(0, 80))
        : ["Uncategorized"];
    if (
      !tasks ||
      !hasValidDependencies(tasks) ||
      tasks.some((task) => !allowedTopics.includes(task.topic))
    ) {
      return fallback(input, "fallback_invalid_output");
    }

    return {
      status: "ai_generated",
      message: "AI-assisted task suggestions were generated and validated.",
      tasks: tasks.map((task) => ({
        taskName: `${task.topic}: ${task.taskName}`,
        topic: task.topic,
        durationHours: task.durationHours,
        priority: task.priority,
        difficulty: task.difficulty,
        dependsOn: task.dependsOn,
      })),
    };
  } catch {
    return fallback(input, "fallback_provider_error");
  }
}
