import { useEffect, useRef, useState } from "react";

import { useAppStore } from "../client/store";
import { formatRelativeTime } from "../lib/threads";
import type { SessionRowProps } from "../types";

const DEFAULT_TAG_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#eab308",
  "#14b8a6",
  "#64748b",
];

export function SessionRow(props: SessionRowProps) {
  const {
    threadId,
    active,
    archived,
    availableTags,
    tags,
    showUnread,
    onOpen,
    onToggleArchived,
    onToggleDone,
    onToggleTag,
    onCreateTag,
  } = props;
  const thread = useAppStore((state) => state.threadsById[threadId]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [tagNameDraft, setTagNameDraft] = useState("");
  const [tagColorDraft, setTagColorDraft] = useState(DEFAULT_TAG_COLORS[0]);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!tagMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setTagMenuOpen(false);
        setCreatingTag(false);
        setCreateError(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [tagMenuOpen]);

  if (!thread) {
    return null;
  }

  const done = tags.some((tag) => tag.name === "done");
  const isRunning = thread.status.type === "active";
  const showDone = done && !isRunning;
  const indicatorState = isRunning ? "running" : showUnread ? "unread" : showDone ? "done" : "idle";

  function handleCreateTag() {
    const error = onCreateTag(tagNameDraft, tagColorDraft);
    if (error) {
      setCreateError(error);
      return;
    }

    onToggleTag(tagNameDraft.trim());
    setTagNameDraft("");
    setTagColorDraft(DEFAULT_TAG_COLORS[0]);
    setCreateError(null);
    setCreatingTag(false);
  }

  return (
    <div ref={rootRef} className={`session-row ${active ? "active" : ""}`}>
      <button type="button" className="session-row-main" onClick={onOpen}>
        <span className={`session-indicator ${indicatorState}`} />
        <div className="session-info">
          <span className="session-title-row">
            <span className={`session-name ${showDone ? "done" : ""}`}>{thread.name?.trim() || thread.preview || thread.id}</span>
          </span>
          <span className="session-meta">
            <span className="session-tag-dots">
              {tags.map((tag) => (
                <span
                  key={tag.name}
                  className="session-tag-dot"
                  style={{ backgroundColor: tag.color }}
                  title={tag.name}
                />
              ))}
            </span>
            <span>{formatRelativeTime(thread.updatedAt)}</span>
          </span>
        </div>
      </button>

      <div className="session-row-actions">
        <div className="session-tag-picker-wrap">
          <button
            type="button"
            className={`session-tag-toggle ${tagMenuOpen ? "open" : ""}`}
            onClick={() => {
              setTagMenuOpen((value) => !value);
              setCreateError(null);
            }}
            title="Edit tags"
            aria-label="Edit tags"
          >
            <TagGlyph />
          </button>

          {tagMenuOpen ? (
            <div className="session-tag-picker">
              <button
                type="button"
                className={`session-tag-option ${archived ? "active" : ""}`}
                onClick={onToggleArchived}
              >
                <span>Archived</span>
                <span>{archived ? "On" : "Off"}</span>
              </button>

              {availableTags.map((tag) => {
                const activeTag = tags.some((entry) => entry.name === tag.name);
                return (
                  <button
                    key={tag.name}
                    type="button"
                    className={`session-tag-option ${activeTag ? "active" : ""}`}
                    onClick={() => onToggleTag(tag.name)}
                  >
                    <span className="session-tag-option-label">
                      <span className="session-tag-dot" style={{ backgroundColor: tag.color }} />
                      <span>{tag.name}</span>
                    </span>
                    <span>{activeTag ? "On" : "Off"}</span>
                  </button>
                );
              })}

              <button
                type="button"
                className="session-tag-add"
                onClick={() => {
                  setCreatingTag((value) => !value);
                  setCreateError(null);
                }}
                aria-label="Add tag"
                title="Add tag"
              >
                +
              </button>

              {creatingTag ? (
                <div className="session-tag-create">
                  <input
                    className="session-tag-input"
                    value={tagNameDraft}
                    onChange={(event) => setTagNameDraft(event.target.value)}
                    placeholder="Tag name"
                  />
                  <div className="session-tag-colors">
                    {DEFAULT_TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`session-tag-color-swatch ${tagColorDraft.toLowerCase() === color.toLowerCase() ? "active" : ""}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setTagColorDraft(color)}
                        title={color}
                        aria-label={`Select ${color}`}
                      />
                    ))}
                  </div>
                  <input
                    className="session-tag-input"
                    value={tagColorDraft}
                    onChange={(event) => setTagColorDraft(event.target.value)}
                    placeholder="#22c55e"
                  />
                  {createError ? <div className="session-tag-error">{createError}</div> : null}
                  <button type="button" className="session-tag-create-submit" onClick={handleCreateTag}>
                    Create tag
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={`session-done-toggle ${showDone ? "done" : ""}`}
          onClick={onToggleDone}
          title={done ? "Mark as not done" : "Mark as done"}
          aria-label={done ? "Mark as not done" : "Mark as done"}
        >
          <span aria-hidden="true">✓</span>
        </button>
      </div>
    </div>
  );
}

function TagGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="session-tag-glyph">
      <path
        d="M2.5 4.5v4.586c0 .265.105.52.293.707l3.414 3.414a1 1 0 0 0 1.414 0l5.172-5.172a1 1 0 0 0 0-1.414L9.379 3.207A.996.996 0 0 0 8.672 2.914H4.086a1.586 1.586 0 0 0-1.586 1.586Zm2 0c0-.048.038-.086.086-.086h3.793l3 3-4.465 4.465-2.414-2.414Zm1.336 1.5a.914.914 0 1 0 0-1.828.914.914 0 0 0 0 1.828Z"
        fill="currentColor"
      />
    </svg>
  );
}
