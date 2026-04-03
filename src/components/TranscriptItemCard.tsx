import { useAppStore } from "../client/store";
import type { TranscriptItemCardProps } from "../types";
import { formatItemLabel, renderUserInputs } from "../lib/threads";
import { ApprovalCard } from "./ApprovalCard";
import { CopyMessageButton } from "./CopyMessageButton";
import { ForkMessageButton } from "./ForkMessageButton";
import { TranscriptItemBody } from "./TranscriptItemBody";

export function TranscriptItemCard(props: TranscriptItemCardProps) {
  const { threadId, turnId, itemId, respondingRequestKey, onForkMessage, onRespond } = props;
  const item = useAppStore((state) => state.itemsById[itemId]);
  const itemRequests = useAppStore((state) =>
    Object.values(state.pendingServerRequestsById).filter(
      (request) => request.threadId === threadId && request.turnId === turnId && request.itemId === itemId,
    ),
  );

  if (!item) {
    return null;
  }

  const itemLabel = formatItemLabel(item.type);
  const copyText = item.type === "userMessage" ? renderUserInputs(item.content) : "";
  const isCopyableMessage = copyText.length > 0;
  const isForkableUserMessage = item.type === "userMessage" && copyText.length > 0;

  return (
    <div className={`item-card item-${item.type} ${isCopyableMessage ? "item-copyable" : ""}`}>
      {itemLabel ? (
        <div className="item-header">
          <span className="eyebrow">{itemLabel}</span>
        </div>
      ) : null}

      {isCopyableMessage ? (
        <div className="message-shell">
          <div className="item-body">
            <TranscriptItemBody item={item} />
          </div>
          <div className="message-action-row">
            {isForkableUserMessage ? (
              <ForkMessageButton className="message-fork-button" onClick={() => onForkMessage(threadId, turnId, itemId)} />
            ) : null}
            <CopyMessageButton className="message-copy-button" text={copyText} />
          </div>
        </div>
      ) : (
        <div className="item-body">
          <TranscriptItemBody item={item} />
        </div>
      )}

      {itemRequests.map((request) => (
        <ApprovalCard
          key={request.key}
          request={request}
          disabled={respondingRequestKey === request.key}
          onRespond={onRespond}
          relatedItem={item}
        />
      ))}
    </div>
  );
}
