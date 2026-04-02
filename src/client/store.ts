import { create } from "zustand";

import {
  isRecord,
  serializeRequestId,
  type AppServerExit,
  type AppServerStatus,
  type BackendSnapshot,
  type BrowserServerRequest,
  type InitializeResponse,
  type Thread,
  type ThreadItem,
  type ThreadSessionConfig,
  type Turn,
} from "../shared/codex.js";

export type ThreadMode = "replay" | "live";

type AppStore = {
  backendStatus: AppServerStatus;
  initializeResponse: InitializeResponse | null;
  stderrTail: string[];
  lastExit: AppServerExit;
  threadsById: Record<string, Thread>;
  threadSessionConfigById: Record<string, ThreadSessionConfig>;
  threadOrder: string[];
  turnsById: Record<string, Turn>;
  turnOrderByThreadId: Record<string, string[]>;
  itemsById: Record<string, ThreadItem>;
  itemOrderByTurnId: Record<string, string[]>;
  activeThreadId: string | null;
  threadModes: Record<string, ThreadMode>;
  liveAttachedThreadIds: Record<string, true>;
  activeTurnIdByThreadId: Record<string, string>;
  pendingServerRequestsById: Record<string, BrowserServerRequest>;
  selectedThreadError: string | null;
  nonSteerableThreadIds: Record<string, boolean>;
  setSnapshot: (snapshot: BackendSnapshot) => void;
  replaceThreads: (threads: Thread[]) => void;
  hydrateThread: (thread: Thread, mode: ThreadMode, sessionConfig?: ThreadSessionConfig | null) => void;
  setActiveThread: (threadId: string | null) => void;
  setSelectedThreadError: (message: string | null) => void;
  setThreadSessionConfig: (threadId: string, sessionConfig: ThreadSessionConfig) => void;
  updateThreadName: (threadId: string, name: string | null) => void;
  removeThread: (threadId: string) => void;
  noteTurn: (threadId: string, turn: Turn) => void;
  applyNotification: (method: string, params: unknown) => void;
  putServerRequest: (request: BrowserServerRequest) => void;
  markNonSteerable: (threadId: string, value: boolean) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  backendStatus: "starting",
  initializeResponse: null,
  stderrTail: [],
  lastExit: null,
  threadsById: {},
  threadSessionConfigById: {},
  threadOrder: [],
  turnsById: {},
  turnOrderByThreadId: {},
  itemsById: {},
  itemOrderByTurnId: {},
  activeThreadId: null,
  threadModes: {},
  liveAttachedThreadIds: {},
  activeTurnIdByThreadId: {},
  pendingServerRequestsById: {},
  selectedThreadError: null,
  nonSteerableThreadIds: {},

  setSnapshot: (snapshot) => {
    set(() => ({
      backendStatus: snapshot.status,
      initializeResponse: snapshot.initializeResponse,
      stderrTail: snapshot.stderrTail,
      lastExit: snapshot.lastExit,
      pendingServerRequestsById: Object.fromEntries(
        snapshot.pendingServerRequests.map((request) => [request.key, request]),
      ),
    }));
  },

  replaceThreads: (threads) => {
    set((state) => {
      const threadsById = { ...state.threadsById };
      for (const thread of threads) {
        threadsById[thread.id] = mergeThread(threadsById[thread.id], thread);
      }

      return {
        threadsById,
        threadOrder: sortThreadOrder(threadsById),
      };
    });
  },

  hydrateThread: (thread, mode, sessionConfig) => {
    set((state) => {
      const threadsById = {
        ...state.threadsById,
        [thread.id]: mergeThread(state.threadsById[thread.id], thread),
      };
      const threadSessionConfigById = { ...state.threadSessionConfigById };
      const turnsById = { ...state.turnsById };
      const turnOrderByThreadId = { ...state.turnOrderByThreadId };
      const itemsById = { ...state.itemsById };
      const itemOrderByTurnId = { ...state.itemOrderByTurnId };
      const activeTurnIdByThreadId = { ...state.activeTurnIdByThreadId };
      const threadModes = { ...state.threadModes, [thread.id]: mode };
      const liveAttachedThreadIds = { ...state.liveAttachedThreadIds };

      turnOrderByThreadId[thread.id] = [];
      for (const turn of thread.turns) {
        turnsById[turn.id] = turn;
        turnOrderByThreadId[thread.id].push(turn.id);
        itemOrderByTurnId[turn.id] = [];
        for (const item of turn.items) {
          itemsById[item.id] = item;
          itemOrderByTurnId[turn.id].push(item.id);
        }
      }

      const activeTurnId = findActiveTurnId(thread.turns);
      if (activeTurnId) {
        activeTurnIdByThreadId[thread.id] = activeTurnId;
      } else {
        delete activeTurnIdByThreadId[thread.id];
      }

      if (mode === "live") {
        liveAttachedThreadIds[thread.id] = true;
      } else {
        delete liveAttachedThreadIds[thread.id];
      }

      if (sessionConfig) {
        threadSessionConfigById[thread.id] = sessionConfig;
      }

      return {
        threadsById,
        threadSessionConfigById,
        threadOrder: sortThreadOrder(threadsById),
        turnsById,
        turnOrderByThreadId,
        itemsById,
        itemOrderByTurnId,
        activeThreadId: thread.id,
        threadModes,
        liveAttachedThreadIds,
        activeTurnIdByThreadId,
        selectedThreadError: null,
      };
    });
  },

  setActiveThread: (threadId) => {
    set(() => ({
      activeThreadId: threadId,
    }));
  },

  setSelectedThreadError: (message) => {
    set(() => ({
      selectedThreadError: message,
    }));
  },

  setThreadSessionConfig: (threadId, sessionConfig) => {
    set((state) => ({
      threadSessionConfigById: {
        ...state.threadSessionConfigById,
        [threadId]: sessionConfig,
      },
    }));
  },

  updateThreadName: (threadId, name) => {
    set((state) => {
      const thread = state.threadsById[threadId];
      if (!thread) {
        return state;
      }

      return {
        threadsById: {
          ...state.threadsById,
          [threadId]: {
            ...thread,
            name,
          },
        },
      };
    });
  },

  removeThread: (threadId) => {
    set((state) => {
      if (!state.threadsById[threadId]) {
        return state;
      }

      const threadsById = { ...state.threadsById };
      delete threadsById[threadId];

      const threadSessionConfigById = { ...state.threadSessionConfigById };
      delete threadSessionConfigById[threadId];

      const threadModes = { ...state.threadModes };
      delete threadModes[threadId];

      const liveAttachedThreadIds = { ...state.liveAttachedThreadIds };
      delete liveAttachedThreadIds[threadId];

      const activeTurnIdByThreadId = { ...state.activeTurnIdByThreadId };
      delete activeTurnIdByThreadId[threadId];

      const nonSteerableThreadIds = { ...state.nonSteerableThreadIds };
      delete nonSteerableThreadIds[threadId];

      const turnOrderByThreadId = { ...state.turnOrderByThreadId };
      const turnIds = turnOrderByThreadId[threadId] ?? [];
      delete turnOrderByThreadId[threadId];

      const turnsById = { ...state.turnsById };
      const itemOrderByTurnId = { ...state.itemOrderByTurnId };
      const itemsById = { ...state.itemsById };

      for (const turnId of turnIds) {
        delete turnsById[turnId];
        const itemIds = itemOrderByTurnId[turnId] ?? [];
        delete itemOrderByTurnId[turnId];
        for (const itemId of itemIds) {
          delete itemsById[itemId];
        }
      }

      return {
        threadsById,
        threadSessionConfigById,
        threadOrder: sortThreadOrder(threadsById),
        turnsById,
        turnOrderByThreadId,
        itemsById,
        itemOrderByTurnId,
        activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
        threadModes,
        liveAttachedThreadIds,
        activeTurnIdByThreadId,
        nonSteerableThreadIds,
      };
    });
  },

  noteTurn: (threadId, turn) => {
    set((state) => {
      const turnsById = { ...state.turnsById, [turn.id]: turn };
      const turnOrderByThreadId = { ...state.turnOrderByThreadId };
      const activeTurnIdByThreadId = { ...state.activeTurnIdByThreadId };
      const nonSteerableThreadIds = { ...state.nonSteerableThreadIds };

      ensureOrderedId(turnOrderByThreadId, threadId, turn.id);

      if (turn.status === "inProgress") {
        activeTurnIdByThreadId[threadId] = turn.id;
      } else if (activeTurnIdByThreadId[threadId] === turn.id) {
        delete activeTurnIdByThreadId[threadId];
        delete nonSteerableThreadIds[threadId];
      }

      return {
        turnsById,
        turnOrderByThreadId,
        activeTurnIdByThreadId,
        nonSteerableThreadIds,
      };
    });
  },

  applyNotification: (method, params) => {
    set((state) => {
      const payload = isRecord(params) ? params : null;

      if (method === "serverRequest/resolved" && payload) {
        const requestId = payload.requestId;
        if (typeof requestId === "string" || typeof requestId === "number") {
          const pendingServerRequestsById = { ...state.pendingServerRequestsById };
          delete pendingServerRequestsById[serializeRequestId(requestId)];
          return { pendingServerRequestsById };
        }
        return state;
      }

      const threadId = payload && typeof payload.threadId === "string" ? payload.threadId : null;
      const isThreadActivity = method.startsWith("turn/") || method.startsWith("item/");
      if (threadId && isThreadActivity && !state.liveAttachedThreadIds[threadId]) {
        return state;
      }

      switch (method) {
        case "thread/started": {
          if (!payload || !isRecord(payload.thread)) {
            return state;
          }

          const thread = payload.thread as Thread;
          const threadsById = {
            ...state.threadsById,
            [thread.id]: mergeThread(state.threadsById[thread.id], thread),
          };

          return {
            threadsById,
            threadOrder: sortThreadOrder(threadsById),
          };
        }

        case "thread/status/changed": {
          if (!threadId || !payload || !state.threadsById[threadId]) {
            return state;
          }

          return {
            threadsById: {
              ...state.threadsById,
              [threadId]: {
                ...state.threadsById[threadId],
                status: payload.status as Thread["status"],
              },
            },
          };
        }

        case "thread/name/updated": {
          if (!threadId || !state.threadsById[threadId]) {
            return state;
          }

          return {
            threadsById: {
              ...state.threadsById,
              [threadId]: {
                ...state.threadsById[threadId],
                name: typeof payload?.threadName === "string" ? payload.threadName : null,
              },
            },
          };
        }

        case "turn/started":
        case "turn/completed": {
          if (!threadId || !payload || !isRecord(payload.turn)) {
            return state;
          }

          const turn = payload.turn as Turn;
          const turnsById = { ...state.turnsById, [turn.id]: turn };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const activeTurnIdByThreadId = { ...state.activeTurnIdByThreadId };
          const nonSteerableThreadIds = { ...state.nonSteerableThreadIds };

          ensureOrderedId(turnOrderByThreadId, threadId, turn.id);

          if (turn.status === "inProgress") {
            activeTurnIdByThreadId[threadId] = turn.id;
          } else if (activeTurnIdByThreadId[threadId] === turn.id) {
            delete activeTurnIdByThreadId[threadId];
            delete nonSteerableThreadIds[threadId];
          }

          return {
            turnsById,
            turnOrderByThreadId,
            activeTurnIdByThreadId,
            nonSteerableThreadIds,
          };
        }

        case "item/started":
        case "item/completed": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || !isRecord(payload.item)) {
            return state;
          }

          const itemsById = { ...state.itemsById, [payload.item.id as string]: payload.item as ThreadItem };
          const turnsById = { ...state.turnsById };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const itemOrderByTurnId = { ...state.itemOrderByTurnId };

          ensureTurn(turnsById, payload.turnId);
          ensureOrderedId(turnOrderByThreadId, threadId, payload.turnId);
          ensureOrderedId(itemOrderByTurnId, payload.turnId, payload.item.id as string);

          return {
            itemsById,
            turnsById,
            turnOrderByThreadId,
            itemOrderByTurnId,
          };
        }

        case "item/agentMessage/delta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const turnsById = { ...state.turnsById };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const itemsById = { ...state.itemsById };
          const itemOrderByTurnId = { ...state.itemOrderByTurnId };

          ensureTurn(turnsById, payload.turnId);
          ensureOrderedId(turnOrderByThreadId, threadId, payload.turnId);
          ensureOrderedId(itemOrderByTurnId, payload.turnId, payload.itemId);
          const current = ensurePlaceholderItem(itemsById, payload.itemId, "agentMessage");

          itemsById[payload.itemId] = {
            ...current,
            text: `${asString(current.text)}${asString(payload.delta)}`,
          };

          return {
            turnsById,
            turnOrderByThreadId,
            itemsById,
            itemOrderByTurnId,
          };
        }

        case "item/plan/delta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const turnsById = { ...state.turnsById };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const itemsById = { ...state.itemsById };
          const itemOrderByTurnId = { ...state.itemOrderByTurnId };

          ensureTurn(turnsById, payload.turnId);
          ensureOrderedId(turnOrderByThreadId, threadId, payload.turnId);
          ensureOrderedId(itemOrderByTurnId, payload.turnId, payload.itemId);
          const current = ensurePlaceholderItem(itemsById, payload.itemId, "plan");

          itemsById[payload.itemId] = {
            ...current,
            text: `${asString(current.text)}${asString(payload.delta)}`,
          };

          return {
            turnsById,
            turnOrderByThreadId,
            itemsById,
            itemOrderByTurnId,
          };
        }

        case "item/commandExecution/outputDelta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const turnsById = { ...state.turnsById };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const itemsById = { ...state.itemsById };
          const itemOrderByTurnId = { ...state.itemOrderByTurnId };

          ensureTurn(turnsById, payload.turnId);
          ensureOrderedId(turnOrderByThreadId, threadId, payload.turnId);
          ensureOrderedId(itemOrderByTurnId, payload.turnId, payload.itemId);
          const current = ensurePlaceholderItem(itemsById, payload.itemId, "commandExecution");

          itemsById[payload.itemId] = {
            ...current,
            aggregatedOutput: `${asString(current.aggregatedOutput)}${asString(payload.delta)}`,
          };

          return {
            turnsById,
            turnOrderByThreadId,
            itemsById,
            itemOrderByTurnId,
          };
        }

        case "item/fileChange/outputDelta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const turnsById = { ...state.turnsById };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const itemsById = { ...state.itemsById };
          const itemOrderByTurnId = { ...state.itemOrderByTurnId };

          ensureTurn(turnsById, payload.turnId);
          ensureOrderedId(turnOrderByThreadId, threadId, payload.turnId);
          ensureOrderedId(itemOrderByTurnId, payload.turnId, payload.itemId);
          const current = ensurePlaceholderItem(itemsById, payload.itemId, "fileChange");

          itemsById[payload.itemId] = {
            ...current,
            summaryText: `${asString(current.summaryText)}${asString(payload.delta)}`,
          };

          return {
            turnsById,
            turnOrderByThreadId,
            itemsById,
            itemOrderByTurnId,
          };
        }

        case "item/reasoning/summaryPartAdded": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const turnsById = { ...state.turnsById };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const itemsById = { ...state.itemsById };
          const itemOrderByTurnId = { ...state.itemOrderByTurnId };
          const summaryIndex = typeof payload.summaryIndex === "number" ? payload.summaryIndex : 0;

          ensureTurn(turnsById, payload.turnId);
          ensureOrderedId(turnOrderByThreadId, threadId, payload.turnId);
          ensureOrderedId(itemOrderByTurnId, payload.turnId, payload.itemId);
          const current = ensurePlaceholderItem(itemsById, payload.itemId, "reasoning");
          const summary = normalizeStringArray(current.summary);
          while (summary.length <= summaryIndex) {
            summary.push("");
          }

          itemsById[payload.itemId] = {
            ...current,
            summary,
          };

          return {
            turnsById,
            turnOrderByThreadId,
            itemsById,
            itemOrderByTurnId,
          };
        }

        case "item/reasoning/summaryTextDelta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const turnsById = { ...state.turnsById };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const itemsById = { ...state.itemsById };
          const itemOrderByTurnId = { ...state.itemOrderByTurnId };
          const summaryIndex = typeof payload.summaryIndex === "number" ? payload.summaryIndex : 0;

          ensureTurn(turnsById, payload.turnId);
          ensureOrderedId(turnOrderByThreadId, threadId, payload.turnId);
          ensureOrderedId(itemOrderByTurnId, payload.turnId, payload.itemId);
          const current = ensurePlaceholderItem(itemsById, payload.itemId, "reasoning");
          const summary = normalizeStringArray(current.summary);
          while (summary.length <= summaryIndex) {
            summary.push("");
          }
          summary[summaryIndex] = `${summary[summaryIndex]}${asString(payload.delta)}`;

          itemsById[payload.itemId] = {
            ...current,
            summary,
          };

          return {
            turnsById,
            turnOrderByThreadId,
            itemsById,
            itemOrderByTurnId,
          };
        }

        case "item/reasoning/textDelta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const turnsById = { ...state.turnsById };
          const turnOrderByThreadId = { ...state.turnOrderByThreadId };
          const itemsById = { ...state.itemsById };
          const itemOrderByTurnId = { ...state.itemOrderByTurnId };
          const contentIndex = typeof payload.contentIndex === "number" ? payload.contentIndex : 0;

          ensureTurn(turnsById, payload.turnId);
          ensureOrderedId(turnOrderByThreadId, threadId, payload.turnId);
          ensureOrderedId(itemOrderByTurnId, payload.turnId, payload.itemId);
          const current = ensurePlaceholderItem(itemsById, payload.itemId, "reasoning");
          const content = normalizeStringArray(current.content);
          while (content.length <= contentIndex) {
            content.push("");
          }
          content[contentIndex] = `${content[contentIndex]}${asString(payload.delta)}`;

          itemsById[payload.itemId] = {
            ...current,
            content,
          };

          return {
            turnsById,
            turnOrderByThreadId,
            itemsById,
            itemOrderByTurnId,
          };
        }

        default:
          return state;
      }
    });
  },

  putServerRequest: (request) => {
    set((state) => ({
      pendingServerRequestsById: {
        ...state.pendingServerRequestsById,
        [request.key]: request,
      },
    }));
  },

  markNonSteerable: (threadId, value) => {
    set((state) => {
      const nonSteerableThreadIds = { ...state.nonSteerableThreadIds };
      if (value) {
        nonSteerableThreadIds[threadId] = true;
      } else {
        delete nonSteerableThreadIds[threadId];
      }

      return { nonSteerableThreadIds };
    });
  },
}));

function mergeThread(previous: Thread | undefined, next: Thread): Thread {
  if (!previous) {
    return next;
  }

  return {
    ...previous,
    ...next,
    turns: next.turns.length > 0 ? next.turns : previous.turns,
  };
}

function sortThreadOrder(threadsById: Record<string, Thread>): string[] {
  return Object.values(threadsById)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((thread) => thread.id);
}

function findActiveTurnId(turns: Turn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.status === "inProgress") {
      return turns[index].id;
    }
  }

  return null;
}

function ensureOrderedId(target: Record<string, string[]>, bucket: string, id: string): void {
  const next = target[bucket] ? [...target[bucket]] : [];
  if (!next.includes(id)) {
    next.push(id);
  }
  target[bucket] = next;
}

function ensureTurn(turnsById: Record<string, Turn>, turnId: string): void {
  if (!turnsById[turnId]) {
    turnsById[turnId] = {
      id: turnId,
      items: [],
      status: "inProgress",
      error: null,
    };
  }
}

function ensurePlaceholderItem(
  itemsById: Record<string, ThreadItem>,
  itemId: string,
  type: string,
): ThreadItem {
  if (!itemsById[itemId]) {
    itemsById[itemId] = createPlaceholderItem(itemId, type);
  }

  return itemsById[itemId];
}

function createPlaceholderItem(itemId: string, type: string): ThreadItem {
  switch (type) {
    case "agentMessage":
      return { id: itemId, type, text: "", phase: null, memoryCitation: null };
    case "plan":
      return { id: itemId, type, text: "" };
    case "reasoning":
      return { id: itemId, type, summary: [], content: [] };
    case "commandExecution":
      return {
        id: itemId,
        type,
        command: "",
        cwd: "",
        processId: null,
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: "",
        exitCode: null,
        durationMs: null,
      };
    case "fileChange":
      return { id: itemId, type, changes: [], status: "inProgress", summaryText: "" };
    default:
      return { id: itemId, type };
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === "string" ? entry : ""));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
