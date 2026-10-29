import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { AiTaskPlanSchema } from "@workspace/api-zod";
import type { GoalTaskGenerationInput } from "./task-generation";

export function createOpenAITaskSuggestionGenerator(apiKey: string) {
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 15_000,
  });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  return async (goal: GoalTaskGenerationInput): Promise<unknown> => {
    const boundedGoal = {
      ...goal,
      goalName: goal.goalName.slice(0, 160),
      goalType: goal.goalType.slice(0, 80),
      description: goal.description.slice(0, 2_000),
      skills: goal.skills.slice(0, 20).map((skill) => skill.slice(0, 80)),
    };
    const topics = boundedGoal.skills.length > 0 ? boundedGoal.skills : ["Uncategorized"];
    const response = await client.responses.parse({
      model,
      max_output_tokens: 3_000,
      input: [
        {
          role: "system",
          content:
            "Create a concise, personalized study task plan that reflects the goal priority and constraints. Return tasks only. Use only the supplied topics, keep durations realistic, and express prerequisites as zero-based indexes into the returned task list. Do not assign dates or claim that the goal is feasible.",
        },
        {
          role: "user",
          content: JSON.stringify({ ...boundedGoal, allowedTopics: topics }),
        },
      ],
      text: { format: zodTextFormat(AiTaskPlanSchema, "pathpilot_task_plan") },
    });

    if (!response.output_parsed) throw new Error("Structured task output was unavailable.");
    return response.output_parsed;
  };
}
