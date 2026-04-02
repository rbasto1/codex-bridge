import { useEffect, useRef, useState } from "react";

import type { ThreadHeaderProps } from "../types";

export function ThreadHeader(props: ThreadHeaderProps) {
  const { currentThreadIsUiDraft, isLive, thread, threadLoadingId, onOpenLive, onOpenReplay, onRename } = props;
  const [renameDraft, setRenameDraft] = useState(thread.name ?? thread.preview);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setRenameDraft(thread.name ?? thread.preview);
    setIsEditingTitle(false);
  }, [thread.id, thread.name, thread.preview]);

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

  return (
    <section className="thread-header">
      <div className="workspace-column thread-header-column">
        <div className="thread-header-main">
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
          </div>

          <div className="thread-meta-row">
            <span className={`badge ${currentThreadIsUiDraft || isLive ? "badge-live" : "badge-replay"}`}>
              {currentThreadIsUiDraft ? "Draft session" : isLive ? "Live attached" : "Replay only"}
            </span>
          </div>
        </div>

        {!currentThreadIsUiDraft ? (
          <div className="thread-header-actions">
            <button type="button" className="button secondary" onClick={onOpenReplay}>
              Refresh replay
            </button>
            <button
              type="button"
              className="button primary"
              onClick={onOpenLive}
              disabled={threadLoadingId === thread.id}
            >
              {isLive ? "Live attached" : threadLoadingId === thread.id ? "Attaching..." : "Resume live"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
