import { useEffect, useRef } from "react";

import { formatReasoningEffort } from "../lib/composer";
import type { ThreadComposerProps } from "../types";
import { ComposerActionIcon } from "./graphics/ComposerActionIcon";
import { PermissionShieldIcon } from "./graphics/PermissionShieldIcon";

export function ThreadComposer(props: ThreadComposerProps) {
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!props.currentThread || !props.isLive) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [props.currentThread, props.focusToken, props.isLive]);

  return (
    <section className="composer-shell">
      <div className="workspace-column">
        <div className="composer-input-shell">
          <textarea
            ref={composerInputRef}
            className="composer-input"
            value={props.composerValue}
            onChange={(event) => props.onChangeComposer(event.target.value)}
            onKeyDown={(event) => {
              const isSubmitShortcut = event.key === "Enter" && (event.ctrlKey || event.altKey || event.metaKey);
              if (!isSubmitShortcut) {
                return;
              }

              event.preventDefault();
              if (!props.composerActionDisabled) {
                props.onSubmit();
              }
            }}
            placeholder={props.isLive ? "Message Codex" : "Resume the thread live to continue the conversation"}
            disabled={!props.currentThread || !props.isLive}
          />
          <button
            type="button"
            className="composer-submit-button"
            disabled={props.composerActionDisabled}
            onClick={() => {
              if (props.composerAction === "stop") {
                props.onInterrupt();
                return;
              }

              props.onSubmit();
            }}
            title={props.composerAction === "stop" ? "Stop turn" : props.composerAction === "steer" ? "Send and steer" : "Send"}
            aria-label={props.composerAction === "stop" ? "Stop turn" : props.composerAction === "steer" ? "Send and steer" : "Send"}
          >
            <ComposerActionIcon action={props.composerAction} />
          </button>
        </div>

        {props.composerControlDraft ? (
          <div className="composer-control-row" aria-label="Composer settings">
            <div className="composer-mode-toggle" role="group" aria-label="Mode">
              <button
                type="button"
                className={`composer-mode-button ${props.composerControlDraft.mode === "default" ? "active" : ""}`}
                onClick={() => props.onSelectMode("default")}
                disabled={props.composerControlsDisabled}
              >
                Build
              </button>
              <button
                type="button"
                className={`composer-mode-button ${props.composerControlDraft.mode === "plan" ? "active" : ""}`}
                onClick={() => props.onSelectMode("plan")}
                disabled={props.composerControlsDisabled}
              >
                Plan
              </button>
            </div>

            <div className="composer-select-shell composer-model-select-shell">
              <select
                className="select-input composer-control-select"
                value={props.composerControlDraft.model}
                onChange={(event) => props.onSelectModel(event.target.value)}
                disabled={props.composerControlsDisabled || props.modelChoices.length === 0}
                aria-label="Model"
              >
                {props.modelChoices.length === 0 ? (
                  <option value="">{props.modelsLoading ? "Loading models..." : "No models available"}</option>
                ) : null}
                {props.modelChoices.map((model) => (
                  <option key={model.model} value={model.model}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="composer-select-shell composer-effort-select-shell">
              <select
                className="select-input composer-control-select"
                value={props.composerControlDraft.effort ?? ""}
                onChange={(event) => props.onSelectEffort(event.target.value as NonNullable<typeof props.composerControlDraft.effort>)}
                disabled={props.composerControlsDisabled || props.reasoningOptions.length === 0}
                aria-label="Reasoning effort"
              >
                {props.reasoningOptions.length === 0 ? (
                  <option value="">{props.selectedModel ? "No reasoning options" : "Select a model"}</option>
                ) : null}
                {props.reasoningOptions.map((option) => (
                  <option key={option.reasoningEffort} value={option.reasoningEffort}>
                    {formatReasoningEffort(option.reasoningEffort)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className={`composer-permission-button ${props.composerControlDraft.fullAccess ? "active" : ""}`}
              onClick={props.onToggleFullAccess}
              disabled={props.composerControlsDisabled}
              title={props.composerControlDraft.fullAccess ? "Permissions: full access" : "Permissions: standard access"}
              aria-label={props.composerControlDraft.fullAccess ? "Permissions: full access" : "Permissions: standard access"}
              aria-pressed={props.composerControlDraft.fullAccess}
            >
              <PermissionShieldIcon active={props.composerControlDraft.fullAccess} />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
