import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionOriginConfiguration, createCsrfProtection, createStrictCorsMiddleware, configuredFrontendOrigins, isTrustedOrigin } from "./request-security.ts";

function request(method: string, headers: Record<string, string> = {}) {
  return {
    method,
    protocol: "http",
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as any;
}

function response() {
  const state = { statusCode: 200, body: undefined as unknown, headers: new Map<string, string>(), ended: false };
  return {
    state,
    status(code: number) { state.statusCode = code; return this; },
    json(body: unknown) { state.body = body; return this; },
    setHeader(name: string, value: string) { state.headers.set(name, value); return this; },
    end() { state.ended = true; return this; },
  } as any;
}

test("only configured cross-origin requests are trusted", () => {
  const origins = configuredFrontendOrigins("http://localhost:5173,https://pathpilot.example");
  assert.equal(isTrustedOrigin(request("POST", { origin: "http://localhost:5173", host: "localhost:3000" }), "http://localhost:5173", origins, "development"), true);
  assert.equal(isTrustedOrigin(request("POST", { origin: "https://evil.example", host: "localhost:3000" }), "https://evil.example", origins, "development"), false);
});

test("CSRF middleware rejects missing and mismatched request provenance", () => {
  const origins = configuredFrontendOrigins("http://localhost:5173");
  const csrf = createCsrfProtection(origins, "development");

  const missingResponse = response();
  let called = false;
  csrf(request("POST", { host: "localhost:3000" }), missingResponse, () => { called = true; });
  assert.equal(called, false);
  assert.equal(missingResponse.state.statusCode, 403);

  const allowedResponse = response();
  called = false;
  csrf(request("POST", { origin: "http://localhost:5173", host: "localhost:3000" }), allowedResponse, () => { called = true; });
  assert.equal(called, true);
  assert.equal(allowedResponse.state.statusCode, 200);

  const mismatchResponse = response();
  called = false;
  csrf(request("POST", { origin: "http://localhost:5173", referer: "https://evil.example/form", host: "localhost:3000" }), mismatchResponse, () => { called = true; });
  assert.equal(called, false);
  assert.equal(mismatchResponse.state.statusCode, 403);

  const nullOriginResponse = response();
  called = false;
  csrf(request("POST", { origin: "null", referer: "http://localhost:5173/form", host: "localhost:3000" }), nullOriginResponse, () => { called = true; });
  assert.equal(called, false);
  assert.equal(nullOriginResponse.state.statusCode, 403);
});

test("strict CORS does not allow an unconfigured origin", () => {
  const cors = createStrictCorsMiddleware(configuredFrontendOrigins("http://localhost:5173"), "development");
  const deniedResponse = response();
  let called = false;
  cors(request("GET", { origin: "https://evil.example", host: "localhost:3000" }), deniedResponse, () => { called = true; });
  assert.equal(called, false);
  assert.equal(deniedResponse.state.statusCode, 403);
});

test("production requires an explicit frontend origin allowlist", () => {
  assert.throws(() => assertProductionOriginConfiguration("production", new Set()), /FRONTEND_ORIGINS/);
  assert.doesNotThrow(() => assertProductionOriginConfiguration("production", configuredFrontendOrigins("https://frontend.example")));
});

test("development defaults to the two explicit local Vite origins", () => {
  const previous = process.env.FRONTEND_ORIGINS;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.FRONTEND_ORIGINS;
  process.env.NODE_ENV = "development";
  try {
    assert.deepEqual([...configuredFrontendOrigins()].sort(), ["http://127.0.0.1:5173", "http://localhost:5173"]);
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_ORIGINS;
    else process.env.FRONTEND_ORIGINS = previous;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
