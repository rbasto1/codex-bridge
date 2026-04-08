import { useEffect, useRef, useState } from "react";

import { fetchComposerMentionSuggestions, fetchComposerSkillSuggestions } from "../client/api";
import { formatReasoningEffort } from "../lib/composer";
import type {
  ComposerMentionSuggestion,
  ComposerSkillSuggestion,
  ThreadComposerProps,
} from "../types";
import { ComposerActionIcon } from "./graphics/ComposerActionIcon";
import { PermissionShieldIcon } from "./graphics/PermissionShieldIcon";

type ComposerTrigger = {
  kind: "mention" | "skill";
  query: string;
  start: number;
  end: number;
};

type ComposerSuggestion = {
  id: string;
  kind: "mention" | "skill";
  label: string;
  detail: string;
  replacement: string;
};

function isMobileViewport(): boolean {
  return window.innerWidth < 768;
}

function getComposerTrigger(value: string, cursor: number): ComposerTrigger | null {
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(^|\s)([@$])([^\s@$]*)$/);
  if (!match) {
    return null;
  }

  const marker = match[2];
  const query = match[3] ?? "";
  return {
    kind: marker === "@" ? "mention" : "skill",
    query,
    start: cursor - query.length - 1,
    end: cursor,
  };
}

function sameTrigger(left: ComposerTrigger | null, right: ComposerTrigger | null): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.kind === right.kind && left.query === right.query && left.start === right.start && left.end === right.end;
}

function mapMentionSuggestion(input: ComposerMentionSuggestion): ComposerSuggestion {
  return {
    id: `mention:${input.name}`,
    kind: "mention",
    label: `@${input.name}`,
    detail: input.path,
    replacement: `@${input.name}`,
  };
}

function mapSkillSuggestion(input: ComposerSkillSuggestion): ComposerSuggestion {
  return {
    id: `skill:${input.name}`,
    kind: "skill",
    label: `$${input.name}`,
    detail: input.description || input.path,
    replacement: `$${input.name}`,
  };
}

export function ThreadComposer(props: ThreadComposerProps) {
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const suggestionItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestIdRef = useRef(0);
  const pendingSelectionRef = useRef<number | null>(null);
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [suggestions, setSuggestions] = useState<ComposerSuggestion[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  useEffect(() => {
    if (!props.currentThread || (!props.isLive && !props.currentThread.uiOnly)) {
      return;
    }

    void props.focusToken;

    const frame = window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [props.currentThread, props.focusToken, props.isLive]);

  useEffect(() => {
    if (pendingSelectionRef.current === null || !composerInputRef.current) {
      return;
    }

    const nextCursor = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    composerInputRef.current.setSelectionRange(nextCursor, nextCursor);
  }, [props.composerValue]);

  useEffect(() => {
    if (!trigger || suggestions.length === 0) {
      return;
    }

    suggestionItemRefs.current[activeSuggestionIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeSuggestionIndex, suggestions, trigger]);

  useEffect(() => {
    const currentThread = props.currentThread;

    if (!currentThread || !trigger) {
      setSuggestions([]);
      setActiveSuggestionIndex(0);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    void (async () => {
      const nextSuggestions = trigger.kind === "mention"
        ? (await fetchComposerMentionSuggestions(currentThread.cwd, trigger.query)).map(mapMentionSuggestion)
        : (await fetchComposerSkillSuggestions(currentThread.cwd, trigger.query)).map(mapSkillSuggestion);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setSuggestions(nextSuggestions);
      setActiveSuggestionIndex(0);
    })().catch(() => {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setSuggestions([]);
      setActiveSuggestionIndex(0);
    });
  }, [props.currentThread, trigger]);

  function refreshTrigger() {
    const input = composerInputRef.current;
    if (!input || !props.currentThread) {
      setTrigger(null);
      setSuggestions([]);
      return;
    }

    const nextTrigger = getComposerTrigger(props.composerValue, input.selectionStart ?? props.composerValue.length);
    setTrigger((current) => (sameTrigger(current, nextTrigger) ? current : nextTrigger));
    if (!nextTrigger) {
      setSuggestions([]);
      setActiveSuggestionIndex(0);
    }
  }

  function applySuggestion(suggestion: ComposerSuggestion) {
    const input = composerInputRef.current;
    if (!input || !trigger) {
      return;
    }

    const before = props.composerValue.slice(0, trigger.start);
    const after = props.composerValue.slice(trigger.end);
    const existingWhitespace = after.match(/^\s+/)?.[0] ?? "";
    const needsSpace = /^\s/.test(after) ? "" : " ";
    const nextValue = `${before}${suggestion.replacement}${needsSpace}${after}`;
    pendingSelectionRef.current = before.length
      + suggestion.replacement.length
      + (needsSpace ? needsSpace.length : existingWhitespace.length);
    props.onChangeComposer(nextValue);
    setTrigger(null);
    setSuggestions([]);
    setActiveSuggestionIndex(0);
  }

  return (
    <section className="composer-shell">
      <div className="workspace-column">
        <div className="composer-input-shell">
          <textarea
            ref={composerInputRef}
            className="composer-input"
            value={props.composerValue}
            onChange={(event) => {
              props.onChangeComposer(event.target.value);
              window.requestAnimationFrame(refreshTrigger);
            }}
            onClick={() => window.requestAnimationFrame(refreshTrigger)}
            onSelect={() => window.requestAnimationFrame(refreshTrigger)}
            onBlur={() => {
              window.requestAnimationFrame(() => {
                if (composerInputRef.current?.matches(":focus")) {
                  return;
                }

                setTrigger(null);
                setSuggestions([]);
                setActiveSuggestionIndex(0);
              });
            }}
            onKeyDown={(event) => {
              if (trigger && suggestions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setTrigger(null);
                  setSuggestions([]);
                  setActiveSuggestionIndex(0);
                  return;
                }

                if (
                  event.key === "Tab"
                  || (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey)
                ) {
                  event.preventDefault();
                  applySuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0]!);
                  return;
                }
              }

              if (event.key !== "Enter" || event.shiftKey || isMobileViewport()) {
                return;
              }

              const hasSendModifier = event.ctrlKey || event.metaKey || event.altKey;
              const isSubmitShortcut = hasSendModifier || props.sendHotkey === "enter";
              if (!isSubmitShortcut) {
                return;
              }

              event.preventDefault();
              if (!props.composerActionDisabled) {
                props.onSubmit();
              }
            }}
            placeholder={props.isLive || props.currentThread?.uiOnly ? "Message Codex. Use @file or $skill" : "Resume the thread live to continue the conversation"}
            disabled={!props.currentThread || (!props.isLive && !props.currentThread.uiOnly)}
          />
          {trigger ? (
            <div
              ref={suggestionsRef}
              className="composer-suggestions"
              role="listbox"
              aria-label={trigger.kind === "mention" ? "File mentions" : "Skills"}
            >
              {suggestions.length > 0 ? (
                suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    ref={(element) => {
                      suggestionItemRefs.current[index] = element;
                    }}
                    type="button"
                    className={`composer-suggestion ${index === activeSuggestionIndex ? "active" : ""}`}
                    aria-selected={index === activeSuggestionIndex}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySuggestion(suggestion);
                    }}
                  >
                    <span className="composer-suggestion-label">{suggestion.label}</span>
                    <span className="composer-suggestion-detail">{suggestion.detail}</span>
                  </button>
                ))
              ) : (
                <div className="composer-suggestion-empty">No matches</div>
              )}
            </div>
          ) : null}
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
          <div className="composer-control-row">
            <div className="composer-mode-toggle">
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
