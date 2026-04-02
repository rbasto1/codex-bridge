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

  return (
    <button
      type="button"
      className={`session-row ${active ? "active" : ""}`}
      onClick={onOpen}
      title={thread.cwd}
    >
      <span className={`session-indicator ${isRunning ? "running" : showDone ? "done" : showUnread ? "unread" : "idle"}`} />
      <div className="session-info">
        <span className={`session-name ${showDone ? "done" : ""}`}>{thread.name?.trim() || thread.preview || thread.id}</span>
        <span className="session-meta">
          {formatRelativeTime(thread.updatedAt)}
          <button
            type="button"
            className="session-done-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggleDone();
            }}
          >
            {done ? "Mark as not done" : "Mark as done"}
          </button>
        </span>
      </div>
    </button>
  );
}
