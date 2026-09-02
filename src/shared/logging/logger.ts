import type { WorkspaceLogger } from "../../domain/workspace/ports";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = {
  [key: string]: JsonValue;
};

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 25;
const MAX_STRING_LENGTH = 512;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "coverdataurl" ||
    normalized === "rollbacktoken" ||
    normalized === "stack" ||
    normalized.endsWith("token") ||
    normalized.endsWith("path") ||
    normalized.endsWith("dataurl") ||
    normalized === "relativefile" ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("authorization")
  );
}

function sanitizeString(value: string): string {
  const sanitized = value
    .replace(
      /data:(?:image|audio|video|application)\/[^\s"'<>]+/gi,
      "[media omitted]",
    )
    .replace(
      /(?:[a-zA-Z]:\\|\\\\[^\\\s]+\\)[^\s"'<>]+/g,
      "[path omitted]",
    );
  return sanitized.length <= MAX_STRING_LENGTH
    ? sanitized
    : `${sanitized.slice(0, MAX_STRING_LENGTH)}…`;
}

function sanitizeError(error: Error, depth: number): JsonObject {
  const sanitized: JsonObject = {
    name: error.name,
    message: sanitizeString(error.message),
  };

  if (isObjectRecord(error) && hasOwn(error, "code")) {
    const code = Reflect.get(error, "code");
    if (typeof code === "string" || typeof code === "number") {
      sanitized.code = String(code);
    }
  }

  if (isObjectRecord(error) && hasOwn(error, "context")) {
    const context = sanitizeValue(Reflect.get(error, "context"), depth + 1);
    if (context !== undefined) {
      sanitized.context = context;
    }
  }

  if ("cause" in error) {
    const cause = sanitizeValue(error.cause, depth + 1);
    if (cause !== undefined) {
      sanitized.cause = cause;
    }
  }

  return sanitized;
}

function sanitizeArray(value: unknown[], depth: number): JsonValue[] {
  const sanitized: JsonValue[] = [];

  for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
    const nextValue = sanitizeValue(item, depth + 1);
    if (nextValue !== undefined) {
      sanitized.push(nextValue);
    }
  }

  if (value.length > MAX_ARRAY_ITEMS) {
    sanitized.push(`[${value.length - MAX_ARRAY_ITEMS} more items omitted]`);
  }

  return sanitized;
}

function sanitizeObject(
  value: Record<string, unknown>,
  depth: number,
): JsonObject {
  const sanitized: JsonObject = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      continue;
    }

    const nextValue = sanitizeValue(nestedValue, depth + 1);
    if (nextValue !== undefined) {
      sanitized[key] = nextValue;
    }
  }

  return sanitized;
}

function sanitizeValue(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > MAX_DEPTH) {
    return "[truncated]";
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Error) {
    return sanitizeError(value, depth);
  }

  if (Array.isArray(value)) {
    return sanitizeArray(value, depth);
  }

  if (isObjectRecord(value)) {
    return sanitizeObject(value, depth);
  }

  switch (typeof value) {
    case "string":
      return sanitizeString(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    default:
      return undefined;
  }
}

function sanitizeData(data: Record<string, unknown> | undefined): JsonObject {
  if (data === undefined) {
    return {};
  }

  return sanitizeObject(data, 0);
}

function write(
  service: string,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    data: sanitizeData(data),
  });

  switch (level) {
    case "DEBUG":
      console.debug(entry);
      break;
    case "INFO":
      console.info(entry);
      break;
    case "WARN":
      console.warn(entry);
      break;
    case "ERROR":
      console.error(entry);
      break;
  }
}

export function createLogger(service: string): WorkspaceLogger {
  return {
    debug(message, data) {
      write(service, "DEBUG", message, data);
    },
    info(message, data) {
      write(service, "INFO", message, data);
    },
    warn(message, data) {
      write(service, "WARN", message, data);
    },
    error(message, data) {
      write(service, "ERROR", message, data);
    },
  };
}

export const workspaceLogger: WorkspaceLogger = createLogger("workspace-service");

export const planLogger: WorkspaceLogger = createLogger("plan-service");
