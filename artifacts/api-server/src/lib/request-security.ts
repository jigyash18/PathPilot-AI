import type { Request, RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_DEVELOPMENT_FRONTEND_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function configuredFrontendOrigins(
  raw = process.env.FRONTEND_ORIGINS ?? (process.env.NODE_ENV === "production" ? "" : DEFAULT_DEVELOPMENT_FRONTEND_ORIGINS),
): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((origin) => normalizeOrigin(origin.trim()))
      .filter((origin): origin is string => Boolean(origin)),
  );
}

export function assertProductionOriginConfiguration(
  nodeEnv = process.env.NODE_ENV,
  origins = configuredFrontendOrigins(),
): void {
  if (nodeEnv === "production" && origins.size === 0) {
    throw new Error("FRONTEND_ORIGINS must contain the explicit frontend origin allowlist in production.");
  }
}

function requestOrigin(req: Request): string | null {
  const protocol = req.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() || req.protocol;
  const host = req.get("host");
  return host ? `${protocol}://${host}` : null;
}

function sameOrigin(req: Request, origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  const current = requestOrigin(req);
  return Boolean(normalized && current && normalized === normalizeOrigin(current));
}

export function isTrustedOrigin(
  req: Request,
  origin: string,
  origins = configuredFrontendOrigins(),
  nodeEnv = process.env.NODE_ENV,
): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (origins.has(normalized)) return true;
  return nodeEnv !== "production" && sameOrigin(req, normalized);
}

function refererOrigin(req: Request): string | null {
  const referer = req.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function suppliedOrigins(req: Request): { origin: string | null; mismatch: boolean } {
  const rawOrigin = req.get("origin");
  const hasOriginHeader = rawOrigin !== undefined;
  const origin = hasOriginHeader && rawOrigin !== "null" ? normalizeOrigin(rawOrigin) : null;
  const referer = refererOrigin(req);
  return {
    origin: hasOriginHeader ? origin : referer,
    mismatch: Boolean((hasOriginHeader && !origin) || (origin && referer && origin !== referer)),
  };
}

export function createStrictCorsMiddleware(
  origins = configuredFrontendOrigins(),
  nodeEnv = process.env.NODE_ENV,
): RequestHandler {
  return (req, res, next) => {
    const origin = req.get("origin");
    if (!origin) {
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
      next();
      return;
    }
    if (!isTrustedOrigin(req, origin, origins, nodeEnv)) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", normalizeOrigin(origin)!);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", req.get("access-control-request-headers") || "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }
    next();
  };
}

export function createCsrfProtection(
  origins = configuredFrontendOrigins(),
  nodeEnv = process.env.NODE_ENV,
): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const supplied = suppliedOrigins(req);
    if (supplied.mismatch || !supplied.origin || !isTrustedOrigin(req, supplied.origin, origins, nodeEnv)) {
      res.status(403).json({ error: "A valid same-origin or configured-origin request is required." });
      return;
    }
    next();
  };
}
