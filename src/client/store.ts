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
import { asString, normalizeStringArray } from "../lib/threads";
import type { AppStore, ThreadMode } from "../types";

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
  unreadThreadIds: {},

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
      const unreadThreadIds = { ...state.unreadThreadIds };

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

      delete unreadThreadIds[thread.id];

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
        unreadThreadIds,
        selectedThreadError: null,
      };
    });
  },

  setActiveThread: (threadId) => {
    set((state) => {
      const unreadThreadIds = { ...state.unreadThreadIds };
      if (threadId) {
        delete unreadThreadIds[threadId];
      }

      return {
        activeThreadId: threadId,
        unreadThreadIds,
      };
    });
  },

  setSelectedThreadError: (message) => {
    set(() => ({
      selectedThreadError: message,
    }));
  },

  clearThreadUnread: (threadId) => {
    set((state) => {
      if (!state.unreadThreadIds[threadId]) {
        return state;
      }

      const unreadThreadIds = { ...state.unreadThreadIds };
      delete unreadThreadIds[threadId];
      return { unreadThreadIds };
    });
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
      return createTurnStateUpdate(state, threadId, turn);
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
      const unreadThreadIds = { ...state.unreadThreadIds };
      const shouldMarkUnread = Boolean(
        threadId
          && threadId !== state.activeThreadId
          && (method === "turn/completed" || method === "item/completed"),
      );
      if (shouldMarkUnread && threadId) {
        unreadThreadIds[threadId] = true;
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
          const nextTurnState = createTurnStateUpdate(state, threadId, turn);

          return {
            ...nextTurnState,
            unreadThreadIds,
          };
        }

        case "item/started":
        case "item/completed": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || !isRecord(payload.item)) {
            return state;
          }

          const itemId = payload.item.id as string;
          const nextItemState = prepareItemCollections(state, threadId, payload.turnId, itemId);
          nextItemState.itemsById[itemId] = payload.item as ThreadItem;

          return {
            ...nextItemState,
            unreadThreadIds,
          };
        }

        case "item/agentMessage/delta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const nextItemState = appendPlaceholderItemDelta(
            state,
            threadId,
            payload.turnId,
            payload.itemId,
            "agentMessage",
            "text",
            payload.delta,
          );

          return {
            ...nextItemState,
            unreadThreadIds,
          };
        }

        case "item/plan/delta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const nextItemState = appendPlaceholderItemDelta(
            state,
            threadId,
            payload.turnId,
            payload.itemId,
            "plan",
            "text",
            payload.delta,
          );

          return {
            ...nextItemState,
            unreadThreadIds,
          };
        }

        case "item/commandExecution/outputDelta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const nextItemState = appendPlaceholderItemDelta(
            state,
            threadId,
            payload.turnId,
            payload.itemId,
            "commandExecution",
            "aggregatedOutput",
            payload.delta,
          );

          return {
            ...nextItemState,
            unreadThreadIds,
          };
        }

        case "item/fileChange/outputDelta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const nextItemState = appendPlaceholderItemDelta(
            state,
            threadId,
            payload.turnId,
            payload.itemId,
            "fileChange",
            "summaryText",
            payload.delta,
          );

          return {
            ...nextItemState,
            unreadThreadIds,
          };
        }

        case "item/reasoning/summaryPartAdded": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const summaryIndex = typeof payload.summaryIndex === "number" ? payload.summaryIndex : 0;
          const nextItemState = updateReasoningItemField(
            state,
            threadId,
            payload.turnId,
            payload.itemId,
            "summary",
            summaryIndex,
          );

          return {
            ...nextItemState,
            unreadThreadIds,
          };
        }

        case "item/reasoning/summaryTextDelta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const summaryIndex = typeof payload.summaryIndex === "number" ? payload.summaryIndex : 0;
          const nextItemState = updateReasoningItemField(
            state,
            threadId,
            payload.turnId,
            payload.itemId,
            "summary",
            summaryIndex,
            payload.delta,
          );

          return {
            ...nextItemState,
            unreadThreadIds,
          };
        }

        case "item/reasoning/textDelta": {
          if (!threadId || !payload || typeof payload.turnId !== "string" || typeof payload.itemId !== "string") {
            return state;
          }

          const contentIndex = typeof payload.contentIndex === "number" ? payload.contentIndex : 0;
          const nextItemState = updateReasoningItemField(
            state,
            threadId,
            payload.turnId,
            payload.itemId,
            "content",
            contentIndex,
            payload.delta,
          );

          return {
            ...nextItemState,
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
    name: next.name ?? previous.name,
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

type TurnStateUpdate = Pick<
  AppStore,
  "turnsById" | "turnOrderByThreadId" | "activeTurnIdByThreadId" | "nonSteerableThreadIds"
>;

type ItemCollections = Pick<AppStore, "turnsById" | "turnOrderByThreadId" | "itemsById" | "itemOrderByTurnId">;

type PlaceholderStringField = "text" | "aggregatedOutput" | "summaryText";
type ReasoningField = "summary" | "content";

function createTurnStateUpdate(state: TurnStateUpdate, threadId: string, turn: Turn): TurnStateUpdate {
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

function prepareItemCollections(
  state: ItemCollections,
  threadId: string,
  turnId: string,
  itemId: string,
): ItemCollections {
  const turnsById = { ...state.turnsById };
  const turnOrderByThreadId = { ...state.turnOrderByThreadId };
  const itemsById = { ...state.itemsById };
  const itemOrderByTurnId = { ...state.itemOrderByTurnId };

  ensureTurn(turnsById, turnId);
  ensureOrderedId(turnOrderByThreadId, threadId, turnId);
  ensureOrderedId(itemOrderByTurnId, turnId, itemId);

  return {
    turnsById,
    turnOrderByThreadId,
    itemsById,
    itemOrderByTurnId,
  };
}

function appendPlaceholderItemDelta(
  state: ItemCollections,
  threadId: string,
  turnId: string,
  itemId: string,
  type: string,
  field: PlaceholderStringField,
  delta: unknown,
): ItemCollections {
  const nextState = prepareItemCollections(state, threadId, turnId, itemId);
  const current = ensurePlaceholderItem(nextState.itemsById, itemId, type);

  nextState.itemsById[itemId] = {
    ...current,
    [field]: `${asString((current as Record<string, unknown>)[field])}${asString(delta)}`,
  };

  return nextState;
}

function updateReasoningItemField(
  state: ItemCollections,
  threadId: string,
  turnId: string,
  itemId: string,
  field: ReasoningField,
  index: number,
  delta?: unknown,
): ItemCollections {
  const nextState = prepareItemCollections(state, threadId, turnId, itemId);
  const current = ensurePlaceholderItem(nextState.itemsById, itemId, "reasoning");
  const values = normalizeStringArray((current as unknown as Record<ReasoningField, unknown>)[field]);

  ensureStringIndex(values, index);
  if (delta !== undefined) {
    values[index] = `${values[index]}${asString(delta)}`;
  }

  nextState.itemsById[itemId] = {
    ...current,
    [field]: values,
  };

  return nextState;
}

function ensureStringIndex(values: string[], index: number): void {
  while (values.length <= index) {
    values.push("");
  }
}
