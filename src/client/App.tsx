import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  generateThreadName,
  interruptTurn,
  readThread,
  renameThread,
  respondToServerRequest,
  restartServer,
  resumeThread,
  startThread,
  startTurn,
  steerTurn,
} from "./api";
import { playSessionCompleteSound } from "./sessionCompleteSound";
import { useAppStore } from "./store";
import { AuthModal } from "../components/AuthModal";
import {
  createTextInput,
  type BrowserServerRequest,
  type ThreadSessionConfig,
} from "../shared/codex.js";
import { ProjectSidebar } from "../components/ProjectSidebar";
import { ScrollViewport } from "../components/ScrollViewport";
import { ThreadComposer } from "../components/ThreadComposer";
import { ThreadHeader } from "../components/ThreadHeader";
import { ThreadPlanPanel } from "../components/ThreadPlanPanel";
import { TranscriptView } from "../components/TranscriptView";
import { useAuth } from "../hooks/useAuth";
import { useBackendInitialization } from "../hooks/useBackendInitialization";
import { useComposerState } from "../hooks/useComposerState";
import { usePersistedUi } from "../hooks/usePersistedUi";
import { useProjectManager } from "../hooks/useProjectManager";
import {
  buildThreadSessionConfig,
  extractThreadSessionConfig,
  findModelOption,
  resolvePermissionBaseline,
} from "../lib/composer";
import { getErrorMessage, looksNonSteerable } from "../lib/errors";
import { writePersistedUi } from "../lib/storage";
import { createUiDraftThread, createUiForkThread, isUiOnlyThread, renderUserInputs } from "../lib/threads";
import type { RequestResponseBody, ThreadMode } from "../types";

export default function App() {
  const initialUi = usePersistedUi();
  const hasPersistedUiRef = useRef(false);
  const openThreadRef = useRef<((threadId: string, mode: ThreadMode) => Promise<void>) | null>(null);

  const {
    activeThreadId,
    backendStatus,
    lastExit,
    selectedThreadError,
    stderrTail,
    threadOrder,
    threadsById,
  } = useAppStore(
    useShallow((state) => ({
      activeThreadId: state.activeThreadId,
      backendStatus: state.backendStatus,
      lastExit: state.lastExit,
      selectedThreadError: state.selectedThreadError,
      stderrTail: state.stderrTail,
      threadOrder: state.threadOrder,
      threadsById: state.threadsById,
    })),
  );

  const {
    hydrateThread,
    markNonSteerable,
    noteTurn,
    removeThread,
    replaceThreads,
    setActiveThread,
    setSelectedThreadError,
    setSnapshot,
    setThreadSessionConfig,
    updateThreadName,
  } = useAppStore(
    useShallow((state) => ({
      hydrateThread: state.hydrateThread,
      markNonSteerable: state.markNonSteerable,
      noteTurn: state.noteTurn,
      removeThread: state.removeThread,
      replaceThreads: state.replaceThreads,
      setActiveThread: state.setActiveThread,
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

  const [actionError, setActionError] = useState<string | null>(null);
  const [respondingRequestKey, setRespondingRequestKey] = useState<string | null>(null);
  const selectionRestoredRef = useRef(false);
  const [threadLoadingId, setThreadLoadingId] = useState<string | null>(null);
  const [draftThreadsRestored, setDraftThreadsRestored] = useState(false);
  const currentThreadIsUiDraft = isUiOnlyThread(currentThread);
  const { authBlocked, authBootstrapped, authError, submitAuthToken } = useAuth({
    clearErrors: () => {
      setActionError(null);
      setSelectedThreadError(null);
    },
  });

  const composer = useComposerState({
    activeThreadId,
    activeTurnId,
    backendStatus,
    currentMode,
    currentThread,
    currentThreadSessionConfig,
    currentWaitingFlags,
    initialUi,
    isCurrentThreadNonSteerable,
    setActionError,
  });

  const openThread = useCallback(async (threadId: string, mode: ThreadMode) => {
    const thread = useAppStore.getState().threadsById[threadId];
    if (isUiOnlyThread(thread)) {
      if (mode === "live" || composer.composerDrafts[threadId]?.trim()) {
        composer.focusComposer();
      }
      setActionError(null);
      setSelectedThreadError(null);
      startTransition(() => {
        hydrateThread(thread, mode, useAppStore.getState().threadSessionConfigById[threadId] ?? null);
      });
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    setThreadLoadingId(threadId);
    setActionError(null);
    setSelectedThreadError(null);

    try {
      const response = mode === "live" ? await resumeThread(threadId) : await readThread(threadId);
      if (mode === "live") {
        composer.focusComposer();
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
  }, [composer, hydrateThread, setSelectedThreadError]);

  useEffect(() => {
    openThreadRef.current = openThread;
  }, [openThread]);

  useEffect(() => {
    return useAppStore.subscribe((state, previousState) => {
      const threadIds = new Set([
        ...Object.keys(previousState.activeTurnIdByThreadId),
        ...Object.keys(state.activeTurnIdByThreadId),
      ]);

      for (const threadId of threadIds) {
        const previousActiveTurnId = previousState.activeTurnIdByThreadId[threadId] ?? null;
        const currentActiveTurnId = state.activeTurnIdByThreadId[threadId] ?? null;
        if (!previousActiveTurnId || currentActiveTurnId) {
          continue;
        }
        if (!state.liveAttachedThreadIds[threadId]) {
          continue;
        }

        const completedTurn = state.turnsById[previousActiveTurnId];
        if (completedTurn?.status !== "completed") {
          continue;
        }

        playSessionCompleteSound();
        break;
      }
    });
  }, []);

  const projectManager = useProjectManager({
    initialUi,
    onOpenThread: openThread,
    setActionError,
    setActiveThread,
    threadOrder,
    threadsById,
  });

  const { listLoading, threadsInitialized } = useBackendInitialization({
    backendStatus,
    enabled: authBootstrapped && !authBlocked,
    replaceThreads,
    setActionError,
    setSnapshot,
  });

  useEffect(() => {
    if (draftThreadsRestored) {
      return;
    }

    const uiDraftThreads = (initialUi.draftThreads ?? []).filter(isUiOnlyThread);
    if (uiDraftThreads.length > 0) {
      startTransition(() => {
        replaceThreads(uiDraftThreads);
      });
    }
    setDraftThreadsRestored(true);
  }, [draftThreadsRestored, initialUi.draftThreads, replaceThreads]);

  useEffect(() => {
    if (!hasPersistedUiRef.current) {
      hasPersistedUiRef.current = true;
      return;
    }

    const draftThreads = Object.values(threadsById).filter(isUiOnlyThread);
    writePersistedUi({
      activeThreadId,
      activeMode: activeThreadId ? currentMode : undefined,
      currentProject: projectManager.currentProject,
      customProjects: projectManager.customProjects,
      draftThreads,
      composerDrafts: composer.composerDrafts,
      defaultPermissionMode: composer.defaultPermissionMode,
      threadControlDrafts: composer.threadControlDrafts,
      threadPermissionBaselines: composer.threadPermissionBaselines,
    });
  }, [
    activeThreadId,
    composer.composerDrafts,
    composer.defaultPermissionMode,
    composer.threadControlDrafts,
    composer.threadPermissionBaselines,
    currentMode,
    projectManager.currentProject,
    projectManager.customProjects,
    threadsById,
  ]);

  useEffect(() => {
    if (selectionRestoredRef.current) {
      return;
    }

    const hashThreadId = window.location.hash.replace(/^#/, "") || null;
    const requestedThreadId = hashThreadId || initialUi.activeThreadId || null;
    if (!requestedThreadId) {
      if (threadOrder.length > 0) {
        selectionRestoredRef.current = true;
      }
      return;
    }

    if (!threadsById[requestedThreadId]) {
      if (!threadsInitialized) {
        return;
      }

      selectionRestoredRef.current = true;
      return;
    }

    selectionRestoredRef.current = true;

    if (threadsById[requestedThreadId]) {
      const mode: ThreadMode = hashThreadId && hashThreadId === requestedThreadId
        ? "live"
        : (initialUi.activeMode ?? "replay");
      void openThreadRef.current?.(requestedThreadId, mode);
    }
  }, [
    initialUi.activeMode,
    initialUi.activeThreadId,
    threadOrder.length,
    threadsInitialized,
    threadsById,
  ]);

  async function handleStartThread() {
    const cwd = projectManager.currentProject.trim();
    if (!cwd) {
      setActionError("Choose a project path before starting a thread.");
      return;
    }

    setActionError(null);
    setSelectedThreadError(null);
    composer.focusComposer();

    startTransition(() => {
      hydrateThread(createUiDraftThread(cwd), "live", null);
    });
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function handleRenameThread(name: string) {
    if (!currentThread) {
      return;
    }

    if (isUiOnlyThread(currentThread)) {
      startTransition(() => {
        updateThreadName(currentThread.id, name);
      });
      return;
    }

    setActionError(null);

    try {
      await renameThread(currentThread.id, name);
      startTransition(() => {
        updateThreadName(currentThread.id, name);
      });
    } catch (error) {
      setActionError(getErrorMessage(error));
      throw error;
    }
  }

  function handleForkMessage(threadId: string, turnId: string, itemId: string) {
    const state = useAppStore.getState();
    const sourceThread = state.threadsById[threadId];
    const sourceItem = state.itemsById[itemId];
    const turnOrder = state.turnOrderByThreadId[threadId] ?? [];
    const selectedTurnIndex = turnOrder.indexOf(turnId);
    const draftText = sourceItem?.type === "userMessage" ? renderUserInputs(sourceItem.content) : "";

    if (!sourceThread || selectedTurnIndex < 0 || !draftText.trim()) {
      return;
    }

    const forkedTurns = turnOrder.slice(0, selectedTurnIndex).map((sourceTurnId) => {
      const sourceTurn = state.turnsById[sourceTurnId];
      const itemIds = state.itemOrderByTurnId[sourceTurnId] ?? [];

      return {
        ...(sourceTurn ?? { id: sourceTurnId, status: "completed" as const, error: null }),
        items: itemIds
          .map((sourceItemId) => state.itemsById[sourceItemId])
          .filter(Boolean)
          .map((item) => ({ ...item })),
      };
    });
    const forkedThread = createUiForkThread(sourceThread, forkedTurns);
    const sourceSessionConfig = state.threadSessionConfigById[threadId] ?? null;

    setActionError(null);
    setSelectedThreadError(null);

    composer.copyScopedState(threadId, forkedThread.id);
    composer.setComposerDraft(forkedThread.id, draftText);
    startTransition(() => {
      hydrateThread(forkedThread, "replay", sourceSessionConfig);
    });
    composer.focusComposer();
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function handleSubmitComposer() {
    if (!activeThreadId || !currentThread || !composer.composerControlDraft) {
      return;
    }

    const text = composer.composerValue.trim();
    if (!text) {
      return;
    }

    const draftThreadId = activeThreadId;
    const isUiDraft = isUiOnlyThread(currentThread);
    const draftThreadName = currentThread.name?.trim() ?? "";
    const permissionBaseline = resolvePermissionBaseline(
      composer.threadPermissionBaselines[activeThreadId],
      currentThreadSessionConfig,
    );
    const nextThreadSessionConfig = buildThreadSessionConfig(
      currentThread.cwd,
      composer.composerControlDraft,
      permissionBaseline,
      findModelOption(composer.availableModels, composer.composerControlDraft.model),
    );
    let targetThreadId = activeThreadId;

    composer.setComposerBusy(true);
    setActionError(null);

    try {
      if (isUiDraft) {
        const response = await startThread(currentThread.cwd);
        targetThreadId = response.thread.id;

        composer.moveScopedState(draftThreadId, targetThreadId);

        startTransition(() => {
          hydrateThread(response.thread, "live", extractThreadSessionConfig(response));
          if (draftThreadName) {
            updateThreadName(targetThreadId, draftThreadName);
          }
          removeThread(draftThreadId);
        });

        if (draftThreadName) {
          void renameThread(targetThreadId, draftThreadName).catch(() => {
            // Keep the local draft title if persisting it fails.
          });
        }
      }

      if (activeTurnId && !isUiDraft) {
        await steerTurn(targetThreadId, activeTurnId, [createTextInput(text)]);
      } else {
        const response = await startTurn(targetThreadId, [createTextInput(text)], {
          approvalPolicy: nextThreadSessionConfig.approvalPolicy,
          sandboxPolicy: nextThreadSessionConfig.sandbox,
          collaborationMode: {
            mode: composer.composerControlDraft.mode,
            settings: {
              model: nextThreadSessionConfig.model,
              reasoning_effort: nextThreadSessionConfig.reasoningEffort,
              developer_instructions: null,
            },
          },
        });

        startTransition(() => {
          noteTurn(targetThreadId, response.turn);
          markNonSteerable(targetThreadId, false);
          setThreadSessionConfig(targetThreadId, nextThreadSessionConfig);
        });

        if (!draftThreadName) {
          generateThreadName(targetThreadId, text).then(
            (result) => {
              if (result.name) {
                updateThreadName(targetThreadId, result.name);
              }
            },
            () => {
              // Name generation is best-effort.
            },
          );
        }
      }

      composer.clearComposerDraft(targetThreadId, draftThreadId);
    } catch (error) {
      if (targetThreadId && looksNonSteerable(error)) {
        startTransition(() => {
          markNonSteerable(targetThreadId, true);
        });
      }

      setActionError(getErrorMessage(error));
    } finally {
      composer.setComposerBusy(false);
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

  function handleDeleteDraft() {
    if (!currentThread || !isUiOnlyThread(currentThread)) {
      return;
    }

    composer.removeScopedState(currentThread.id);
    startTransition(() => {
      removeThread(currentThread.id);
    });
  }

  async function handleRespondToRequest(request: BrowserServerRequest, body: RequestResponseBody) {
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
      <ProjectSidebar
        activeThreadId={activeThreadId}
        availableTags={projectManager.projectTags}
        backendStatus={backendStatus}
        currentProject={projectManager.currentProject}
        envHome={projectManager.envHome}
        hiddenProjects={projectManager.hiddenProjects}
        listLoading={listLoading}
        overflowProjects={projectManager.overflowProjects}
        projectIconVersions={projectManager.projectIconVersions}
        projectOptions={projectManager.projectOptions}
        projectState={projectManager.projectState}
        sessionStateByThreadId={projectManager.projectSessionStateByThreadId}
        threadOrder={threadOrder}
        threadsById={threadsById}
        visibleProjects={projectManager.visibleProjects}
        onAddProject={projectManager.addProject}
        onHideProject={projectManager.hideProject}
        onOpenThread={(threadId, mode) => void openThread(threadId, mode)}
        onRemoveProject={projectManager.removeProject}
        onRemoveProjectIcon={projectManager.removeProjectIcon}
        onReorderProjects={projectManager.reorderProjects}
        onSaveProjectName={projectManager.saveProjectName}
        onSelectProject={(project) => void projectManager.selectProject(project)}
        onStartThread={() => void handleStartThread()}
        onUnhideProject={projectManager.unhideProject}
        onUploadProjectIcon={projectManager.saveProjectIcon}
        onToggleThreadDone={projectManager.toggleThreadDone}
      />

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
            <ThreadHeader
              thread={currentThread}
              currentThreadIsUiDraft={currentThreadIsUiDraft}
              archived={Boolean(projectManager.projectSessionStateByThreadId[currentThread.id]?.archived)}
              availableTags={projectManager.projectTags}
              tags={projectManager.projectTags.filter((tag) => (
                projectManager.projectSessionStateByThreadId[currentThread.id]?.tags ?? []
              ).includes(tag.name))}
              onRename={handleRenameThread}
              onDeleteDraft={handleDeleteDraft}
              onToggleArchived={() => projectManager.toggleThreadArchived(currentThread.id)}
              onToggleTag={(tagName) => projectManager.toggleThreadTag(currentThread.id, tagName)}
              onCreateTag={projectManager.createTag}
            />

            {composer.waitingOnUserAction ? (
              <section className="banner info-banner">Resolve the pending approval or tool input before sending more guidance.</section>
            ) : null}

            {isCurrentThreadNonSteerable ? (
              <section className="banner info-banner">The active turn is not steerable. Wait for it to finish before sending another turn.</section>
            ) : null}

            <ScrollViewport key={currentThread.id} className="workspace-scroll">
              <div className="workspace-column">
                <ThreadPlanPanel threadId={currentThread.id} />
                <TranscriptView
                  threadId={currentThread.id}
                  respondingRequestKey={respondingRequestKey}
                  onForkMessage={handleForkMessage}
                  onRespond={handleRespondToRequest}
                />
              </div>
            </ScrollViewport>

            <ThreadComposer
              activeThreadId={activeThreadId}
              currentThread={currentThread}
              isLive={composer.isLive}
              composerValue={composer.composerValue}
              composerControlDraft={composer.composerControlDraft}
              composerAction={composer.composerAction}
              composerActionDisabled={composer.composerActionDisabled}
              composerControlsDisabled={composer.composerControlsDisabled}
              modelChoices={composer.modelChoices}
              modelsLoading={composer.modelsLoading}
              reasoningOptions={composer.reasoningOptions}
              selectedModel={composer.selectedModel}
              focusToken={composer.focusToken}
              onChangeComposer={composer.setComposerValue}
              onSubmit={() => void handleSubmitComposer()}
              onInterrupt={() => void handleInterruptTurn()}
              onSelectMode={composer.selectComposerMode}
              onSelectModel={composer.selectComposerModel}
              onSelectEffort={composer.selectComposerEffort}
              onToggleFullAccess={composer.toggleFullAccess}
            />
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

      {authBlocked ? <AuthModal errorMessage={authError} onSubmit={submitAuthToken} /> : null}
    </div>
  );
}
