import assert from "node:assert/strict";
import express from "express";
import { requireConfirmedTaskPlan } from "./task-confirmation.ts";

const app = express();
app.use(express.json());
app.post("/goals", requireConfirmedTaskPlan, (_req, res) => res.status(201).json({ tasks: res.locals.confirmedTasks }));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/goals`;
const base = { goalName: "Exam", goalType: "Study", deadline: "2026-12-01", dailyHours: 2, priority: "high", description: "Prepare", skills: ["Algebra"] };

try {
  const missing = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(base) });
  assert.equal(missing.status, 400, "omitting confirmedTasks is rejected before persistence");

  const invalidTask = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, confirmedTasks: [{ taskName: "Do", topic: "Other", durationHours: 1, priority: "high", difficulty: "easy", dependsOn: [] }] }) });
  assert.equal(invalidTask.status, 400, "topics must match the goal's declared skills");

  const invalidDependency = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, confirmedTasks: [{ taskName: "Review", topic: "Algebra", durationHours: 1, priority: "high", difficulty: "easy", dependsOn: [1] }] }) });
  assert.equal(invalidDependency.status, 400, "dependency indexes must refer to a different task in the submitted plan");

  const overCapacity = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, dailyHours: 24.5, confirmedTasks: [{ taskName: "Review algebra", topic: "Algebra", durationHours: 1, priority: "high", difficulty: "easy", dependsOn: [] }] }) });
  assert.equal(overCapacity.status, 400, "goal capacity agrees with scheduler limits");

  const valid = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, confirmedTasks: [{ taskName: "Review algebra", topic: "Algebra", durationHours: 1, priority: "high", difficulty: "easy", dependsOn: [] }] }) });
  assert.equal(valid.status, 201, "a valid, explicitly confirmed plan passes the API gate");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log("Passed 5 Express task-confirmation route cases; database persistence was not involved.");
