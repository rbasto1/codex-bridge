import type { BrowserEvent } from "../shared/codex.js";

export function safeSocketEvent(raw: string): BrowserEvent | null {
  try {
    return JSON.parse(raw) as BrowserEvent;
  } catch {
    return null;
  }
}
