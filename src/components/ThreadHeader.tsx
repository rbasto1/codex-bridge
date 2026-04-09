import { useEffect, useRef, useState } from "react";

import type { ThreadHeaderProps } from "../types";
import { CreateTagModal } from "./CreateTagModal";
import { ManageTagsModal } from "./ManageTagsModal";

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
    onUpdateTag,
    onDeleteTag,
  } = props;
  const [renameDraft, setRenameDraft] = useState(thread.name ?? thread.preview);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [managingTags, setManagingTags] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const threadId = thread.id;

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
    setManagingTags(false);
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

  function handleStartCreatingTag() {
    setMenuOpen(false);
    setManagingTags(false);
    setCreatingTag(true);
  }

  function handleOpenTagManager() {
    setMenuOpen(false);
    setManagingTags(true);
  }

  return (<>
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
              onClick={() => setMenuOpen((value) => !value)}
              aria-label="Session options"
              title="Session options"
            >
              <DotsGlyph />
            </button>

            {menuOpen ? (
              <div className="thread-menu-panel">
                {currentThreadIsUiDraft ? (
                  <button type="button" className="thread-menu-item" onClick={onDeleteDraft}>
                    Discard draft
                  </button>
                ) : (
                  <>
                    <button type="button" className="thread-menu-item" onClick={onToggleArchived}>
                      <ArchiveGlyph />
                      {archived ? "Unarchive session" : "Archive session"}
                    </button>

                    <div className="thread-menu-divider" />

                    <div className="thread-menu-section">
                      <div className="thread-menu-label">Tags</div>
                      {visibleAvailableTags.map((tag) => {
                        const activeTag = tags.some((entry) => entry.name === tag.name);
                        return (
                          <button
                            key={tag.name}
                            type="button"
                            className={`session-tag-option ${activeTag ? "active" : ""}`}
                            onClick={() => onToggleTag(tag.name)}
                          >
                            <span className="session-tag-option-check">
                              {activeTag ? <CheckGlyph /> : null}
                            </span>
                            <span className="session-tag-dot" style={{ backgroundColor: tag.color }} />
                            <span>{tag.name}</span>
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        className="session-tag-option"
                        onClick={handleOpenTagManager}
                      >
                        <span className="session-tag-option-check">
                          <TagPlusGlyph />
                        </span>
                        <span>Manage tags</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>

    {managingTags ? (
      <ManageTagsModal
        tags={visibleAvailableTags}
        onUpdateTag={onUpdateTag}
        onDeleteTag={onDeleteTag}
        onCreateNew={handleStartCreatingTag}
        onClose={() => setManagingTags(false)}
      />
    ) : null}

    {creatingTag ? (
      <CreateTagModal
        onCreateTag={onCreateTag}
        onToggleTag={onToggleTag}
        onClose={() => setCreatingTag(false)}
      />
    ) : null}
  </>
  );
}

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="M1.75 3a.75.75 0 0 0-.75.75v1.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75H1.75ZM2.5 7.5v4.75c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75V7.5h-11Zm4 1.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1Z" />
    </svg>
  );
}

function TagPlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="M1 3a2 2 0 0 1 2-2h4.586a1 1 0 0 1 .707.293l6.414 6.414a2 2 0 0 1 0 2.828l-4.586 4.586a2 2 0 0 1-2.828 0L.879 8.707A1 1 0 0 1 .586 8V3.414L1 3Zm3.5 2a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
      <path d="M13 1.5a.5.5 0 0 1 .5.5v1.5H15a.5.5 0 0 1 0 1h-1.5V6a.5.5 0 0 1-1 0V4.5H11a.5.5 0 0 1 0-1h1.5V2a.5.5 0 0 1 .5-.5Z" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

function DotsGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="session-tag-glyph">
      <path d="M3.25 8a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm4 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm4 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Z" fill="currentColor" />
    </svg>
  );
}
