import { useEffect, useRef, useState } from "react";

import type { ThreadHeaderProps } from "../types";

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

export function ThreadHeader(props: ThreadHeaderProps) {
  const {
    archived,
    availableTags,
    currentThreadIsUiDraft,
    tags,
    thread,
    onCreateTag,
    onDeleteDraft,
    onRename,
    onToggleArchived,
    onToggleTag,
  } = props;
  const [renameDraft, setRenameDraft] = useState(thread.name ?? thread.preview);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [tagNameDraft, setTagNameDraft] = useState("");
  const [tagColorDraft, setTagColorDraft] = useState(DEFAULT_TAG_COLORS[0]);
  const [createError, setCreateError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const threadId = thread.id;

  const visibleTags = tags.filter((tag) => tag.name !== "done");
  const visibleAvailableTags = availableTags.filter((tag) => tag.name !== "done" && tag.name !== "archived");

  useEffect(() => {
    void threadId;
    setRenameDraft(thread.name ?? thread.preview);
    setIsEditingTitle(false);
  }, [threadId, thread.name, thread.preview]);

  useEffect(() => {
    void threadId;
    setMenuOpen(false);
    setCreatingTag(false);
    setCreateError(null);
  }, [threadId]);

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
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setCreatingTag(false);
        setCreateError(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  async function handleRename() {
    const originalTitle = thread.name ?? thread.preview;
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
    try {
      await onRename(nextName);
    } catch {
      setRenameDraft(originalTitle);
    } finally {
      setIsRenaming(false);
      setIsEditingTitle(false);
    }
  }

  function handleCancelRename() {
    setRenameDraft(thread.name ?? thread.preview);
    setIsEditingTitle(false);
  }

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
    <section className="thread-header">
      <div className="workspace-column thread-header-column">
        <div className="thread-title-row">
          <span className={`thread-status-dot ${thread.status.type === "active" ? "running" : "idle"}`} />
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              className="thread-title-input"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onBlur={() => void handleRename()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRename();
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  handleCancelRename();
                }
              }}
              placeholder={thread.preview || thread.id}
              disabled={isRenaming}
            />
          ) : (
            <button
              type="button"
              className="thread-title-button"
              onClick={() => setIsEditingTitle(true)}
              title={renameDraft || thread.preview || thread.id}
            >
              {renameDraft || thread.preview || thread.id}
            </button>
          )}

          <div ref={menuRef} className="thread-menu-wrap">
            <button
              type="button"
              className={`thread-menu-toggle ${menuOpen ? "open" : ""}`}
              onClick={() => {
                setMenuOpen((value) => !value);
                setCreateError(null);
              }}
              aria-label="Session options"
              title="Session options"
            >
              <DotsGlyph />
            </button>

            {menuOpen ? (
              <div className="thread-menu-panel">
                {currentThreadIsUiDraft ? (
                  <button type="button" className="thread-menu-item" onClick={onDeleteDraft}>
                    Delete draft
                  </button>
                ) : (
                  <>
                    <button type="button" className="thread-menu-item" onClick={onToggleArchived}>
                      {archived ? "Unarchive session" : "Archive session"}
                    </button>

                    <div className="thread-menu-section">
                      <div className="thread-menu-label">Tags</div>
                      {visibleTags.length > 0 ? (
                        <div className="thread-menu-tag-list">
                          {visibleTags.map((tag) => (
                            <span key={tag.name} className="thread-menu-tag-chip">
                              <span className="session-tag-dot" style={{ backgroundColor: tag.color }} />
                              <span>{tag.name}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {visibleAvailableTags.map((tag) => {
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
                      >
                        Add tag
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
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function DotsGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="session-tag-glyph">
      <path d="M3.25 8a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm4 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm4 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Z" fill="currentColor" />
    </svg>
  );
}
