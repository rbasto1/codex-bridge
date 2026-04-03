import { useLayoutEffect, useRef } from "react";
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

  useLayoutEffect(() => {
    const transcriptElement = transcriptRef.current;
    if (!transcriptElement) {
      return;
    }

    const scrollContainer = transcriptElement.closest<HTMLElement>(".workspace-scroll");
    if (!scrollContainer) {
      return;
    }

    const scrollToBottom = () => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    };

    scrollToBottom();
    const frameId = requestAnimationFrame(scrollToBottom);
    const mutationObserver = new MutationObserver(() => {
      scrollToBottom();
    });
    mutationObserver.observe(transcriptElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    const resizeObserver = new ResizeObserver(() => {
      scrollToBottom();
    });
    resizeObserver.observe(transcriptElement);

    return () => {
      cancelAnimationFrame(frameId);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [threadId]);

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
    </section>
  );
}
