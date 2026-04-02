import { useAppStore } from "../client/store";
import { formatRelativeTime } from "../lib/threads";
import type { SessionRowProps } from "../types";

export function SessionRow(props: SessionRowProps) {
  const { threadId, active, onOpen } = props;
  const thread = useAppStore((state) => state.threadsById[threadId]);

  if (!thread) {
    return null;
  }

  const isRunning = thread.status.type === "active";

  return (
    <button
      type="button"
      className={`session-row ${active ? "active" : ""}`}
      onClick={onOpen}
      title={thread.cwd}
    >
      <span className={`session-indicator ${isRunning ? "running" : "idle"}`} />
      <div className="session-info">
        <span className="session-name">{thread.name?.trim() || thread.preview || thread.id}</span>
        <span className="session-meta">{formatRelativeTime(thread.updatedAt)}</span>
      </div>
    </button>
  );
}
