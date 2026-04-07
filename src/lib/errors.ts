import { ApiError, UnauthorizedError } from "../client/api";
import { isRecord } from "../shared/codex.js";

export function getErrorMessage(error: unknown): string {
  if (error instanceof UnauthorizedError) {
    return "";
  }

  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  const structuredMessage = extractStructuredErrorMessage(error);
  if (structuredMessage) {
    return structuredMessage;
  }

  if (error == null) {
    return "";
  }

  if (typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return "";
    }
  }

  return String(error);
}

export function looksNonSteerable(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  return error.message.toLowerCase().includes("steerable");
}

function extractStructuredErrorMessage(error: unknown, seen = new Set<object>()): string {
  if (typeof error === "string") {
    return error.trim();
  }

  if (!isRecord(error) || seen.has(error)) {
    return "";
  }

  seen.add(error);

  for (const key of ["message", "detail", "title", "error_description"] as const) {
    const value = error[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const key of ["error", "data", "cause"] as const) {
    const nested = extractStructuredErrorMessage(error[key], seen);
    if (nested) {
      return nested;
    }
  }

  return "";
}
