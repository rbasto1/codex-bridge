import type {
  Thread,
  ThreadItem,
  TurnStatus,
  UserInput,
} from "../shared/codex.js";
import { isRecord } from "../shared/codex.js";

export type PlanTaskStatus = "completed" | "inProgress" | "pending" | "unknown";

export interface PlanTask {
  key: string;
  text: string;
  status: PlanTaskStatus;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (isRecord(entry) && typeof entry.text === "string") {
        return entry.text;
      }

      return "";
    })
    .filter((entry) => entry.length > 0);
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

  return `$${input.name} (${input.path})`;
}

export function buildTurnAgentCopyText(items: ThreadItem[], status: TurnStatus | undefined): string {
  if (!status || status === "inProgress") {
    return "";
  }

  return items
    .filter((item) => isItemType(item, "agentMessage"))
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
      if (!isRecord(change) || typeof change.path !== "string") {
        return null;
      }

      if (typeof change.kind === "string") {
        return change.kind === "update" ? change.path : `${change.kind}: ${change.path}`;
      }

      if (isRecord(change.kind) && typeof change.kind.type === "string") {
        if (change.kind.type === "move" && typeof change.kind.move_path === "string" && change.kind.move_path.length > 0) {
          return `${change.path} -> ${change.kind.move_path}`;
        }

        return change.kind.type === "update" ? change.path : `${change.kind.type}: ${change.path}`;
      }

      return change.path;
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
  const normalizedType = normalizeItemType(type);
  if (
    normalizedType === "usermessage"
    || normalizedType === "agentmessage"
    || normalizedType === "commandexecution"
    || normalizedType === "contextcompaction"
  ) {
    return "";
  }

  return type.replace(/([A-Z])/g, " $1").toLowerCase();
}

export function normalizeItemType(type: string): string {
  return typeof type === "string" ? type.trim().toLowerCase() : "";
}

export function isItemType(item: Pick<ThreadItem, "type"> | null | undefined, expectedType: string): boolean {
  return normalizeItemType(item?.type ?? "") === normalizeItemType(expectedType);
}

export function extractPlanTasks(item: ThreadItem | null | undefined): PlanTask[] {
  if (!item) {
    return [];
  }

  const structuredTasks = extractStructuredPlanTasks(item);
  if (structuredTasks.length > 0) {
    return structuredTasks;
  }

  return parsePlanText(asString(item.text));
}

export function extractContextCompactionMessage(item: ThreadItem | null | undefined): string {
  if (!item) {
    return "";
  }

  return extractContextCompactionValue(item, new Set<object>());
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

export function createUiForkThread(sourceThread: Thread, turns: Thread["turns"]): Thread {
  const timestampSeconds = Math.floor(Date.now() / 1000);

  return {
    ...sourceThread,
    id: `ui-draft:${crypto.randomUUID()}`,
    updatedAt: timestampSeconds,
    status: { type: "idle" },
    turns: turns.map((turn) => ({
      ...turn,
      items: turn.items.map((item) => ({ ...item })),
    })),
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

export function copyThreadScopedState<T>(
  state: Record<string, T>,
  fromThreadId: string,
  toThreadId: string,
): Record<string, T> {
  if (fromThreadId === toThreadId || !(fromThreadId in state)) {
    return state;
  }

  return { ...state, [toThreadId]: state[fromThreadId] };
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractContextCompactionValue(value: unknown, seen: Set<object>): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractContextCompactionValue(entry, seen))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (!isRecord(value) || seen.has(value)) {
    return "";
  }

  seen.add(value);

  for (const key of [
    "summary",
    "summaryText",
    "text",
    "message",
    "details",
    "reason",
    "content",
    "contentText",
    "description",
  ] as const) {
    const extracted = extractContextCompactionValue(value[key], seen);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function extractStructuredPlanTasks(item: ThreadItem): PlanTask[] {
  if (!Array.isArray(item.steps)) {
    return [];
  }

  return item.steps
    .map((entry, index) => {
      if (!isRecord(entry)) {
        return null;
      }

      const text = typeof entry.step === "string"
        ? entry.step
        : (typeof entry.text === "string" ? entry.text : "");
      if (!text.trim()) {
        return null;
      }

      return {
        key: `${item.id}-step-${index}`,
        text: text.trim(),
        status: normalizePlanStatus(entry.status),
      } satisfies PlanTask;
    })
    .filter((entry): entry is PlanTask => Boolean(entry));
}

function parsePlanText(text: string): PlanTask[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tasks: PlanTask[] = [];

  for (const [index, line] of lines.entries()) {
    const checkboxMatch = line.match(/^[-*+]\s+\[( |x|X)\]\s+(.+)$/);
    if (checkboxMatch) {
      tasks.push({
        key: `checkbox-${index}`,
        text: checkboxMatch[2].trim(),
        status: checkboxMatch[1].toLowerCase() === "x" ? "completed" : "pending",
      });
      continue;
    }

    const explicitStatusMatch = line.match(
      /^(?:[-*+]\s+|\d+\.\s+)(?:\*\*)?(pending|in[\s_-]?progress|completed)(?:\*\*)?:?\s+(.+)$/i,
    );
    if (explicitStatusMatch) {
      tasks.push({
        key: `status-${index}`,
        text: explicitStatusMatch[2].trim(),
        status: normalizePlanStatus(explicitStatusMatch[1]),
      });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      tasks.push({
        key: `ordered-${index}`,
        text: line.replace(/^\d+\.\s+/, "").trim(),
        status: "unknown",
      });
    }
  }

  return tasks;
}

function normalizePlanStatus(value: unknown): PlanTaskStatus {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "completed") {
    return "completed";
  }

  if (normalized === "pending") {
    return "pending";
  }

  if (normalized === "in_progress" || normalized === "in-progress" || normalized === "in progress") {
    return "inProgress";
  }

  return "unknown";
}
