import assert from "node:assert/strict";
import { generateGoalTasks, validateConfirmedTaskPlan, type GoalTaskGenerationInput } from "./task-generation.ts";

const input: GoalTaskGenerationInput = {
  goalName: "Prepare for an exam",
  goalType: "Exam preparation",
  deadline: "2026-12-01",
  dailyHours: 2,
  priority: "high",
  description: "Build understanding and practice under time pressure.",
  skills: ["Algebra", "Practice"],
};

const validOutput = {
  tasks: [
    { taskName: "Review linear equations", topic: "Algebra", durationHours: 1.5, priority: "high", difficulty: "medium", dependsOn: [] },
    { taskName: "Timed mixed questions", topic: "Practice", durationHours: 1, priority: "medium", difficulty: "hard", dependsOn: [0] },
  ],
};

{
  const result = await generateGoalTasks(input, {
    apiKey: "test-only",
    generate: async () => validOutput,
  });
  assert.equal(result.status, "ai_generated");
  assert.equal(result.tasks[1]?.dependsOn[0], 0);
  assert.equal(result.tasks[1]?.topic, "Practice");
  assert.match(result.tasks[0]?.taskName ?? "", /^Algebra:/);
}

{
  const result = await generateGoalTasks(input, {
    apiKey: "test-only",
    generate: async () => ({ tasks: [{ ...validOutput.tasks[0], durationHours: -2 }] }),
  });
  assert.equal(result.status, "fallback_invalid_output");
  assert.deepEqual(result.tasks, [
    { taskName: "Algebra foundations", topic: "Algebra", durationHours: 2, priority: "high", difficulty: "hard", dependsOn: [] },
    { taskName: "Practice", topic: "Practice", durationHours: 3, priority: "medium", difficulty: "medium", dependsOn: [] },
  ]);
}

{
  const suggestions = validOutput.tasks.map((task) => ({ ...task }));
  assert.equal(validateConfirmedTaskPlan(suggestions, input.skills)?.[0]?.topic, "Algebra");
  assert.equal(validateConfirmedTaskPlan([{ ...suggestions[0]!, topic: "Unlisted" }], input.skills), null);
  assert.equal(validateConfirmedTaskPlan([
    { ...suggestions[0]!, dependsOn: [1] },
    { ...suggestions[1]!, dependsOn: [0] },
  ], input.skills), null);
}

{
  let providerCalled = false;
  const result = await generateGoalTasks(input, {
    generate: async () => { providerCalled = true; return validOutput; },
  });
  assert.equal(result.status, "fallback_missing_credentials");
  assert.equal(result.tasks.length, 2);
  assert.equal(providerCalled, false);
}

{
  const noTopics = { ...input, skills: [] };
  const result = await generateGoalTasks(noTopics, { apiKey: "test-only", generate: async () => ({ tasks: [] }) });
  assert.equal(result.status, "fallback_invalid_output");
  assert.ok(result.tasks.every((task) => task.topic === "Uncategorized"));
}

{
  const result = await generateGoalTasks(input, {
    apiKey: "test-only",
    generate: async () => { throw new Error("provider detail must not escape"); },
  });
  assert.equal(result.status, "fallback_provider_error");
  assert.equal(result.message.includes("provider detail"), false);
}

{
  const result = await generateGoalTasks(input, {
    apiKey: "test-only",
    generate: async () => ({
      tasks: [
        { ...validOutput.tasks[0], dependsOn: [1] },
        { ...validOutput.tasks[1], dependsOn: [0] },
      ],
    }),
  });
  assert.equal(result.status, "fallback_invalid_output");
}

{
  const result = await generateGoalTasks(input, {
    apiKey: "test-only",
    generate: async () => ({
      tasks: [{ ...validOutput.tasks[0], topic: "Unrequested topic", dependsOn: [3] }],
    }),
  });
  assert.equal(result.status, "fallback_invalid_output");
}

console.log("Passed 7 AI task-generation, topic validation, and deterministic fallback cases.");
