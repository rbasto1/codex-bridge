import type {
  Thread,
  ThreadItem,
  TurnStatus,
  UserInput,
} from "../shared/codex.js";
import { isRecord } from "../shared/codex.js";

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === "string" ? entry : ""));
}

export function renderUserInputs(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((input) => renderUserInput(input as UserInput))
    .filter(Boolean)
    .join("\n");
}

export function renderUserInput(input: UserInput): string {
  if (input.type === "text") {
    return input.text;
  }

  if (input.type === "image") {
    return `[image] ${input.url}`;
  }

  if (input.type === "localImage") {
    return `[local image] ${input.path}`;
  }

  if (input.type === "mention") {
    return `@${input.name} (${input.path})`;
  }

  return `/${input.name} (${input.path})`;
}

export function buildTurnAgentCopyText(items: ThreadItem[], status: TurnStatus | undefined): string {
  if (!status || status === "inProgress") {
    return "";
  }

  return items
    .filter((item) => item.type === "agentMessage")
    .map((item) => asString(item.text))
    .filter(Boolean)
    .join("\n\n");
}

export function extractFileChangePaths(item: ThreadItem | undefined): string[] {
  if (!item || !Array.isArray(item.changes)) {
    return [];
  }

  return item.changes
    .map((change) => {
      if (isRecord(change) && typeof change.path === "string" && typeof change.kind === "string") {
        return `${change.kind}: ${change.path}`;
      }

      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

export function formatSessionSource(source: unknown): string {
  if (typeof source === "string") {
    return source;
  }

  if (isRecord(source) && typeof source.custom === "string") {
    return source.custom;
  }

  if (isRecord(source) && source.subAgent) {
    return "sub-agent";
  }

  return "unknown";
}

export function formatRelativeTime(timestampSeconds: number): string {
  const now = Date.now();
  const diff = now - timestampSeconds * 1000;
  const mins = Math.floor(diff / 60000);

  if (mins < 1) {
    return "now";
  }

  if (mins < 60) {
    return `${mins}m`;
  }

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h`;
  }

  const days = Math.floor(hrs / 24);
  if (days < 7) {
    return `${days}d`;
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(timestampSeconds * 1000),
  );
}

export function formatItemLabel(type: string): string {
  if (type === "userMessage" || type === "agentMessage" || type === "commandExecution") {
    return "";
  }

  return type.replace(/([A-Z])/g, " $1").toLowerCase();
}

export function createUiDraftThread(cwd: string): Thread {
  const timestampSeconds = Math.floor(Date.now() / 1000);

  return {
    id: `ui-draft:${crypto.randomUUID()}`,
    preview: "New session",
    ephemeral: false,
    modelProvider: "local",
    createdAt: timestampSeconds,
    updatedAt: timestampSeconds,
    status: { type: "idle" },
    path: null,
    cwd,
    cliVersion: "",
    source: "frontend draft",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    uiOnly: true,
  };
}

export function isUiOnlyThread(thread: Thread | null | undefined): thread is Thread & { uiOnly: true } {
  return Boolean(thread?.uiOnly);
}

export function moveThreadScopedState<T>(
  state: Record<string, T>,
  fromThreadId: string,
  toThreadId: string,
): Record<string, T> {
  if (fromThreadId === toThreadId || !(fromThreadId in state)) {
    return state;
  }

  const next = { ...state, [toThreadId]: state[fromThreadId] };
  delete next[fromThreadId];
  return next;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
