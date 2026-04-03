import { useAppStore } from "../client/store";
import { formatRelativeTime } from "../lib/threads";
import type { SessionRowProps } from "../types";

export function SessionRow(props: SessionRowProps) {
  const { threadId, active, done, showUnread, onOpen, onToggleDone } = props;
  const thread = useAppStore((state) => state.threadsById[threadId]);

  if (!thread) {
    return null;
  }

  const isRunning = thread.status.type === "active";
  const showDone = done && !isRunning;
  const indicatorState = isRunning ? "running" : showUnread ? "unread" : showDone ? "done" : "idle";

  return (
    <button
      type="button"
      className={`session-row ${active ? "active" : ""}`}
      onClick={onOpen}
      title={thread.cwd}
    >
      <span className={`session-indicator ${indicatorState}`} />
      <div className="session-info">
        <span className="session-title-row">
          <span className={`session-name ${showDone ? "done" : ""}`}>{thread.name?.trim() || thread.preview || thread.id}</span>
          <button
            type="button"
            className={`session-done-toggle ${showDone ? "done" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleDone();
            }}
            title={done ? "Mark as not done" : "Mark as done"}
            aria-label={done ? "Mark as not done" : "Mark as done"}
          >
            <span aria-hidden="true">✓</span>
          </button>
        </span>
        <span className="session-meta">{formatRelativeTime(thread.updatedAt)}</span>
      </div>
    </button>
  );
}
