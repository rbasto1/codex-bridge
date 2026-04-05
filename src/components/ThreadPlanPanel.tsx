import { useAppStore } from "../client/store";
import { asString, extractPlanTasks, isItemType } from "../lib/threads";
import type { ThreadPlanPanelProps } from "../types";

export function ThreadPlanPanel(props: ThreadPlanPanelProps) {
  const { threadId } = props;
  const latestPlan = useAppStore((state) => selectLatestPlan(state, threadId));

  if (!latestPlan) {
    return null;
  }

  const tasks = extractPlanTasks(latestPlan.item);
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const inProgressCount = tasks.filter((task) => task.status === "inProgress").length;
  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const rawText = asString(latestPlan.item.text).trim();

  return (
    <details className="thread-plan-panel" open>
      <summary className="thread-plan-summary">
        <span className="thread-plan-title">To-do list</span>
        <span className="thread-plan-meta">
          {tasks.length > 0 ? `${tasks.length} item${tasks.length === 1 ? "" : "s"}` : "live plan"}
        </span>
      </summary>

      <div className="thread-plan-body">
        {tasks.length > 0 ? (
          <ul className="thread-plan-list">
            {tasks.map((task) => (
              <li key={task.key} className={`thread-plan-row ${statusClassName(task.status)}`}>
                <span className={`thread-plan-status ${statusClassName(task.status)}`} aria-hidden="true" />
                <span className="thread-plan-text">{task.text}</span>
              </li>
            ))}
          </ul>
        ) : rawText ? (
          <pre className="plain-block thread-plan-raw">{rawText}</pre>
        ) : (
          <p className="thread-plan-empty">Waiting for the agent to publish a plan.</p>
        )}

        {tasks.length > 0 ? (
          <div className="thread-plan-stats">
            {inProgressCount > 0 ? <span>{inProgressCount} in progress</span> : null}
            {pendingCount > 0 ? <span>{pendingCount} pending</span> : null}
            {completedCount > 0 ? <span>{completedCount} completed</span> : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function selectLatestPlan(
  state: ReturnType<typeof useAppStore.getState>,
  threadId: string,
): { item: ReturnType<typeof useAppStore.getState>["itemsById"][string] } | null {
  const turnIds = state.turnOrderByThreadId[threadId] ?? [];

  for (let turnIndex = turnIds.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turnId = turnIds[turnIndex];
    const itemIds = state.itemOrderByTurnId[turnId] ?? [];

    for (let itemIndex = itemIds.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = state.itemsById[itemIds[itemIndex]];
      if (item && isItemType(item, "plan")) {
        return {
          item,
        };
      }
    }
  }

  return null;
}

function statusClassName(status: ReturnType<typeof extractPlanTasks>[number]["status"]): string {
  switch (status) {
    case "completed":
      return "is-completed";
    case "inProgress":
      return "is-in-progress";
    case "pending":
      return "is-pending";
    default:
      return "is-unknown";
  }
}
