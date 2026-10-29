import { z } from "zod";

export const AiTaskPlanSchema = z.object({
  tasks: z
    .array(
      z.object({
        taskName: z.string().min(3).max(100),
        topic: z.string().min(1).max(80),
        durationHours: z.number().min(0.5).max(100),
        priority: z.enum(["high", "medium", "low"]),
        difficulty: z.enum(["easy", "medium", "hard"]),
        dependsOn: z.array(z.number().int().min(0)).max(20),
      }),
    )
    .min(1)
    .max(20),
});

export type AiTaskPlan = z.infer<typeof AiTaskPlanSchema>;
