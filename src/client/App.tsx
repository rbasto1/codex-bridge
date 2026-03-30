import { startTransition, useDeferredValue, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { useShallow } from "zustand/react/shallow";

import {
  ApiError,
  fetchInit,
  interruptTurn,
  listAllThreads,
  readThread,
  renameThread,
  respondToServerRequest,
  restartServer,
  resumeThread,
  startThread,
  startTurn,
  steerTurn,
} from "./api";
import { useAppStore } from "./store";
import { createTextInput, isRecord, type BrowserEvent, type BrowserServerRequest, type ThreadItem, type UserInput } from "../shared/codex.js";

const STORAGE_KEY = "codex-web-local-ui";

type PersistedUi = {
  activeThreadId?: string | null;
  activeMode?: "replay" | "live";
  currentProject?: string;
  customProjects?: string[];
};

export default function App() {
  const initialUi = readPersistedUi();
  const {
    activeThreadId,
    backendStatus,
    initializeResponse,
    lastExit,
    pendingServerRequestsById,
    selectedThreadError,
    stderrTail,
    threadOrder,
    threadsById,
  } = useAppStore(
    useShallow((state) => ({
      activeThreadId: state.activeThreadId,
      backendStatus: state.backendStatus,
      initializeResponse: state.initializeResponse,
      lastExit: state.lastExit,
      pendingServerRequestsById: state.pendingServerRequestsById,
      selectedThreadError: state.selectedThreadError,
      stderrTail: state.stderrTail,
      threadOrder: state.threadOrder,
      threadsById: state.threadsById,
    })),
  );

  const {
    applyNotification,
    hydrateThread,
    markNonSteerable,
    noteTurn,
    putServerRequest,
    replaceThreads,
    setSelectedThreadError,
    setSnapshot,
    updateThreadName,
  } = useAppStore(
    useShallow((state) => ({
      applyNotification: state.applyNotification,
      hydrateThread: state.hydrateThread,
      markNonSteerable: state.markNonSteerable,
      noteTurn: state.noteTurn,
      putServerRequest: state.putServerRequest,
      replaceThreads: state.replaceThreads,
      setSelectedThreadError: state.setSelectedThreadError,
      setSnapshot: state.setSnapshot,
      updateThreadName: state.updateThreadName,
    })),
  );

  const currentThread = useAppStore((state) =>
    state.activeThreadId ? state.threadsById[state.activeThreadId] ?? null : null,
  );
  const currentMode = useAppStore((state) =>
    state.activeThreadId ? state.threadModes[state.activeThreadId] ?? "replay" : "replay",
  );
  const activeTurnId = useAppStore((state) =>
    state.activeThreadId ? state.activeTurnIdByThreadId[state.activeThreadId] ?? null : null,
  );
  const currentWaitingFlags = useAppStore((state) => {
    const thread = state.activeThreadId ? state.threadsById[state.activeThreadId] : null;
    return thread?.status.type === "active" ? thread.status.activeFlags : [];
  });
  const isCurrentThreadNonSteerable = useAppStore((state) =>
    state.activeThreadId ? Boolean(state.nonSteerableThreadIds[state.activeThreadId]) : false,
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [currentProject, setCurrentProject] = useState(initialUi.currentProject ?? "");
  const [customProjects, setCustomProjects] = useState<string[]>(initialUi.customProjects ?? []);
  const [projectDraft, setProjectDraft] = useState(initialUi.currentProject ?? "");
  const [renameDraft, setRenameDraft] = useState("");
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
  const [listLoading, setListLoading] = useState(false);
  const [threadLoadingId, setThreadLoadingId] = useState<string | null>(null);
  const [isStartingThread, setIsStartingThread] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [composerBusy, setComposerBusy] = useState(false);
  const [respondingRequestKey, setRespondingRequestKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectionRestored, setSelectionRestored] = useState(false);

  const deferredSearchTerm = useDeferredValue(searchTerm.trim().toLowerCase());

  const projectOptions = Array.from(
    new Set(
      [...customProjects, ...Object.values(threadsById).map((thread) => thread.cwd)].filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  const filteredThreadIds = threadOrder.filter((threadId) => {
    const thread = threadsById[threadId];
    if (!thread) {
      return false;
    }

    if (currentProject && thread.cwd !== currentProject) {
      return false;
    }

    if (!deferredSearchTerm) {
      return true;
    }

    const haystack = [thread.name ?? "", thread.preview, thread.cwd].join(" ").toLowerCase();
    return haystack.includes(deferredSearchTerm);
  });

  const composerValue = activeThreadId ? composerDrafts[activeThreadId] ?? "" : "";
  const isLive = currentMode === "live";
  const waitingOnUserAction = currentWaitingFlags.includes("waitingOnApproval") || currentWaitingFlags.includes("waitingOnUserInput");
  const canCompose = Boolean(currentThread && isLive && backendStatus === "ready" && !waitingOnUserAction && !isCurrentThreadNonSteerable);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await fetchInit();
        if (!cancelled) {
          setSnapshot(snapshot);
        }
      } catch (error) {
        if (!cancelled) {
          setActionError(getErrorMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setSnapshot]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/events`);

      socket.onmessage = (messageEvent) => {
        const event = safeSocketEvent(messageEvent.data);
        if (!event) {
          return;
        }

        if (event.type === "snapshot" || event.type === "backendStatus") {
          useAppStore.getState().setSnapshot(event.payload);
          return;
        }

        if (event.type === "notification") {
          useAppStore.getState().applyNotification(event.method, event.params);
          return;
        }

        useAppStore.getState().putServerRequest(event.request);
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }

        retryTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      active = false;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      socket?.close();
    };
  }, []);

  useEffect(() => {
    if (backendStatus !== "ready") {
      return;
    }

    let cancelled = false;

    void (async () => {
      setListLoading(true);
      try {
        const threads = await listAllThreads();
        if (!cancelled) {
          startTransition(() => {
            replaceThreads(threads);
          });
        }
      } catch (error) {
        if (!cancelled) {
          setActionError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setListLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [backendStatus, replaceThreads]);

  useEffect(() => {
    if (!currentThread) {
      setRenameDraft("");
      return;
    }

    setRenameDraft(currentThread.name ?? currentThread.preview);
  }, [currentThread]);

  useEffect(() => {
    writePersistedUi({
      activeThreadId,
      activeMode: activeThreadId ? currentMode : undefined,
      currentProject,
      customProjects,
    });
  }, [activeThreadId, currentMode, currentProject, customProjects]);

  useEffect(() => {
    if (selectionRestored || threadOrder.length === 0) {
      return;
    }

    setSelectionRestored(true);

    if (initialUi.activeThreadId && threadsById[initialUi.activeThreadId]) {
      const threadId = initialUi.activeThreadId;
      const mode = initialUi.activeMode ?? "replay";

      void (async () => {
        setThreadLoadingId(threadId);
        setActionError(null);
        setSelectedThreadError(null);

        try {
          const response = mode === "live" ? await resumeThread(threadId) : await readThread(threadId);
          startTransition(() => {
            hydrateThread(response.thread, mode);
          });
        } catch (error) {
          const message = getErrorMessage(error);
          setSelectedThreadError(message);
          setActionError(message);
        } finally {
          setThreadLoadingId(null);
        }
      })();
    }
  }, [hydrateThread, initialUi.activeMode, initialUi.activeThreadId, selectionRestored, setSelectedThreadError, threadOrder.length, threadsById]);

  async function openThread(threadId: string, mode: "replay" | "live") {
    setThreadLoadingId(threadId);
    setActionError(null);
    setSelectedThreadError(null);

    try {
      const response = mode === "live" ? await resumeThread(threadId) : await readThread(threadId);
      startTransition(() => {
        hydrateThread(response.thread, mode);
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setSelectedThreadError(message);
      setActionError(message);
    } finally {
      setThreadLoadingId(null);
    }
  }

  async function handleTrackProject() {
    const nextProject = projectDraft.trim();
    if (!nextProject) {
      return;
    }

    setCurrentProject(nextProject);
    setCustomProjects((previous) => (previous.includes(nextProject) ? previous : [...previous, nextProject]));
  }

  async function handleStartThread() {
    const cwd = projectDraft.trim() || currentProject.trim();
    if (!cwd) {
      setActionError("Choose a project path before starting a thread.");
      return;
    }

    setIsStartingThread(true);
    setActionError(null);

    try {
      const response = await startThread(cwd);
      setCurrentProject(cwd);
      setCustomProjects((previous) => (previous.includes(cwd) ? previous : [...previous, cwd]));
      startTransition(() => {
        hydrateThread(response.thread, "live");
      });
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsStartingThread(false);
    }
  }

  async function handleRenameThread() {
    if (!currentThread) {
      return;
    }

    const nextName = renameDraft.trim();
    if (!nextName || nextName === currentThread.name) {
      return;
    }

    setIsRenaming(true);
    setActionError(null);

    try {
      await renameThread(currentThread.id, nextName);
      startTransition(() => {
        updateThreadName(currentThread.id, nextName);
      });
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleSubmitComposer() {
    if (!activeThreadId || !currentThread) {
      return;
    }

    const text = composerValue.trim();
    if (!text) {
      return;
    }

    setComposerBusy(true);
    setActionError(null);

    try {
      if (activeTurnId) {
        await steerTurn(activeThreadId, activeTurnId, [createTextInput(text)]);
      } else {
        const response = await startTurn(activeThreadId, [createTextInput(text)]);
        startTransition(() => {
          noteTurn(activeThreadId, response.turn);
          markNonSteerable(activeThreadId, false);
        });
      }

      setComposerDrafts((previous) => ({
        ...previous,
        [activeThreadId]: "",
      }));
    } catch (error) {
      if (activeThreadId && looksNonSteerable(error)) {
        startTransition(() => {
          markNonSteerable(activeThreadId, true);
        });
      }

      setActionError(getErrorMessage(error));
    } finally {
      setComposerBusy(false);
    }
  }

  async function handleInterruptTurn() {
    if (!activeThreadId || !activeTurnId) {
      return;
    }

    setActionError(null);

    try {
      await interruptTurn(activeThreadId, activeTurnId);
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  async function handleRespondToRequest(request: BrowserServerRequest, body: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) {
    setRespondingRequestKey(request.key);
    setActionError(null);

    try {
      await respondToServerRequest({
        requestId: request.requestId,
        ...body,
      });
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setRespondingRequestKey(null);
    }
  }

  async function handleRestartServer() {
    setActionError(null);

    try {
      const snapshot = await restartServer();
      setSnapshot(snapshot);
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <p className="eyebrow">Local control surface</p>
          <h1>Codex Web</h1>
          <p className="brand-copy">
            One browser client, one long-lived local backend, and the real `codex app-server` session history.
          </p>
        </div>

        <div className="control-block">
          <label className="field-label" htmlFor="session-search">
            Search sessions
          </label>
          <input
            id="session-search"
            className="text-input"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="name, preview, cwd"
          />
        </div>

        <div className="session-stats">
          <span>{listLoading ? "Loading sessions..." : `${filteredThreadIds.length} sessions`}</span>
          <span>{initializeResponse?.codexHome ?? "App-server not ready"}</span>
        </div>

        <div className="session-list">
          {filteredThreadIds.map((threadId) => (
            <SessionRow
              key={threadId}
              threadId={threadId}
              active={threadId === activeThreadId}
              loading={threadLoadingId === threadId}
              onOpenReplay={() => void openThread(threadId, "replay")}
              onOpenLive={() => void openThread(threadId, "live")}
            />
          ))}
          {!listLoading && filteredThreadIds.length === 0 ? (
            <div className="empty-card small-empty">No sessions match the current filter.</div>
          ) : null}
        </div>
      </aside>

      <main className="workspace">
        <header className="project-bar">
          <div className="project-bar-group">
            <label className="field-label" htmlFor="project-filter">
              Project filter
            </label>
            <select
              id="project-filter"
              className="select-input"
              value={currentProject}
              onChange={(event) => {
                setCurrentProject(event.target.value);
                if (event.target.value) {
                  setProjectDraft(event.target.value);
                }
              }}
            >
              <option value="">All projects</option>
              {projectOptions.map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
            </select>
          </div>

          <div className="project-bar-group project-input-group">
            <label className="field-label" htmlFor="project-path">
              Open project
            </label>
            <input
              id="project-path"
              className="text-input"
              list="known-projects"
              value={projectDraft}
              onChange={(event) => setProjectDraft(event.target.value)}
              placeholder="/absolute/path/to/project"
            />
            <datalist id="known-projects">
              {projectOptions.map((project) => (
                <option key={project} value={project} />
              ))}
            </datalist>
          </div>

          <div className="project-actions">
            <button type="button" className="button secondary" onClick={() => void handleTrackProject()}>
              Track project
            </button>
            <button
              type="button"
              className="button primary"
              onClick={() => void handleStartThread()}
              disabled={backendStatus !== "ready" || isStartingThread}
            >
              {isStartingThread ? "Starting..." : "New thread"}
            </button>
          </div>
        </header>

        {backendStatus !== "ready" ? (
          <section className="banner warning-banner">
            <div>
              <strong>Backend status:</strong> {backendStatus}
              {lastExit ? ` (exit code ${String(lastExit.code)}, signal ${String(lastExit.signal)})` : ""}
            </div>
            <button type="button" className="button secondary" onClick={() => void handleRestartServer()}>
              Restart app-server
            </button>
            {stderrTail.length > 0 ? (
              <pre className="stderr-tail">{stderrTail.slice(-10).join("\n")}</pre>
            ) : null}
          </section>
        ) : null}

        {actionError ? <section className="banner error-banner">{actionError}</section> : null}
        {selectedThreadError ? <section className="banner error-banner">{selectedThreadError}</section> : null}

        {currentThread ? (
          <>
            <section className="thread-header">
              <div className="thread-header-main">
                <div className="thread-title-row">
                  <input
                    className="thread-title-input"
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    placeholder={currentThread.preview || currentThread.id}
                  />
                  <button type="button" className="button secondary" disabled={isRenaming} onClick={() => void handleRenameThread()}>
                    {isRenaming ? "Saving..." : "Rename"}
                  </button>
                </div>

                <div className="thread-meta-row">
                  <span className={`badge ${isLive ? "badge-live" : "badge-replay"}`}>{isLive ? "Live attached" : "Replay only"}</span>
                  <span className="badge">{formatThreadStatus(currentThread.status)}</span>
                  <span className="badge">{formatSessionSource(currentThread.source)}</span>
                  <span className="badge muted">{currentThread.cwd}</span>
                </div>
              </div>

              <div className="thread-header-actions">
                <button type="button" className="button secondary" onClick={() => void openThread(currentThread.id, "replay")}>
                  Refresh replay
                </button>
                <button type="button" className="button primary" onClick={() => void openThread(currentThread.id, "live")} disabled={threadLoadingId === currentThread.id}>
                  {isLive ? "Live attached" : threadLoadingId === currentThread.id ? "Attaching..." : "Resume live"}
                </button>
              </div>
            </section>

            {activeTurnId && !waitingOnUserAction ? (
              <section className="banner info-banner">The active turn is running. New composer submits will steer the current turn.</section>
            ) : null}
            {waitingOnUserAction ? (
              <section className="banner info-banner">Resolve the pending approval or tool input before sending more guidance.</section>
            ) : null}
            {isCurrentThreadNonSteerable ? (
              <section className="banner info-banner">The active turn is not steerable. Wait for it to finish before sending another turn.</section>
            ) : null}

            <TranscriptView
              threadId={currentThread.id}
              respondingRequestKey={respondingRequestKey}
              onRespond={handleRespondToRequest}
            />

            <section className="composer-shell">
              <textarea
                className="composer-input"
                value={composerValue}
                onChange={(event) => {
                  if (!activeThreadId) {
                    return;
                  }

                  setComposerDrafts((previous) => ({
                    ...previous,
                    [activeThreadId]: event.target.value,
                  }));
                }}
                placeholder={isLive ? "Message Codex" : "Resume the thread live to continue the conversation"}
                disabled={!currentThread || !isLive}
              />

              <div className="composer-actions">
                <div className="composer-hint">
                  {activeTurnId ? "Composer will call `turn/steer`." : "Composer will call `turn/start`."}
                </div>
                <div className="composer-buttons">
                  <button type="button" className="button secondary" disabled={!activeTurnId || !isLive} onClick={() => void handleInterruptTurn()}>
                    Stop turn
                  </button>
                  <button type="button" className="button primary" disabled={!canCompose || composerBusy || !composerValue.trim()} onClick={() => void handleSubmitComposer()}>
                    {composerBusy ? "Sending..." : activeTurnId ? "Steer turn" : "Send turn"}
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="empty-state">
            <div className="empty-card">
              <p className="eyebrow">No session selected</p>
              <h2>Start a new thread or open a saved one.</h2>
              <p>
                Sessions are loaded from `{initializeResponse?.codexHome ?? "~/.codex"}` and keyed by the real Codex thread id.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function SessionRow(props: {
  threadId: string;
  active: boolean;
  loading: boolean;
  onOpenReplay: () => void;
  onOpenLive: () => void;
}) {
  const { threadId, active, loading, onOpenReplay, onOpenLive } = props;
  const thread = useAppStore((state) => state.threadsById[threadId]);
  const mode = useAppStore((state) => state.threadModes[threadId]);

  if (!thread) {
    return null;
  }

  return (
    <div className={`session-row ${active ? "active" : ""}`}>
      <button type="button" className="session-main" onClick={onOpenReplay}>
        <div className="session-main-head">
          <span className="session-name">{thread.name?.trim() || thread.preview || thread.id}</span>
          <span className="session-updated">{formatTimestamp(thread.updatedAt)}</span>
        </div>
        <div className="session-main-body">
          <span className="session-path">{thread.cwd}</span>
          <span className="session-id">{thread.id}</span>
        </div>
        <div className="session-main-foot">
          <span className="badge muted">{formatThreadStatus(thread.status)}</span>
          <span className="badge muted">{mode === "live" ? "live" : "replay"}</span>
        </div>
      </button>
      <button type="button" className="session-live-button" onClick={onOpenLive} disabled={loading}>
        {loading ? "..." : "Live"}
      </button>
    </div>
  );
}

function TranscriptView(props: {
  threadId: string;
  respondingRequestKey: string | null;
  onRespond: (request: BrowserServerRequest, body: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) => Promise<void>;
}) {
  const { threadId, respondingRequestKey, onRespond } = props;
  const turnIds = useAppStore((state) => state.turnOrderByThreadId[threadId] ?? []);
  const threadRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter((request) => request.threadId === threadId && !request.turnId),
  );

  return (
    <section className="transcript-pane">
      {turnIds.length === 0 && threadRequests.length === 0 ? (
        <div className="empty-card small-empty">No turns yet. This thread is ready for the first message.</div>
      ) : null}

      {turnIds.map((turnId) => (
        <TurnBlock
          key={turnId}
          threadId={threadId}
          turnId={turnId}
          respondingRequestKey={respondingRequestKey}
          onRespond={onRespond}
        />
      ))}

      {threadRequests.map((request) => (
        <ApprovalCard
          key={request.key}
          request={request}
          disabled={respondingRequestKey === request.key}
          onRespond={onRespond}
        />
      ))}
    </section>
  );
}

function TurnBlock(props: {
  threadId: string;
  turnId: string;
  respondingRequestKey: string | null;
  onRespond: (request: BrowserServerRequest, body: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) => Promise<void>;
}) {
  const { threadId, turnId, respondingRequestKey, onRespond } = props;
  const turn = useAppStore((state) => state.turnsById[turnId]);
  const itemIds = useAppStore((state) => state.itemOrderByTurnId[turnId] ?? []);
  const turnRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter(
      (request) => request.threadId === threadId && request.turnId === turnId && !request.itemId,
    ),
  );
  const orphanItemRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter(
      (request) =>
        request.threadId === threadId &&
        request.turnId === turnId &&
        Boolean(request.itemId) &&
        !itemIds.includes(request.itemId as string),
    ),
  );

  return (
    <div className="turn-card">
      <div className="turn-header">
        <span className="eyebrow">Turn {turnId}</span>
        <span className="badge muted">{turn?.status ?? "inProgress"}</span>
      </div>

      <div className="turn-items">
        {itemIds.map((itemId) => (
          <TranscriptItemCard
            key={itemId}
            threadId={threadId}
            turnId={turnId}
            itemId={itemId}
            respondingRequestKey={respondingRequestKey}
            onRespond={onRespond}
          />
        ))}

        {turnRequests.map((request) => (
          <ApprovalCard
            key={request.key}
            request={request}
            disabled={respondingRequestKey === request.key}
            onRespond={onRespond}
          />
        ))}

        {orphanItemRequests.map((request) => (
          <ApprovalCard
            key={request.key}
            request={request}
            disabled={respondingRequestKey === request.key}
            onRespond={onRespond}
          />
        ))}
      </div>
    </div>
  );
}

function TranscriptItemCard(props: {
  threadId: string;
  turnId: string;
  itemId: string;
  respondingRequestKey: string | null;
  onRespond: (request: BrowserServerRequest, body: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) => Promise<void>;
}) {
  const { threadId, turnId, itemId, respondingRequestKey, onRespond } = props;
  const item = useAppStore((state) => state.itemsById[itemId]);
  const itemRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter(
      (request) => request.threadId === threadId && request.turnId === turnId && request.itemId === itemId,
    ),
  );

  if (!item) {
    return null;
  }

  return (
    <div className={`item-card item-${item.type}`}>
      <div className="item-header">
        <span className="eyebrow">{formatItemType(item.type)}</span>
      </div>

      <div className="item-body">{renderItemBody(item)}</div>

      {itemRequests.map((request) => (
        <ApprovalCard
          key={request.key}
          request={request}
          disabled={respondingRequestKey === request.key}
          onRespond={onRespond}
          relatedItem={item}
        />
      ))}
    </div>
  );
}

function ApprovalCard(props: {
  request: BrowserServerRequest;
  disabled: boolean;
  onRespond: (request: BrowserServerRequest, body: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) => Promise<void>;
  relatedItem?: ThreadItem;
}) {
  const { request, disabled, onRespond, relatedItem } = props;
  const [toolAnswers, setToolAnswers] = useState<Record<string, string>>({});

  if (request.method === "item/commandExecution/requestApproval") {
    const params = request.params ?? {};
    return (
      <div className="approval-card">
        <div className="approval-header">
          <span className="eyebrow">Command approval</span>
          <span className="badge danger">pending</span>
        </div>
        <p className="approval-copy">{asString(params.reason) || "Codex wants to run a command."}</p>
        <pre className="code-slab">{asString(params.command) || "(command unavailable)"}</pre>
        <p className="approval-meta">cwd: {asString(params.cwd) || "unknown"}</p>
        <div className="approval-actions">
          <button type="button" className="button primary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "accept" } })}>
            Accept
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "decline" } })}>
            Decline
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "cancel" } })}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (request.method === "item/fileChange/requestApproval") {
    const paths = extractFileChangePaths(relatedItem);
    return (
      <div className="approval-card">
        <div className="approval-header">
          <span className="eyebrow">File change approval</span>
          <span className="badge danger">pending</span>
        </div>
        <p className="approval-copy">{asString(request.params?.reason) || "Codex wants to apply file changes."}</p>
        <p className="approval-meta">{paths.length > 0 ? paths.join("\n") : "No file summary was available."}</p>
        <div className="approval-actions">
          <button type="button" className="button primary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "accept" } })}>
            Accept
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "decline" } })}>
            Decline
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={() => void onRespond(request, { result: { decision: "cancel" } })}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (request.method === "item/permissions/requestApproval") {
    const requestedPermissions = request.params?.permissions;
    return (
      <div className="approval-card">
        <div className="approval-header">
          <span className="eyebrow">Permission approval</span>
          <span className="badge danger">pending</span>
        </div>
        <p className="approval-copy">{asString(request.params?.reason) || "Codex requested additional permissions."}</p>
        <pre className="code-slab">{JSON.stringify(requestedPermissions ?? {}, null, 2)}</pre>
        <div className="approval-actions">
          <button
            type="button"
            className="button primary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                result: {
                  permissions: requestedPermissions ?? {},
                  scope: "turn",
                },
              })
            }
          >
            Accept
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                result: {
                  permissions: {},
                  scope: "turn",
                },
              })
            }
          >
            Decline
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                error: {
                  code: -32001,
                  message: "User cancelled the permission request.",
                },
              })
            }
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (request.method === "item/tool/requestUserInput") {
    const questions = Array.isArray(request.params?.questions) ? request.params.questions : [];

    return (
      <div className="approval-card">
        <div className="approval-header">
          <span className="eyebrow">Tool input</span>
          <span className="badge danger">pending</span>
        </div>
        <div className="tool-question-list">
          {questions.map((question, index) => {
            if (!isRecord(question) || typeof question.id !== "string") {
              return null;
            }

            const questionId = question.id;
            const options = Array.isArray(question.options) ? question.options : null;
            const isSecret = Boolean(question.isSecret);
            const value = toolAnswers[questionId] ?? "";

            return (
              <div className="tool-question" key={questionId}>
                <span className="field-label">{asString(question.header) || `Question ${index + 1}`}</span>
                <span className="tool-question-copy">{asString(question.question)}</span>
                {options && options.length > 0 && !question.isOther ? (
                  <select
                    id={`${request.key}-${questionId}`}
                    className="select-input"
                    value={value}
                    onChange={(event) =>
                      setToolAnswers((previous) => ({
                        ...previous,
                        [questionId]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select an option</option>
                    {options.map((option, optionIndex) =>
                      isRecord(option) && typeof option.label === "string" ? (
                        <option key={`${questionId}-${option.label}`} value={option.label}>
                          {option.label}
                        </option>
                      ) : null,
                    )}
                  </select>
                ) : (
                  <input
                    id={`${request.key}-${questionId}`}
                    className="text-input"
                    type={isSecret ? "password" : "text"}
                    value={value}
                    onChange={(event) =>
                      setToolAnswers((previous) => ({
                        ...previous,
                        [questionId]: event.target.value,
                      }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="approval-actions">
          <button
            type="button"
            className="button primary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                result: {
                  answers: Object.fromEntries(
                    questions
                      .map((question) => (isRecord(question) && typeof question.id === "string" ? question.id : null))
                      .filter((questionId): questionId is string => Boolean(questionId))
                      .map((questionId) => [questionId, { answers: toolAnswers[questionId] ? [toolAnswers[questionId]] : [] }]),
                  ),
                },
              })
            }
          >
            Send input
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              void onRespond(request, {
                error: {
                  code: -32001,
                  message: "User cancelled the tool input request.",
                },
              })
            }
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="approval-card unsupported-card">
      <div className="approval-header">
        <span className="eyebrow">Unsupported request</span>
        <span className="badge danger">fallback</span>
      </div>
      <p className="approval-copy">{request.method}</p>
      <pre className="code-slab">{JSON.stringify(request.params ?? {}, null, 2)}</pre>
      <div className="approval-actions">
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={() =>
            void onRespond(request, {
              error: {
                code: -32001,
                message: `Unsupported client request: ${request.method}`,
              },
            })
          }
        >
          Respond unsupported
        </button>
      </div>
    </div>
  );
}

function renderItemBody(item: ThreadItem) {
  switch (item.type) {
    case "userMessage":
      return <div className="markdown-shell"><p>{renderUserInputs(item.content)}</p></div>;
    case "agentMessage":
      return <MarkdownBlock text={asString(item.text)} />;
    case "reasoning":
      return (
        <div className="reasoning-block">
          {normalizeStringArray(item.summary).length > 0 ? (
            <ul className="reasoning-summary">
              {normalizeStringArray(item.summary).map((entry, index) => (
                <li key={`${item.id}-summary-${entry}`}>{entry}</li>
              ))}
            </ul>
          ) : null}
          {normalizeStringArray(item.content).length > 0 ? (
            <details>
              <summary>Detailed reasoning</summary>
              <div className="markdown-shell">
                {normalizeStringArray(item.content).map((entry, index) => (
                  <p key={`${item.id}-content-${entry}`}>{entry}</p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      );
    case "plan":
      return <pre className="plain-block">{asString(item.text)}</pre>;
    case "commandExecution":
      return (
        <div className="tool-block">
          <pre className="code-slab">{asString(item.command)}</pre>
          <p className="approval-meta">cwd: {asString(item.cwd)}</p>
          {asString(item.aggregatedOutput) ? <pre className="plain-block">{asString(item.aggregatedOutput)}</pre> : null}
        </div>
      );
    case "fileChange":
      return (
        <div className="tool-block">
          {extractFileChangePaths(item).length > 0 ? (
            <ul className="reasoning-summary">
              {extractFileChangePaths(item).map((path) => (
                <li key={`${item.id}-${path}`}>{path}</li>
              ))}
            </ul>
          ) : null}
          {asString(item.summaryText) ? <pre className="plain-block">{asString(item.summaryText)}</pre> : null}
        </div>
      );
    case "enteredReviewMode":
    case "exitedReviewMode":
      return <p>{asString(item.review)}</p>;
    case "contextCompaction":
      return <p>Context compaction was recorded for this turn.</p>;
    default:
      return <pre className="code-slab">{JSON.stringify(item, null, 2)}</pre>;
  }
}

function MarkdownBlock(props: { text: string }) {
  return (
    <div className="markdown-shell">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...rest }: any) {
            const match = /language-(\w+)/.exec(className ?? "");
            if (!inline && match) {
              return (
                <SyntaxHighlighter
                  {...rest}
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: 16,
                    background: "#11151d",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }

            return <code className={className}>{children}</code>;
          },
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => (typeof entry === "string" ? entry : ""));
}

function renderUserInputs(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((input) => renderUserInput(input as UserInput))
    .filter(Boolean)
    .join("\n");
}

function renderUserInput(input: UserInput): string {
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

function extractFileChangePaths(item: ThreadItem | undefined): string[] {
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

function formatThreadStatus(status: { type: string; activeFlags?: string[] }) {
  if (status.type !== "active") {
    return status.type;
  }

  return status.activeFlags && status.activeFlags.length > 0
    ? `active · ${status.activeFlags.join(", ")}`
    : "active";
}

function formatSessionSource(source: unknown): string {
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

function formatTimestamp(timestampSeconds: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampSeconds * 1000));
}

function formatItemType(type: string) {
  return type.replace(/([A-Z])/g, " $1").toLowerCase();
}

function safeSocketEvent(raw: string): BrowserEvent | null {
  try {
    return JSON.parse(raw) as BrowserEvent;
  } catch {
    return null;
  }
}

function readPersistedUi(): PersistedUi {
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

function writePersistedUi(value: PersistedUi) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore localStorage failures in private or restricted environments.
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function looksNonSteerable(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  return error.message.toLowerCase().includes("steerable");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
