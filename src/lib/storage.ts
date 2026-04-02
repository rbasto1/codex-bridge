import type { PersistedUi } from "../types";
import { isRecord } from "../shared/codex.js";

const STORAGE_KEY = "codex-web-local-ui";

export function readPersistedUi(): PersistedUi {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as PersistedUi;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writePersistedUi(value: PersistedUi): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore localStorage failures in private or restricted environments.
  }
}
