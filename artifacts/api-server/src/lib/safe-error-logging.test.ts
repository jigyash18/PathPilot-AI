import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorDiagnostics } from "./safe-error-logging.ts";

test("extracts SQLSTATE and schema identifiers from wrapped database errors only", () => {
  const pgError = Object.assign(new Error("column pathpilot_users.email does not exist; params: secret"), {
    code: "42703",
    severity: "ERROR",
    schema: "public",
    table: "pathpilot_users",
    column: "email",
    detail: "sensitive detail must not be logged",
  });
  const wrapped = Object.assign(new Error("Failed query: SELECT secret"), { cause: pgError });

  const result = safeErrorDiagnostics(wrapped);
  assert.deepEqual(result.causes, [
    { name: "Error" },
    { name: "Error", sqlState: "42703", severity: "ERROR", schema: "public", table: "pathpilot_users", column: "email" },
  ]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("SELECT"), false);
});

test("does not expose arbitrary codes or non-identifier database fields", () => {
  const error = Object.assign(new Error("private message"), {
    code: "private-token-value",
    table: "users; DROP TABLE users",
    constraint: "pathpilot_users_email_uq",
  });
  assert.deepEqual(safeErrorDiagnostics(error), { causes: [{ name: "Error", constraint: "pathpilot_users_email_uq" }] });
});
