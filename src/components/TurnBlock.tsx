import { memo } from "react";

import { useShallow } from "zustand/react/shallow";

import { useAppStore } from "../client/store";
import { getErrorMessage } from "../lib/errors";
import type { TurnBlockProps } from "../types";
import { buildTurnAgentCopyText } from "../lib/threads";
import { ApprovalCard } from "./ApprovalCard";
import { CopyMessageButton } from "./CopyMessageButton";
import { TranscriptItemCard } from "./TranscriptItemCard";

export const TurnBlock = memo(function TurnBlock(props: TurnBlockProps) {
  const { threadId, turnId, respondingRequestKey, onForkMessage, onRespond } = props;
  const turn = useAppStore((state) => state.turnsById[turnId]);
  const itemIds = useAppStore((state) => state.itemOrderByTurnId[turnId] ?? []);
  const turnRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter(
      (request) => request.threadId === threadId && request.turnId === turnId && !request.itemId,
    ),
  );
  const orphanItemRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter(
      (request) =>
        request.threadId === threadId
        && request.turnId === turnId
        && Boolean(request.itemId)
        && !itemIds.includes(request.itemId as string),
    ),
  );
  const turnItems = useAppStore(
    useShallow((state) =>
      itemIds
        .map((itemId) => state.itemsById[itemId])
        .filter(Boolean),
    ),
  );
  const agentCopyText = buildTurnAgentCopyText(turnItems, turn?.status);
  const turnFailed = turn?.status === "failed";
  const turnErrorMessage = turnFailed ? getErrorMessage(turn.error).trim() || "Turn failed" : "";

  return (
    <div className="turn-card">
      <div className={`turn-content ${agentCopyText ? "turn-copyable" : ""}`}>
        <div className="turn-items">
          {itemIds.map((itemId) => (
            <TranscriptItemCard
              key={itemId}
              threadId={threadId}
              turnId={turnId}
              itemId={itemId}
              respondingRequestKey={respondingRequestKey}
              onForkMessage={onForkMessage}
              onRespond={onRespond}
            />
          ))}

          {turnRequests.map((request) => (
            <ApprovalCard
              key={request.key}
              request={request}
              disabled={respondingRequestKey === request.key}
              onRespond={onRespond}
            />
          ))}

          {orphanItemRequests.map((request) => (
            <ApprovalCard
              key={request.key}
              request={request}
              disabled={respondingRequestKey === request.key}
              onRespond={onRespond}
            />
          ))}

          {turnFailed ? (
            <section className="turn-error-banner" role="alert" aria-live="polite">
              <span>{turnErrorMessage}</span>
            </section>
          ) : null}
        </div>

        {agentCopyText ? (
          <div className="turn-copy-slot">
            <CopyMessageButton className="turn-copy-button" text={agentCopyText} />
          </div>
        ) : null}
      </div>
    </div>
  );
});
