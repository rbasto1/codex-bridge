import type { ComposerControlDraft, PersistedUi, SendHotkeyPreference } from "../types";
import { isRecord } from "../shared/codex.js";

const STORAGE_KEY = "codex-bridge-ui";
const DRAFT_PREFIX = "draft:";
const CONTROL_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function readPersistedUi(): PersistedUi {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const drafts = readComposerDrafts();
    if (!raw) {
      return drafts ? { composerDrafts: drafts } : {};
    }

    const parsed = JSON.parse(raw) as PersistedUi;
    if (!isRecord(parsed)) {
      return drafts ? { composerDrafts: drafts } : {};
    }

    const persistedValue = parsed as PersistedUi & { threadControlDraftUpdatedAt?: unknown };
    const {
      composerDrafts: rawComposerDrafts,
      threadControlDraftUpdatedAt: rawThreadControlDraftUpdatedAt,
      ...persistedUi
    } = persistedValue;
    const legacyDrafts: Record<string, string> | null = isRecord(rawComposerDrafts)
      ? Object.fromEntries(
          Object.entries(rawComposerDrafts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : null;
    const legacyThreadControlDraftUpdatedAt = readNumberRecord(rawThreadControlDraftUpdatedAt);

    return sanitizePersistedUi({
      ...persistedUi,
      composerDrafts: drafts ?? legacyDrafts ?? undefined,
      threadControlDrafts: mergeLegacyDraftTimestamps(persistedUi.threadControlDrafts, legacyThreadControlDraftUpdatedAt),
    });
  } catch {
    return {};
  }
}

export function writePersistedUi(value: PersistedUi): void {
  try {
    const { composerDrafts, ...persistedUi } = sanitizePersistedUi(value);
    writeComposerDrafts(composerDrafts ?? {});
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedUi));
  } catch {
    // Ignore localStorage failures in private or restricted environments.
  }
}

function readComposerDrafts(): Record<string, string> | null {
  const drafts = Object.fromEntries(
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(DRAFT_PREFIX))
      .map((key) => [key.slice(DRAFT_PREFIX.length), window.localStorage.getItem(key)])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  return Object.keys(drafts).length > 0 ? drafts : null;
}

function writeComposerDrafts(drafts: Record<string, string>): void {
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith(DRAFT_PREFIX)) {
      continue;
    }

    const threadId = key.slice(DRAFT_PREFIX.length);
    if (drafts[threadId] !== undefined) {
      continue;
    }

    window.localStorage.removeItem(key);
  }

  for (const [threadId, value] of Object.entries(drafts)) {
    window.localStorage.setItem(`${DRAFT_PREFIX}${threadId}`, value);
  }
}

function sanitizePersistedUi(value: PersistedUi): PersistedUi {
  const threadControlDrafts = readThreadControlDrafts(value.threadControlDrafts);
  const threadPermissionBaselines = value.threadPermissionBaselines ?? {};
  const threadLastViewedAt = readNumberRecord(value.threadLastViewedAt);
  const sendHotkey = readSendHotkey(value.sendHotkey);
  const now = Date.now();

  const activeThreadIds = Object.keys(threadControlDrafts).filter((threadId) => {
    const updatedAt = threadControlDrafts[threadId]?.updatedAt;
    return typeof updatedAt !== "number" || now - updatedAt <= CONTROL_DRAFT_TTL_MS;
  });

  return {
    ...value,
    sendHotkey,
    threadLastViewedAt,
    threadControlDrafts: Object.fromEntries(activeThreadIds.map((threadId) => [threadId, threadControlDrafts[threadId]])),
    threadPermissionBaselines: Object.fromEntries(activeThreadIds
      .filter((threadId) => threadPermissionBaselines[threadId] !== undefined)
      .map((threadId) => [threadId, threadPermissionBaselines[threadId]])),
  };
}

function readSendHotkey(value: unknown): SendHotkeyPreference | undefined {
  return value === "enter" || value === "mod-enter" ? value : undefined;
}

function readThreadControlDrafts(value: unknown): NonNullable<PersistedUi["threadControlDrafts"]> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, ComposerControlDraft] => isComposerControlDraft(entry[1]))
      .map(([threadId, draft]) => [threadId, draft]),
  );
}

function mergeLegacyDraftTimestamps(
  drafts: PersistedUi["threadControlDrafts"],
  updatedAtByThreadId: Record<string, number>,
): NonNullable<PersistedUi["threadControlDrafts"]> {
  const nextDrafts = readThreadControlDrafts(drafts);

  for (const [threadId, updatedAt] of Object.entries(updatedAtByThreadId)) {
    const draft = nextDrafts[threadId];
    if (!draft || typeof draft.updatedAt === "number") {
      continue;
    }

    nextDrafts[threadId] = { ...draft, updatedAt };
  }

  return nextDrafts;
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

function isComposerControlDraft(value: unknown): value is ComposerControlDraft {
  return isRecord(value)
    && typeof value.mode === "string"
    && typeof value.model === "string"
    && (typeof value.effort === "string" || value.effort === null || value.effort === undefined)
    && typeof value.fullAccess === "boolean"
    && (typeof value.updatedAt === "number" || value.updatedAt === undefined);
}
