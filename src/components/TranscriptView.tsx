import { useEffect, useRef } from "react";
import { useAppStore } from "../client/store";
import type { TranscriptViewProps } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { TurnBlock } from "./TurnBlock";

export function TranscriptView(props: TranscriptViewProps) {
  const { threadId, respondingRequestKey, onRespond } = props;
  const turnIds = useAppStore((state) => state.turnOrderByThreadId[threadId] ?? []);
  const itemCount = useAppStore((state) =>
    turnIds.reduce((count, turnId) => count + (state.itemOrderByTurnId[turnId]?.length ?? 0), 0),
  );
  const threadRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter((request) => request.threadId === threadId && !request.turnId),
  );
  const transcriptRef = useRef<HTMLElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!transcriptRef.current || !scrollAnchorRef.current) {
      return;
    }

    scrollAnchorRef.current.scrollIntoView({ block: "end" });
  }, [itemCount, threadRequests.length, turnIds.length]);

  return (
    <section ref={transcriptRef} className="transcript-pane">
      {turnIds.length === 0 && threadRequests.length === 0 ? (
        <div className="empty-card small-empty">No turns yet. This thread is ready for the first message.</div>
      ) : null}

      {turnIds.map((turnId) => (
        <TurnBlock
          key={turnId}
          threadId={threadId}
          turnId={turnId}
          respondingRequestKey={respondingRequestKey}
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
      <div ref={scrollAnchorRef} />
    </section>
  );
}
