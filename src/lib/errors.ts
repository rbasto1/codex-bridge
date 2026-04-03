import { ApiError, UnauthorizedError } from "../client/api";

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

  return String(error);
}

export function looksNonSteerable(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  return error.message.toLowerCase().includes("steerable");
}
