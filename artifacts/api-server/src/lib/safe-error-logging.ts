type SafeErrorMetadata = {
  name?: string;
  sqlState?: string;
  severity?: string;
  schema?: string;
  table?: string;
  column?: string;
  constraint?: string;
};

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/;
const sqlStatePattern = /^[0-9A-Z]{5}$/;
const safeSeverities = new Set(["ERROR", "FATAL", "PANIC"]);

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
}

/** Extract PostgreSQL diagnostics without logging query text, values, or raw messages. */
export function safeErrorDiagnostics(error: unknown): { causes: SafeErrorMetadata[] } {
  const causes: SafeErrorMetadata[] = [];
  const seen = new Set<object>();
  let current: unknown = error;

  while (current && typeof current === "object" && causes.length < 5 && !seen.has(current)) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    const metadata: SafeErrorMetadata = {};
    if (current instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(current.name)) metadata.name = current.name;
    if (typeof value.code === "string" && sqlStatePattern.test(value.code)) metadata.sqlState = value.code;
    if (typeof value.severity === "string" && safeSeverities.has(value.severity)) metadata.severity = value.severity;
    const schema = safeIdentifier(value.schema);
    const table = safeIdentifier(value.table);
    const column = safeIdentifier(value.column);
    const constraint = safeIdentifier(value.constraint);
    if (schema) metadata.schema = schema;
    if (table) metadata.table = table;
    if (column) metadata.column = column;
    if (constraint) metadata.constraint = constraint;
    causes.push(metadata);
    current = value.cause;
  }

  return { causes };
}
