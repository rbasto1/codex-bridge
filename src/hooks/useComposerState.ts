import { useEffect, useState } from "react";

import { listAvailableModels } from "../client/api";
import {
  createComposerControlDraft,
  findModelOption,
  formatReasoningEffort,
  isDangerFullAccess,
  listModelChoices,
  normalizeReasoningEffort,
} from "../lib/composer";
import { getErrorMessage } from "../lib/errors";
import { copyThreadScopedState, moveThreadScopedState } from "../lib/threads";
import type { Thread, ThreadSessionConfig } from "../shared/codex.js";
import type {
  ComposerAction,
  ComposerControlDraft,
  PermissionBaseline,
  UseComposerStateOptions,
} from "../types";

export function useComposerState(options: UseComposerStateOptions) {
  const {
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
  } = options;

  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>(initialUi.composerDrafts ?? {});
  const [defaultPermissionMode, setDefaultPermissionMode] = useState<"standard" | "full">(
    initialUi.defaultPermissionMode ?? "standard",
  );
  const [threadControlDrafts, setThreadControlDrafts] = useState<Record<string, ComposerControlDraft>>(
    initialUi.threadControlDrafts ?? {},
  );
  const [threadPermissionBaselines, setThreadPermissionBaselines] = useState<Record<string, PermissionBaseline>>(
    initialUi.threadPermissionBaselines ?? {},
  );
  const [availableModels, setAvailableModels] = useState<Awaited<ReturnType<typeof listAvailableModels>>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [composerBusy, setComposerBusy] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  const composerValue = activeThreadId ? composerDrafts[activeThreadId] ?? "" : "";
  const composerControlDraft = activeThreadId ? threadControlDrafts[activeThreadId] ?? null : null;
  const modelChoices = composerControlDraft ? listModelChoices(availableModels, composerControlDraft.model) : [];
  const selectedModel = composerControlDraft ? findModelOption(availableModels, composerControlDraft.model) : null;
  const reasoningOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const isLive = currentMode === "live";
  const waitingOnUserAction = currentWaitingFlags.includes("waitingOnApproval")
    || currentWaitingFlags.includes("waitingOnUserInput");
  const hasComposerText = composerValue.trim().length > 0;
  const isReplayDraft = Boolean(currentThread?.uiOnly) && !isLive;
  const canInteractWithComposer = isLive || isReplayDraft;
  const canCompose = Boolean(
    currentThread && canInteractWithComposer && backendStatus === "ready" && !waitingOnUserAction && !isCurrentThreadNonSteerable,
  );
  const isStreaming = Boolean(activeTurnId) && !waitingOnUserAction;
  const composerAction: ComposerAction = isStreaming
    ? canCompose && hasComposerText
      ? "steer"
      : "stop"
    : "send";
  const composerActionDisabled = composerAction === "stop"
    ? !isLive
    : !canCompose || composerBusy || !hasComposerText;
  const composerControlsDisabled = !currentThread || !canInteractWithComposer || Boolean(activeTurnId) || modelsLoading;

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
  }, [backendStatus, setActionError]);

  useEffect(() => {
    if (!activeThreadId || !currentThreadSessionConfig || isDangerFullAccess(currentThreadSessionConfig.sandbox)) {
      return;
    }

    setThreadPermissionBaselines((previous) => {
      const currentBaseline = previous[activeThreadId];
      if (
        currentBaseline
        && currentBaseline.approvalPolicy === currentThreadSessionConfig.approvalPolicy
        && JSON.stringify(currentBaseline.sandbox) === JSON.stringify(currentThreadSessionConfig.sandbox)
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
    if (!activeThreadId || !currentThread || composerControlDraft) {
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
      nextDraft.fullAccess = defaultPermissionMode === "full";
      nextDraft.updatedAt = Date.now();

      return {
        ...previous,
        [activeThreadId]: nextDraft,
      };
    });
  }, [activeThreadId, availableModels, composerControlDraft, currentThread, currentThreadSessionConfig, defaultPermissionMode]);

  function setComposerValue(value: string) {
    if (!activeThreadId) {
      return;
    }

    setComposerDrafts((previous) => ({
      ...previous,
      [activeThreadId]: value,
    }));
  }

  function setComposerDraft(threadId: string, value: string) {
    setComposerDrafts((previous) => ({
      ...previous,
      [threadId]: value,
    }));
  }

  function updateCurrentThreadControls(updater: (current: ComposerControlDraft) => ComposerControlDraft) {
    if (!activeThreadId || !composerControlDraft) {
      return;
    }

    setThreadControlDrafts((previous) => ({
      ...previous,
      [activeThreadId]: {
        ...updater(previous[activeThreadId] ?? composerControlDraft),
        updatedAt: Date.now(),
      },
    }));
  }

  function selectComposerMode(mode: ComposerControlDraft["mode"]) {
    updateCurrentThreadControls((current) => ({
      ...current,
      mode,
    }));
  }

  function selectComposerModel(model: string) {
    const modelOption = findModelOption(availableModels, model);
    updateCurrentThreadControls((current) => ({
      ...current,
      model,
      effort: normalizeReasoningEffort(modelOption, current.effort),
    }));
  }

  function selectComposerEffort(effort: NonNullable<ComposerControlDraft["effort"]>) {
    updateCurrentThreadControls((current) => ({
      ...current,
      effort,
    }));
  }

  function toggleFullAccess() {
    const nextMode = composerControlDraft?.fullAccess ? "standard" : "full";
    setDefaultPermissionMode(nextMode);
    updateCurrentThreadControls((current) => ({
      ...current,
      fullAccess: !current.fullAccess,
    }));
  }

  function moveScopedState(fromThreadId: string, toThreadId: string) {
    setComposerDrafts((previous) => moveThreadScopedState(previous, fromThreadId, toThreadId));
    setThreadControlDrafts((previous) => moveThreadScopedState(previous, fromThreadId, toThreadId));
    setThreadPermissionBaselines((previous) => moveThreadScopedState(previous, fromThreadId, toThreadId));
  }

  function copyScopedState(fromThreadId: string, toThreadId: string) {
    setThreadControlDrafts((previous) => copyThreadScopedState(previous, fromThreadId, toThreadId));
    setThreadPermissionBaselines((previous) => copyThreadScopedState(previous, fromThreadId, toThreadId));
  }

  function clearComposerDraft(targetThreadId: string, draftThreadId?: string) {
    setComposerDrafts((previous) => {
      const next = { ...previous, [targetThreadId]: "" };
      if (draftThreadId && targetThreadId !== draftThreadId) {
        delete next[draftThreadId];
      }
      return next;
    });
  }

  function removeScopedState(threadId: string) {
    setComposerDrafts((previous) => {
      if (!(threadId in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[threadId];
      return next;
    });
    setThreadControlDrafts((previous) => {
      if (!(threadId in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[threadId];
      return next;
    });
    setThreadPermissionBaselines((previous) => {
      if (!(threadId in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[threadId];
      return next;
    });
  }

  function focusComposer() {
    setFocusToken((value) => value + 1);
  }

  return {
    availableModels,
    composerAction,
    composerActionDisabled,
    composerBusy,
    composerControlDraft,
    composerControlsDisabled,
    composerValue,
    composerDrafts,
    defaultPermissionMode,
    focusToken,
    formatReasoningEffort,
    hasComposerText,
    isLive,
    modelChoices,
    modelsLoading,
    reasoningOptions,
    selectedModel,
    threadControlDrafts,
    threadPermissionBaselines,
    waitingOnUserAction,
    clearComposerDraft,
    copyScopedState,
    focusComposer,
    moveScopedState,
    removeScopedState,
    selectComposerEffort,
    selectComposerMode,
    selectComposerModel,
    setComposerBusy,
    setComposerDraft,
    setComposerValue,
    setDefaultPermissionMode,
    setThreadPermissionBaselines,
    toggleFullAccess,
  };
}
