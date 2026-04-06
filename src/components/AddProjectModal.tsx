import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createProjectFolder, fetchProjectPathCompletion } from "../client/api";
import type { AddProjectModalProps } from "../types";

export function AddProjectModal(props: AddProjectModalProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pathExists, setPathExists] = useState(false);
  const [isDirectory, setIsDirectory] = useState(false);
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const formatSuggestion = useCallback((project: string) => {
    const trimmed = draft.trim();
    if (trimmed.startsWith("~") && props.envHome && project.startsWith(props.envHome)) {
      return `~${project.slice(props.envHome.length)}`;
    }

    return project;
  }, [draft, props.envHome]);

  const normalizeProjectPath = useCallback((project: string) => {
    if (project.length > 1 && project.endsWith("/")) {
      return project.replace(/\/+$/g, "");
    }

    return project;
  }, []);

  const normalizeSuggestion = useCallback((project: string) => {
    return normalizeProjectPath(formatSuggestion(project));
  }, [formatSuggestion, normalizeProjectPath]);

  const existingSuggestions = useMemo(
    () => new Set(props.projectOptions.map((project) => normalizeSuggestion(project))),
    [normalizeSuggestion, props.projectOptions],
  );

  const suggestions = useMemo(
    () => {
      if (!draft.trim()) {
        return [];
      }

      return Array.from(new Set(pathSuggestions)).slice(0, 12);
    },
    [draft, pathSuggestions],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setPathExists(false);
      setIsDirectory(false);
      setPathSuggestions([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await fetchProjectPathCompletion(trimmed);
          if (cancelled) {
            return;
          }

          setPathExists(result.exists);
          setIsDirectory(result.isDirectory);
          setPathSuggestions(result.suggestions.map(formatSuggestion));

          if (result.exists && !result.isDirectory) {
            setError("Path exists but is not a directory.");
            return;
          }

          setError(null);
        } catch {
          if (!cancelled) {
            setPathExists(false);
            setIsDirectory(false);
            setPathSuggestions([]);
          }
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [draft, formatSuggestion]);

  async function refreshPathState(input: string) {
    const result = await fetchProjectPathCompletion(input);
    setPathExists(result.exists);
    setIsDirectory(result.isDirectory);
    setPathSuggestions(result.suggestions.map(formatSuggestion));

    if (result.exists && !result.isDirectory) {
      setError("Path exists but is not a directory.");
      return result;
    }

    setError(null);
    return result;
  }

  async function handleAddProject() {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }

    try {
      const result = await refreshPathState(trimmed);
      if (!result.exists) {
        setError("Directory not found.");
        return;
      }

      if (!result.isDirectory) {
        setError("Path exists but is not a directory.");
        return;
      }

      props.onAddProject(normalizeProjectPath(result.resolvedPath));
      setDraft("");
      setError(null);
      props.onClose();
    } catch {
      setError("Failed to validate the project path.");
    }
  }

  async function handleCreateFolder() {
    const trimmed = draft.trim();
    if (!trimmed || (pathExists && isDirectory)) {
      return;
    }

    try {
      await createProjectFolder(trimmed);
      await refreshPathState(trimmed);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create folder.");
    }
  }

  function handleSelectSuggestion(suggestion: string) {
    if (existingSuggestions.has(normalizeProjectPath(suggestion))) {
      return;
    }

    setDraft(suggestion);
    setError(null);
    inputRef.current?.focus();
  }

  function formatSuggestionLabel(suggestion: string) {
    const trimmed = draft.trim();
    if (!trimmed.startsWith("/") && !trimmed.startsWith("~")) {
      return suggestion;
    }

    const prefixEnd = trimmed.lastIndexOf("/");
    if (prefixEnd < 0) {
      return suggestion;
    }

    const stablePrefix = trimmed.slice(0, prefixEnd + 1);
    if (!stablePrefix || !suggestion.startsWith(stablePrefix)) {
      return suggestion;
    }

    const suffix = suggestion.slice(Math.max(stablePrefix.length - 1, 0));
    return suffix === suggestion ? suggestion : `...${suffix}`;
  }

  const normalizedDraft = normalizeProjectPath(draft.trim());
  const isAlreadyAdded = !!normalizedDraft && existingSuggestions.has(normalizedDraft);
  const canAdd = !!draft.trim() && pathExists && isDirectory && !isAlreadyAdded;
  const canCreateFolder = !!draft.trim() && !pathExists && !error;

  return (
    <div className="modal-backdrop">
      <button type="button" className="modal-scrim" aria-label="Close add project dialog" onClick={props.onClose} />
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-modal-title"
        tabIndex={-1}
      >
        <h3 id="add-project-modal-title" className="modal-title">Add project</h3>
        <input
          className="text-input"
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) {
              setError(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleAddProject();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          }}
          placeholder="/path/to/project or ~/project"
        />
        <div className="path-suggestion-list" role="listbox" aria-label="Project path suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={`path-suggestion-item ${suggestion === draft.trim() ? "active" : ""}`}
              onClick={() => handleSelectSuggestion(suggestion)}
              disabled={existingSuggestions.has(normalizeProjectPath(suggestion))}
              title={suggestion}
            >
              <span className="path-suggestion-label">{formatSuggestionLabel(suggestion)}</span>
              {existingSuggestions.has(normalizeProjectPath(suggestion)) ? <span className="path-suggestion-badge">Added</span> : null}
            </button>
          ))}
        </div>
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="modal-actions split">
          <button type="button" className="button secondary" onClick={() => void handleCreateFolder()} disabled={!canCreateFolder}>
            Create Folder
          </button>
          <div className="modal-actions-group">
            <button type="button" className="button primary" onClick={() => void handleAddProject()} disabled={!canAdd}>
              Add
            </button>
            <button type="button" className="button secondary" onClick={props.onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
