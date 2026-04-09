import { memo, useEffect, useState } from "react";

import { useAppStore } from "../client/store";
import type { TranscriptViewProps } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { TurnBlock } from "./TurnBlock";

const INITIAL_VISIBLE_TURNS = 24;
const LOAD_OLDER_TURNS_STEP = 40;

export const TranscriptView = memo(function TranscriptView(props: TranscriptViewProps) {
  const { threadId, respondingRequestKey, onForkMessage, onRespond } = props;
  const turnIds = useAppStore((state) => state.turnOrderByThreadId[threadId] ?? []);
  const threadRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter((request) => request.threadId === threadId && !request.turnId),
  );
  const [visibleTurnCount, setVisibleTurnCount] = useState(INITIAL_VISIBLE_TURNS);

  useEffect(() => {
    setVisibleTurnCount(INITIAL_VISIBLE_TURNS);
  }, [threadId]);

  const hiddenTurnCount = Math.max(turnIds.length - visibleTurnCount, 0);
  const visibleTurnIds = hiddenTurnCount > 0 ? turnIds.slice(hiddenTurnCount) : turnIds;

  return (
    <section className="transcript-pane">
      {turnIds.length === 0 && threadRequests.length === 0 ? (
        <div className="empty-card small-empty">No turns yet. This thread is ready for the first message.</div>
      ) : null}

      {hiddenTurnCount > 0 ? (
        <div className="transcript-load-older">
          <button
            type="button"
            className="button secondary"
            onClick={() => setVisibleTurnCount((current) => current + LOAD_OLDER_TURNS_STEP)}
          >
            Load {Math.min(hiddenTurnCount, LOAD_OLDER_TURNS_STEP)} older turn{hiddenTurnCount === 1 ? "" : "s"}
          </button>
        </div>
      ) : null}

      {visibleTurnIds.map((turnId) => (
        <TurnBlock
          key={turnId}
          threadId={threadId}
          turnId={turnId}
          respondingRequestKey={respondingRequestKey}
          onForkMessage={onForkMessage}
          onRespond={onRespond}
        />
      ))}

      {threadRequests.map((request) => (
        <ApprovalCard
          key={request.key}
          request={request}
          disabled={respondingRequestKey === request.key}
          onRespond={onRespond}
        />
      ))}
    </section>
  );
});
