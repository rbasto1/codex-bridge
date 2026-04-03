import { useAppStore } from "../client/store";
import { formatRelativeTime } from "../lib/threads";
import type { SessionRowProps } from "../types";

export function SessionRow(props: SessionRowProps) {
  const {
    threadId,
    active,
    tags,
    showUnread,
    onOpen,
    onToggleDone,
  } = props;
  const thread = useAppStore((state) => state.threadsById[threadId]);

  if (!thread) {
    return null;
  }

  const done = tags.some((tag) => tag.name === "done");
  const isRunning = thread.status.type === "active";
  const showDone = done && !isRunning;
  const indicatorState = isRunning ? "running" : showUnread ? "unread" : showDone ? "done" : "idle";
  const visibleTags = tags.filter((tag) => tag.name !== "done");

  return (
    <div className={`session-row ${active ? "active" : ""}`}>
      <span className={`session-indicator ${indicatorState}`} />
      <div className="session-content">
        <button type="button" className="session-row-main" onClick={onOpen}>
          <span className={`session-name ${showDone ? "done" : ""}`}>{thread.name?.trim() || thread.preview || thread.id}</span>
        </button>

        <div className="session-row-footer">
          <button type="button" className="session-meta-button" onClick={onOpen}>
            <span className="session-meta">
              {visibleTags.length > 0 ? (
                <span className="session-tag-dots">
                  {visibleTags.map((tag) => (
                    <span
                      key={tag.name}
                      className="session-tag-dot"
                      style={{ backgroundColor: tag.color }}
                      title={tag.name}
                    />
                  ))}
                </span>
              ) : null}
              <span>{formatRelativeTime(thread.updatedAt)}</span>
            </span>
          </button>

          <div className="session-row-actions">
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
      </div>
    </div>
  );
}
