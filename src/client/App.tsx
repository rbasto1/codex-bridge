import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { useShallow } from "zustand/react/shallow";

import {
  ApiError,
  fetchEnvHome,
  fetchInit,
  fetchProjectState,
  interruptTurn,
  listAvailableModels,
  listAllThreads,
  readThread,
  generateThreadName,
  renameThread,
  respondToServerRequest,
  restartServer,
  resumeThread,
  saveProjectIcon,
  saveProjectState,
  startThread,
  startTurn,
  steerTurn,
  type ModelOption,
  type ThreadResponse,
  type ThreadSessionResponse,
} from "./api";
import { useAppStore } from "./store";
import {
  createTextInput,
  isRecord,
  type ApprovalPolicy,
  type BrowserEvent,
  type BrowserServerRequest,
  type CollaborationModeKind,
  type ReasoningEffort,
  type SandboxPolicy,
  type ThreadItem,
  type ThreadSessionConfig,
  type UserInput,
} from "../shared/codex.js";
import codexLogoUrl from "../../codex.svg";

const STORAGE_KEY = "codex-web-local-ui";

type PersistedUi = {
  activeThreadId?: string | null;
  activeMode?: "replay" | "live";
  currentProject?: string;
  customProjects?: string[];
  threadControlDrafts?: Record<string, ComposerControlDraft>;
  threadPermissionBaselines?: Record<string, PermissionBaseline>;
};

type ComposerControlDraft = {
  mode: CollaborationModeKind;
  model: string;
  effort: ReasoningEffort | null;
  fullAccess: boolean;
};

type ModelChoice = Pick<ModelOption, "displayName" | "model">;

type PermissionBaseline = {
  approvalPolicy: ApprovalPolicy;
  sandbox: SandboxPolicy;
};

export default function App() {
  const initialUi = readPersistedUi();
  const {
    activeThreadId,
    backendStatus,
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
    setThreadSessionConfig,
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
      setThreadSessionConfig: state.setThreadSessionConfig,
      updateThreadName: state.updateThreadName,
    })),
  );

  const currentThread = useAppStore((state) =>
    state.activeThreadId ? state.threadsById[state.activeThreadId] ?? null : null,
  );
  const currentThreadSessionConfig = useAppStore((state) =>
    state.activeThreadId ? state.threadSessionConfigById[state.activeThreadId] ?? null : null,
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

  const isMobile = () => window.innerWidth < 768;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobile);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((v) => !v), []);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const focusComposerAfterLoadRef = useRef(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [currentProject, setCurrentProject] = useState(initialUi.currentProject ?? "");
  const [customProjects, setCustomProjects] = useState<string[]>(initialUi.customProjects ?? []);
  const [projectDraft, setProjectDraft] = useState(initialUi.currentProject ?? "");
  const [renameDraft, setRenameDraft] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
  const [threadControlDrafts, setThreadControlDrafts] = useState<Record<string, ComposerControlDraft>>(
    initialUi.threadControlDrafts ?? {},
  );
  const [threadPermissionBaselines, setThreadPermissionBaselines] = useState<Record<string, PermissionBaseline>>(
    initialUi.threadPermissionBaselines ?? {},
  );
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [threadLoadingId, setThreadLoadingId] = useState<string | null>(null);
  const [isStartingThread, setIsStartingThread] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [composerBusy, setComposerBusy] = useState(false);
  const [respondingRequestKey, setRespondingRequestKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectionRestored, setSelectionRestored] = useState(false);
  const [envHome, setEnvHome] = useState("");
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [addProjectDraft, setAddProjectDraft] = useState("");
  const [hiddenProjects, setHiddenProjects] = useState<string[]>([]);
  const [showHiddenProjects, setShowHiddenProjects] = useState(false);
  const [contextMenuProject, setContextMenuProject] = useState<{ project: string; x: number; y: number } | null>(null);
  const [showEditProjectModal, setShowEditProjectModal] = useState<string | null>(null);
  const [projectIcons, setProjectIcons] = useState<Record<string, string>>({});
  const [projectState, setProjectState] = useState<Array<{ id: string; name: string }>>([]);
  const [projectRenameDraft, setProjectRenameDraft] = useState("");
  const longPressTimerRef = useRef<number | null>(null);

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
  const composerControlDraft = activeThreadId ? threadControlDrafts[activeThreadId] ?? null : null;
  const modelChoices = composerControlDraft ? listModelChoices(availableModels, composerControlDraft.model) : [];
  const selectedModel = composerControlDraft ? findModelOption(availableModels, composerControlDraft.model) : null;
  const reasoningOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const isLive = currentMode === "live";
  const waitingOnUserAction = currentWaitingFlags.includes("waitingOnApproval") || currentWaitingFlags.includes("waitingOnUserInput");
  const canCompose = Boolean(currentThread && isLive && backendStatus === "ready" && !waitingOnUserAction && !isCurrentThreadNonSteerable);
  const isStreaming = Boolean(activeTurnId) && !waitingOnUserAction;
  const composerControlsDisabled = !currentThread || !isLive || Boolean(activeTurnId) || modelsLoading;

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

    void (async () => {
      try {
        const home = await fetchEnvHome();
        if (!cancelled) {
          setEnvHome(home);
        }
      } catch {
        // non-critical
      }
    })();

    void (async () => {
      try {
        const state = await fetchProjectState();
        if (!cancelled) {
          setProjectState(state.projects ?? []);
          setProjectIcons(state.icons ?? {});
        }
      } catch {
        // non-critical
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
    if (backendStatus !== "ready") {
      return;
    }

    let cancelled = false;

    void (async () => {
      setModelsLoading(true);
      try {
        const models = await listAvailableModels();
        if (!cancelled) {
          setAvailableModels(models);
        }
      } catch (error) {
        if (!cancelled) {
          setActionError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [backendStatus]);

  useEffect(() => {
    if (!currentThread) {
      setRenameDraft("");
      setIsEditingTitle(false);
      return;
    }

    setRenameDraft(currentThread.name ?? currentThread.preview);
    setIsEditingTitle(false);
  }, [currentThread]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isEditingTitle]);

  useEffect(() => {
    if (projectOptions.length === 0) {
      return;
    }

    if (currentProject && projectOptions.includes(currentProject)) {
      return;
    }

    const fallbackProject = projectOptions[0];
    setCurrentProject(fallbackProject);
    if (!projectDraft.trim()) {
      setProjectDraft(fallbackProject);
    }
  }, [currentProject, projectDraft, projectOptions]);

  useEffect(() => {
    if (!focusComposerAfterLoadRef.current || !currentThread || !isLive) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });

    focusComposerAfterLoadRef.current = false;

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [currentThread, isLive]);

  useEffect(() => {
    if (!activeThreadId || !currentThreadSessionConfig || isDangerFullAccess(currentThreadSessionConfig.sandbox)) {
      return;
    }

    setThreadPermissionBaselines((previous) => {
      const currentBaseline = previous[activeThreadId];
      if (
        currentBaseline &&
        currentBaseline.approvalPolicy === currentThreadSessionConfig.approvalPolicy &&
        JSON.stringify(currentBaseline.sandbox) === JSON.stringify(currentThreadSessionConfig.sandbox)
      ) {
        return previous;
      }

      return {
        ...previous,
        [activeThreadId]: {
          approvalPolicy: currentThreadSessionConfig.approvalPolicy,
          sandbox: currentThreadSessionConfig.sandbox,
        },
      };
    });
  }, [activeThreadId, currentThreadSessionConfig]);

  useEffect(() => {
    if (!activeThreadId || !currentThread) {
      return;
    }

    setThreadControlDrafts((previous) => {
      if (previous[activeThreadId]) {
        return previous;
      }

      const nextDraft = createComposerControlDraft(currentThreadSessionConfig, availableModels);
      if (!nextDraft) {
        return previous;
      }

      return {
        ...previous,
        [activeThreadId]: nextDraft,
      };
    });
  }, [activeThreadId, availableModels, currentThread, currentThreadSessionConfig]);

  useEffect(() => {
    writePersistedUi({
      activeThreadId,
      activeMode: activeThreadId ? currentMode : undefined,
      currentProject,
      customProjects,
      threadControlDrafts,
      threadPermissionBaselines,
    });
  }, [activeThreadId, currentMode, currentProject, customProjects, threadControlDrafts, threadPermissionBaselines]);

  useEffect(() => {
    if (selectionRestored || threadOrder.length === 0) {
      return;
    }

    setSelectionRestored(true);

    const hashThreadId = window.location.hash.replace(/^#/, "") || null;
    const restoreThreadId = (hashThreadId && threadsById[hashThreadId]) ? hashThreadId : initialUi.activeThreadId;

    if (restoreThreadId && threadsById[restoreThreadId]) {
      const threadId = restoreThreadId;
      const mode = (hashThreadId && hashThreadId === threadId) ? "live" : (initialUi.activeMode ?? "replay");

      void (async () => {
        setThreadLoadingId(threadId);
        setActionError(null);
        setSelectedThreadError(null);

        try {
          const response = mode === "live" ? await resumeThread(threadId) : await readThread(threadId);
          startTransition(() => {
            hydrateThread(response.thread, mode, extractThreadSessionConfig(response));
          });
          window.history.replaceState(null, "", `#${threadId}`);
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

    if (isMobile()) {
      setSidebarCollapsed(true);
    }

    try {
      const response = mode === "live" ? await resumeThread(threadId) : await readThread(threadId);
      if (mode === "live") {
        focusComposerAfterLoadRef.current = true;
      }
      startTransition(() => {
        hydrateThread(response.thread, mode, extractThreadSessionConfig(response));
      });
      window.history.replaceState(null, "", `#${threadId}`);
    } catch (error) {
      const message = getErrorMessage(error);
      setSelectedThreadError(message);
      setActionError(message);
    } finally {
      setThreadLoadingId(null);
    }
  }

  function handleAddProject() {
    let resolved = addProjectDraft.trim();
    if (!resolved) {
      return;
    }

    if (resolved.startsWith("~") && envHome) {
      resolved = envHome + resolved.slice(1);
    }

    setCustomProjects((previous) => (previous.includes(resolved) ? previous : [...previous, resolved]));
    setAddProjectDraft("");
    setShowAddProjectModal(false);
    handleSelectProject(resolved);
  }

  function handleRemoveProject(project: string) {
    setCustomProjects((previous) => previous.filter((p) => p !== project));
    if (currentProject === project) {
      const remaining = projectOptions.filter((p) => p !== project);
      setCurrentProject(remaining[0] ?? "");
      setProjectDraft(remaining[0] ?? "");
    }
  }

  function handleSelectProject(project: string) {
    if (project === currentProject) return;
    setCurrentProject(project);
    setProjectDraft(project);
    // Auto-select most recent session for this project (task 7)
    const firstThread = threadOrder.find((tid) => threadsById[tid]?.cwd === project);
    if (firstThread) {
      void openThread(firstThread, "live");
    } else {
      useAppStore.getState().setActiveThread(null);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  function handleHideProject(project: string) {
    setHiddenProjects((previous) => (previous.includes(project) ? previous : [...previous, project]));
    if (currentProject === project) {
      const remaining = projectOptions.filter((p) => p !== project && !hiddenProjects.includes(p));
      setCurrentProject(remaining[0] ?? "");
      setProjectDraft(remaining[0] ?? "");
    }
  }

  function handleUnhideProject(project: string) {
    setHiddenProjects((previous) => previous.filter((p) => p !== project));
  }

  function handleMoveProject(project: string, direction: -1 | 1) {
    const idx = visibleProjects.indexOf(project);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= visibleProjects.length) return;
    const reordered = [...visibleProjects];
    [reordered[idx], reordered[targetIdx]] = [reordered[targetIdx], reordered[idx]];
    // Persist order in projectState
    setProjectState((prev) => {
      const next = reordered.map((p) => {
        const existing = prev.find((e) => e.id === p);
        return existing || { id: p, name: "" };
      });
      persistProjectState(next, projectIcons);
      return next;
    });
  }

  function handleSaveProjectEdit() {
    if (!showEditProjectModal) return;
    const project = showEditProjectModal;
    const projectId = encodeProjectId(project);

    // Save name
    setProjectState((prev) => {
      const next = [...prev];
      const idx = next.findIndex((e) => e.id === project);
      const entry = { id: project, name: projectRenameDraft.trim() };
      if (idx >= 0) {
        next[idx] = entry;
      } else {
        next.push(entry);
      }
      persistProjectState(next, projectIcons);
      return next;
    });

    // Save icon
    const icon = projectIcons[projectId] || "";
    void saveProjectIcon(projectId, icon);

    setShowEditProjectModal(null);
  }

  function persistProjectState(projects: Array<{ id: string; name: string }>, icons: Record<string, string>) {
    void saveProjectState({ projects, icons });
  }

  const visibleProjectsUnordered = projectOptions.filter((p) => !hiddenProjects.includes(p));
  // Respect saved order from projectState
  const visibleProjects = (() => {
    if (projectState.length === 0) return visibleProjectsUnordered;
    const ordered: string[] = [];
    for (const entry of projectState) {
      if (visibleProjectsUnordered.includes(entry.id)) {
        ordered.push(entry.id);
      }
    }
    for (const p of visibleProjectsUnordered) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    return ordered;
  })();
  const overflowProjects = projectOptions.filter((p) => hiddenProjects.includes(p));

  function projectHasSessions(project: string): boolean {
    return threadOrder.some((tid) => threadsById[tid]?.cwd === project);
  }

  async function handleStartThread() {
    const cwd = currentProject.trim();
    if (!cwd) {
      setActionError("Choose a project path before starting a thread.");
      return;
    }

    setIsStartingThread(true);
    setActionError(null);

    try {
      const response = await startThread(cwd);
      focusComposerAfterLoadRef.current = true;
      setCurrentProject(cwd);
      setCustomProjects((previous) => (previous.includes(cwd) ? previous : [...previous, cwd]));
      startTransition(() => {
        hydrateThread(response.thread, "live", extractThreadSessionConfig(response));
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

    const originalTitle = currentThread.name ?? currentThread.preview;
    const nextName = renameDraft.trim();
    if (!nextName) {
      setRenameDraft(originalTitle);
      setIsEditingTitle(false);
      return;
    }

    if (nextName === originalTitle) {
      setIsEditingTitle(false);
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
      setRenameDraft(originalTitle);
      setActionError(getErrorMessage(error));
    } finally {
      setIsRenaming(false);
      setIsEditingTitle(false);
    }
  }

  function handleCancelRenameThread() {
    if (!currentThread) {
      return;
    }

    setRenameDraft(currentThread.name ?? currentThread.preview);
    setIsEditingTitle(false);
  }

  async function handleSubmitComposer() {
    if (!activeThreadId || !currentThread || !composerControlDraft) {
      return;
    }

    const text = composerValue.trim();
    if (!text) {
      return;
    }

    const permissionBaseline = resolvePermissionBaseline(threadPermissionBaselines[activeThreadId], currentThreadSessionConfig);
    const nextThreadSessionConfig = buildThreadSessionConfig(
      currentThread.cwd,
      composerControlDraft,
      permissionBaseline,
      findModelOption(availableModels, composerControlDraft.model),
    );

    setComposerBusy(true);
    setActionError(null);

    try {
      if (activeTurnId) {
        await steerTurn(activeThreadId, activeTurnId, [createTextInput(text)]);
      } else {
        const response = await startTurn(activeThreadId, [createTextInput(text)], {
          approvalPolicy: nextThreadSessionConfig.approvalPolicy,
          sandboxPolicy: nextThreadSessionConfig.sandbox,
          collaborationMode: {
            mode: composerControlDraft.mode,
            settings: {
              model: nextThreadSessionConfig.model,
              reasoning_effort: nextThreadSessionConfig.reasoningEffort,
              developer_instructions: null,
            },
          },
        });
        startTransition(() => {
          noteTurn(activeThreadId, response.turn);
          markNonSteerable(activeThreadId, false);
          setThreadSessionConfig(activeThreadId, nextThreadSessionConfig);
        });

        // Auto-generate session name on first turn (fire-and-forget).
        if (!currentThread.name) {
          generateThreadName(activeThreadId, text).then(
            (result) => {
              if (result.name) {
                updateThreadName(activeThreadId, result.name);
              }
            },
            () => {/* silent — name generation is best-effort */},
          );
        }
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

  function updateCurrentThreadControls(updater: (current: ComposerControlDraft) => ComposerControlDraft) {
    if (!activeThreadId || !composerControlDraft) {
      return;
    }

    setThreadControlDrafts((previous) => ({
      ...previous,
      [activeThreadId]: updater(previous[activeThreadId] ?? composerControlDraft),
    }));
  }

  function handleSelectComposerMode(mode: CollaborationModeKind) {
    updateCurrentThreadControls((current) => ({
      ...current,
      mode,
    }));
  }

  function handleSelectComposerModel(model: string) {
    const modelOption = findModelOption(availableModels, model);
    updateCurrentThreadControls((current) => ({
      ...current,
      model,
      effort: normalizeReasoningEffort(modelOption, current.effort),
    }));
  }

  function handleSelectComposerEffort(effort: ReasoningEffort) {
    updateCurrentThreadControls((current) => ({
      ...current,
      effort,
    }));
  }

  function handleToggleFullAccess() {
    updateCurrentThreadControls((current) => ({
      ...current,
      fullAccess: !current.fullAccess,
    }));
  }

  const sidebarProjectLabel = (() => {
    if (!currentProject) return "Codex Web";
    const stateEntry = projectState.find((e) => e.id === currentProject);
    if (stateEntry?.name) return stateEntry.name;
    return currentProject.split("/").filter(Boolean).pop() ?? "Codex Web";
  })();

  return (
    <div className="app-shell">
      {/* Mobile backdrop */}
      <button
        type="button"
        className={`sidebar-backdrop ${sidebarCollapsed ? "hidden" : ""}`}
        onClick={() => setSidebarCollapsed(true)}
      />

      {/* Floating toggle when sidebar hidden */}
      {sidebarCollapsed ? (
        <button type="button" className="floating-toggle" onClick={toggleSidebar} title="Open sidebar">
          &#9776;
        </button>
      ) : null}

      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="project-rail">
          <div className="project-rail-brand" title="Codex Web">
            <img src={codexLogoUrl} alt="" className="project-rail-brand-logo" />
          </div>
          <div className="project-rail-list">
            {visibleProjects.map((project) => {
              const projectId = encodeProjectId(project);
              const displayIcon = projectIcons[projectId];
              const stateEntry = projectState.find((e) => e.id === project);
              const label = stateEntry?.name || formatProjectTileLabel(project);
              return (
                <div key={project} className="project-tile-wrapper">
                  <button
                    type="button"
                    className={`project-tile ${project === currentProject ? "active" : ""}`}
                    onClick={() => handleSelectProject(project)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenuProject({ project, x: e.clientX, y: e.clientY });
                    }}
                    onTouchStart={() => {
                      longPressTimerRef.current = window.setTimeout(() => {
                        const el = document.querySelector(`[data-project="${CSS.escape(project)}"]`);
                        const rect = el?.getBoundingClientRect();
                        setContextMenuProject({ project, x: (rect?.right ?? 64) + 4, y: rect?.top ?? 0 });
                      }, 500);
                    }}
                    onTouchEnd={() => { if (longPressTimerRef.current) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } }}
                    onTouchMove={() => { if (longPressTimerRef.current) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } }}
                    title={project}
                    data-project={project}
                  >
                    {displayIcon || label}
                  </button>
                </div>
              );
            })}
            {overflowProjects.length > 0 ? (
              <div className="project-tile-wrapper">
                <button
                  type="button"
                  className={`project-tile ${showHiddenProjects ? "active" : ""}`}
                  onClick={() => setShowHiddenProjects((v) => !v)}
                  title="Show hidden projects"
                >
                  &#x2026;
                </button>
                {showHiddenProjects ? (
                  <div className="project-overflow-menu">
                    {overflowProjects.map((project) => (
                      <button
                        key={project}
                        type="button"
                        className="project-overflow-item"
                        onClick={() => {
                          handleUnhideProject(project);
                          handleSelectProject(project);
                          setShowHiddenProjects(false);
                        }}
                        title={project}
                      >
                        {formatProjectTileLabel(project)} <span className="project-overflow-path">{project.split("/").filter(Boolean).pop()}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="project-tile project-tile-add"
              onClick={() => setShowAddProjectModal(true)}
              title="Add project"
            >
              +
            </button>
          </div>
        </div>

        <div className="sidebar-panel">
          <div className="sidebar-header">
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 className="sidebar-title">{sidebarProjectLabel}</h1>
            </div>
            <button type="button" className="sidebar-toggle" onClick={toggleSidebar} title="Collapse sidebar">
              &#x2190;
            </button>
          </div>

          <button
            type="button"
            className="sidebar-new-session"
            onClick={() => void handleStartThread()}
            disabled={backendStatus !== "ready" || isStartingThread}
          >
            {isStartingThread ? "Starting..." : "New Session"}
          </button>

          <input
            className="sidebar-search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search sessions..."
          />

          <div className="sidebar-stats">
            <span>{listLoading ? "Loading..." : `${filteredThreadIds.length} sessions`}</span>
          </div>

          <div className="session-list">
            {filteredThreadIds.map((threadId) => (
              <SessionRow
                key={threadId}
                threadId={threadId}
                active={threadId === activeThreadId}
                onOpen={() => void openThread(threadId, "live")}
              />
            ))}
            {!listLoading && filteredThreadIds.length === 0 ? (
              <div className="empty-card small-empty">No sessions match the current project.</div>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="workspace">
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
                      <span className={`thread-status-dot ${currentThread.status.type === "active" ? "running" : "idle"}`} />
                      {isEditingTitle ? (
                        <input
                          ref={titleInputRef}
                          className="thread-title-input"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => void handleRenameThread()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleRenameThread();
                            }

                            if (event.key === "Escape") {
                              event.preventDefault();
                              handleCancelRenameThread();
                            }
                          }}
                          placeholder={currentThread.preview || currentThread.id}
                          disabled={isRenaming}
                        />
                      ) : (
                        <button
                          type="button"
                          className="thread-title-button"
                          onClick={() => setIsEditingTitle(true)}
                          title={renameDraft || currentThread.preview || currentThread.id}
                        >
                          {renameDraft || currentThread.preview || currentThread.id}
                        </button>
                      )}
                    </div>

                    <div className="thread-meta-row">
                      <span className={`badge ${isLive ? "badge-live" : "badge-replay"}`}>{isLive ? "Live attached" : "Replay only"}</span>
                      <span className="badge">{formatSessionSource(currentThread.source)}</span>
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

                <div className="workspace-scroll">
                  <div className="workspace-column">
                    <TranscriptView
                      threadId={currentThread.id}
                      respondingRequestKey={respondingRequestKey}
                      onRespond={handleRespondToRequest}
                    />
                  </div>
                </div>

                <section className="composer-shell">
                  <div className="workspace-column">
                    <div className="composer-input-shell">
                      <textarea
                        ref={composerInputRef}
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
                      <button
                        type="button"
                        className="composer-submit-button"
                        disabled={isStreaming ? !isLive : !canCompose || composerBusy || !composerValue.trim()}
                        onClick={() => {
                          if (isStreaming) {
                            void handleInterruptTurn();
                            return;
                          }

                          void handleSubmitComposer();
                        }}
                        title={isStreaming ? "Stop turn" : "Send"}
                        aria-label={isStreaming ? "Stop turn" : "Send"}
                      >
                        {isStreaming ? (
                          <svg fill="none" viewBox="0 0 20 20" width="16" height="16"><rect x="5" y="5" width="10" height="10" fill="currentColor"/></svg>
                        ) : (
                          <svg fill="none" viewBox="0 0 20 20" width="16" height="16"><path fillRule="evenodd" clipRule="evenodd" d="M9.99991 2.24121L16.0921 8.33343L15.2083 9.21731L10.6249 4.63397V17.5001H9.37492V4.63398L4.7916 9.21731L3.90771 8.33343L9.99991 2.24121Z" fill="currentColor"/></svg>
                        )}
                      </button>
                    </div>
                    {composerControlDraft ? (
                      <div className="composer-control-row" aria-label="Composer settings">
                        <div className="composer-mode-toggle" role="group" aria-label="Mode">
                          <button
                            type="button"
                            className={`composer-mode-button ${composerControlDraft.mode === "default" ? "active" : ""}`}
                            onClick={() => handleSelectComposerMode("default")}
                            disabled={composerControlsDisabled}
                          >
                            Build
                          </button>
                          <button
                            type="button"
                            className={`composer-mode-button ${composerControlDraft.mode === "plan" ? "active" : ""}`}
                            onClick={() => handleSelectComposerMode("plan")}
                            disabled={composerControlsDisabled}
                          >
                            Plan
                          </button>
                        </div>

                        <div className="composer-select-shell composer-model-select-shell">
                          <select
                            className="select-input composer-control-select"
                            value={composerControlDraft.model}
                            onChange={(event) => handleSelectComposerModel(event.target.value)}
                            disabled={composerControlsDisabled || modelChoices.length === 0}
                            aria-label="Model"
                          >
                            {modelChoices.length === 0 ? (
                              <option value="">{modelsLoading ? "Loading models..." : "No models available"}</option>
                            ) : null}
                            {modelChoices.map((model) => (
                              <option key={model.model} value={model.model}>
                                {model.displayName}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="composer-select-shell composer-effort-select-shell">
                          <select
                            className="select-input composer-control-select"
                            value={composerControlDraft.effort ?? ""}
                            onChange={(event) => handleSelectComposerEffort(event.target.value as ReasoningEffort)}
                            disabled={composerControlsDisabled || reasoningOptions.length === 0}
                            aria-label="Reasoning effort"
                          >
                            {reasoningOptions.length === 0 ? (
                              <option value="">{selectedModel ? "No reasoning options" : "Select a model"}</option>
                            ) : null}
                            {reasoningOptions.map((option) => (
                              <option key={option.reasoningEffort} value={option.reasoningEffort}>
                                {formatReasoningEffort(option.reasoningEffort)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          className={`composer-permission-button ${composerControlDraft.fullAccess ? "active" : ""}`}
                          onClick={handleToggleFullAccess}
                          disabled={composerControlsDisabled}
                          title={composerControlDraft.fullAccess ? "Permissions: full access" : "Permissions: standard access"}
                          aria-label={composerControlDraft.fullAccess ? "Permissions: full access" : "Permissions: standard access"}
                          aria-pressed={composerControlDraft.fullAccess}
                        >
                          <PermissionShieldIcon active={composerControlDraft.fullAccess} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              <section className="empty-state">
                <div className="empty-card">
                  <p className="eyebrow">No session selected</p>
                  <h2>Start a new thread or open a saved one.</h2>
                </div>
              </section>
            )}
      </main>

      {/* Project context menu */}
      {contextMenuProject ? (
        <div className="context-menu-backdrop" onClick={() => setContextMenuProject(null)}>
          <div
            className="context-menu"
            style={{ top: contextMenuProject.y, left: contextMenuProject.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {projectHasSessions(contextMenuProject.project) ? (
              <button type="button" className="context-menu-item" onClick={() => {
                handleHideProject(contextMenuProject.project);
                setContextMenuProject(null);
              }}>
                Hide
              </button>
            ) : (
              <button type="button" className="context-menu-item danger" onClick={() => {
                handleRemoveProject(contextMenuProject.project);
                setContextMenuProject(null);
              }}>
                Delete
              </button>
            )}
            <button type="button" className="context-menu-item" onClick={() => {
              const proj = contextMenuProject.project;
              const stateEntry = projectState.find((e) => e.id === proj);
              setProjectRenameDraft(stateEntry?.name || proj.split("/").filter(Boolean).pop() || "");
              setShowEditProjectModal(proj);
              setContextMenuProject(null);
            }}>
              Edit
            </button>
            {visibleProjects.indexOf(contextMenuProject.project) > 0 ? (
              <button type="button" className="context-menu-item" onClick={() => {
                handleMoveProject(contextMenuProject.project, -1);
                setContextMenuProject(null);
              }}>
                Move up
              </button>
            ) : null}
            {visibleProjects.indexOf(contextMenuProject.project) < visibleProjects.length - 1 ? (
              <button type="button" className="context-menu-item" onClick={() => {
                handleMoveProject(contextMenuProject.project, 1);
                setContextMenuProject(null);
              }}>
                Move down
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Edit project modal (icon picker + rename) */}
      {showEditProjectModal ? (
        <div className="modal-backdrop" onClick={() => setShowEditProjectModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Edit project</h3>
            <label className="field-label">Display name</label>
            <input
              className="text-input"
              autoFocus
              value={projectRenameDraft}
              onChange={(e) => setProjectRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleSaveProjectEdit(); }
                if (e.key === "Escape") { e.preventDefault(); setShowEditProjectModal(null); }
              }}
              placeholder="Project name"
            />
            <label className="field-label" style={{ marginTop: 12 }}>Icon (emoji or 2 characters)</label>
            <div className="icon-picker-grid">
              {["📁", "🚀", "🔧", "📦", "🎨", "🔬", "💡", "🌐", "🛠️", "📊", "🎯", "⚡", "🐛", "📝", "🔒", "🏠", "💻", "🎮", "📱", "🧪"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`icon-picker-item ${projectIcons[encodeProjectId(showEditProjectModal)] === emoji ? "active" : ""}`}
                  onClick={() => {
                    const id = encodeProjectId(showEditProjectModal);
                    setProjectIcons((prev) => ({ ...prev, [id]: emoji }));
                  }}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                className={`icon-picker-item ${!projectIcons[encodeProjectId(showEditProjectModal)] ? "active" : ""}`}
                onClick={() => {
                  const id = encodeProjectId(showEditProjectModal);
                  setProjectIcons((prev) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                  });
                }}
              >
                Aa
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="button primary" onClick={handleSaveProjectEdit}>Save</button>
              <button type="button" className="button secondary" onClick={() => setShowEditProjectModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {showAddProjectModal ? (
        <div className="modal-backdrop" onClick={() => setShowAddProjectModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Add project</h3>
            <input
              className="text-input"
              autoFocus
              value={addProjectDraft}
              onChange={(e) => setAddProjectDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleAddProject(); }
                if (e.key === "Escape") { e.preventDefault(); setShowAddProjectModal(false); }
              }}
              placeholder="/path/to/project or ~/project"
            />
            <div className="modal-actions">
              <button type="button" className="button primary" onClick={handleAddProject} disabled={!addProjectDraft.trim()}>Add</button>
              <button type="button" className="button secondary" onClick={() => setShowAddProjectModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SessionRow(props: {
  threadId: string;
  active: boolean;
  onOpen: () => void;
}) {
  const { threadId, active, onOpen } = props;
  const thread = useAppStore((state) => state.threadsById[threadId]);

  if (!thread) {
    return null;
  }

  const isRunning = thread.status.type === "active";

  return (
    <button
      type="button"
      className={`session-row ${active ? "active" : ""}`}
      onClick={onOpen}
      title={thread.cwd}
    >
      <span className={`session-indicator ${isRunning ? "running" : "idle"}`} />
      <div className="session-info">
        <span className="session-name">{thread.name?.trim() || thread.preview || thread.id}</span>
        <span className="session-meta">{formatRelativeTime(thread.updatedAt)}</span>
      </div>
    </button>
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

  const itemLabel = formatItemLabel(item.type);

  return (
    <div className={`item-card item-${item.type}`}>
      {itemLabel ? (
        <div className="item-header">
          <span className="eyebrow">{itemLabel}</span>
        </div>
      ) : null}

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
    case "reasoning": {
      const summaryLines = normalizeStringArray(item.summary);
      const contentLines = normalizeStringArray(item.content);
      const firstLine = summaryLines[0] || contentLines[0] || "";
      const hasMore = summaryLines.length > 1 || contentLines.length > 0;
      return (
        <div className="reasoning-block">
          {firstLine ? <p className="reasoning-first-line">{firstLine}</p> : null}
          {hasMore ? (
            <details className="collapsible-block">
              <summary className="collapsible-summary">more reasoning</summary>
              {summaryLines.length > 1 ? (
                <ul className="reasoning-summary">
                  {summaryLines.slice(1).map((entry) => (
                    <li key={`${item.id}-summary-${entry}`}>{entry}</li>
                  ))}
                </ul>
              ) : null}
              {contentLines.length > 0 ? (
                <div className="markdown-shell">
                  {contentLines.map((entry) => (
                    <p key={`${item.id}-content-${entry}`}>{entry}</p>
                  ))}
                </div>
              ) : null}
            </details>
          ) : null}
        </div>
      );
    }
    case "plan":
      return <pre className="plain-block">{asString(item.text)}</pre>;
    case "commandExecution":
      return (
        <details className="collapsible-block">
          <summary className="collapsible-summary"><span className="collapsible-command">{asString(item.command) || "(command)"}</span></summary>
          <div className="tool-block" style={{ marginTop: 6 }}>
            <p className="approval-meta">cwd: {asString(item.cwd)}</p>
            {asString(item.aggregatedOutput) ? <pre className="plain-block">{asString(item.aggregatedOutput)}</pre> : null}
          </div>
        </details>
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
                    borderRadius: 6,
                    background: "#101010",
                    border: "1px solid #282828",
                    padding: "8px 12px",
                    fontSize: "13px",
                    lineHeight: "150%",
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

function PermissionShieldIcon(props: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="composer-permission-icon">
      <path
        d="M8 1.5 13 3.4v3.7c0 3-2 5.7-5 7.4-3-1.7-5-4.4-5-7.4V3.4L8 1.5Z"
        fill={props.active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M5.8 7.8 7.3 9.3 10.4 6.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function extractThreadSessionConfig(response: ThreadResponse | ThreadSessionResponse): ThreadSessionConfig | null {
  if (!("approvalPolicy" in response) || !("cwd" in response) || !("model" in response) || !("sandbox" in response)) {
    return null;
  }

  return {
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: response.reasoningEffort,
    approvalPolicy: response.approvalPolicy,
    sandbox: response.sandbox,
  };
}

function createComposerControlDraft(
  sessionConfig: ThreadSessionConfig | null,
  models: ModelOption[],
): ComposerControlDraft | null {
  const fallbackModel = sessionConfig?.model ?? models.find((model) => model.isDefault)?.model ?? models[0]?.model;
  if (!fallbackModel) {
    return null;
  }

  const modelOption = findModelOption(models, fallbackModel);
  return {
    mode: "default",
    model: fallbackModel,
    effort: normalizeReasoningEffort(modelOption, sessionConfig?.reasoningEffort ?? null),
    fullAccess: isDangerFullAccess(sessionConfig?.sandbox),
  };
}

function listModelChoices(models: ModelOption[], selectedModel: string): ModelChoice[] {
  if (models.some((model) => model.model === selectedModel)) {
    return models.map((model) => ({
      displayName: model.displayName,
      model: model.model,
    }));
  }

  return [
    {
      displayName: selectedModel,
      model: selectedModel,
    },
    ...models.map((model) => ({
      displayName: model.displayName,
      model: model.model,
    })),
  ];
}

function findModelOption(models: ModelOption[], model: string | null | undefined): ModelOption | null {
  if (!model) {
    return null;
  }

  return models.find((entry) => entry.model === model) ?? null;
}

function normalizeReasoningEffort(model: ModelOption | null, effort: ReasoningEffort | null): ReasoningEffort | null {
  if (!model) {
    return effort;
  }

  if (effort && model.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort)) {
    return effort;
  }

  return model.defaultReasoningEffort;
}

function resolvePermissionBaseline(baseline: PermissionBaseline | undefined, sessionConfig: ThreadSessionConfig | null): PermissionBaseline {
  if (baseline) {
    return baseline;
  }

  if (sessionConfig && !isDangerFullAccess(sessionConfig.sandbox)) {
    return {
      approvalPolicy: sessionConfig.approvalPolicy,
      sandbox: sessionConfig.sandbox,
    };
  }

  return {
    approvalPolicy: "on-request",
    sandbox: {
      type: "workspaceWrite",
      writableRoots: [],
      readOnlyAccess: {
        type: "fullAccess",
      },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

function buildThreadSessionConfig(
  cwd: string,
  controls: ComposerControlDraft,
  permissionBaseline: PermissionBaseline,
  model: ModelOption | null,
): ThreadSessionConfig {
  return {
    cwd,
    model: controls.model,
    reasoningEffort: normalizeReasoningEffort(model, controls.effort),
    approvalPolicy: controls.fullAccess ? "never" : permissionBaseline.approvalPolicy,
    sandbox: controls.fullAccess ? { type: "dangerFullAccess" } : permissionBaseline.sandbox,
  };
}

function isDangerFullAccess(sandbox: SandboxPolicy | null | undefined): boolean {
  return sandbox?.type === "dangerFullAccess";
}

function formatReasoningEffort(effort: ReasoningEffort): string {
  return effort === "xhigh" ? "X-High" : effort[0].toUpperCase() + effort.slice(1);
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

function formatRelativeTime(timestampSeconds: number) {
  const now = Date.now();
  const diff = now - timestampSeconds * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(timestampSeconds * 1000),
  );
}

function formatItemLabel(type: string) {
  if (type === "userMessage" || type === "agentMessage" || type === "commandExecution") {
    return "";
  }

  return type.replace(/([A-Z])/g, " $1").toLowerCase();
}

function encodeProjectId(project: string): string {
  return btoa(project).replace(/[/+=]/g, "_");
}

function formatProjectTileLabel(project: string) {
  const baseName = project.split("/").filter(Boolean).pop() ?? project;
  const parts = baseName.split(/[^a-zA-Z0-9]+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }

  return baseName.slice(0, 2).toUpperCase();
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
