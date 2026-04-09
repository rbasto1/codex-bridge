import { useAppStore } from "../client/store";
import type { TranscriptItemCardProps } from "../types";
import type { ThreadItem } from "../shared/codex.js";
import {
  asString,
  extractFileChangePaths,
  formatItemLabel,
  normalizeItemType,
  normalizeStringArray,
  renderUserInputs,
} from "../lib/threads";
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
  const itemType = normalizeItemType(item.type);
  const copyText = item.type === "userMessage" ? renderUserInputs(item.content) : "";
  const isCopyableMessage = copyText.length > 0;
  const isForkableUserMessage = item.type === "userMessage" && copyText.length > 0;
  const isExpandableRow = (itemType === "reasoning" || itemType === "filechange" || itemType === "websearch")
    && hasExpandableItemDetails(item);
  const rowPreview = isExpandableRow ? formatExpandableItemPreview(item) : "";

  if (isExpandableRow) {
    return (
      <div className={`item-card item-${item.type}`}>
        <details className="item-disclosure">
          <summary className="item-disclosure-summary">
            <span className="eyebrow">{itemLabel || rowPreview}</span>
            {itemLabel && rowPreview ? <span className="item-disclosure-preview">{rowPreview}</span> : null}
          </summary>
          <div className="item-body item-disclosure-body">
            <TranscriptItemBody item={item} />
          </div>
        </details>

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

function formatExpandableItemPreview(item: ThreadItem): string {
  const itemType = normalizeItemType(item.type);

  if (itemType === "reasoning") {
    const summaryLines = normalizeStringArray(item.summary);
    const contentLines = normalizeStringArray(item.content);
    return firstNonEmptyLine(summaryLines[0] || contentLines[0] || "");
  }

  if (itemType === "filechange") {
    return "";
  }

  if (itemType === "websearch") {
    return firstNonEmptyLine(asString(item.query));
  }

  return "";
}

function hasExpandableItemDetails(item: ThreadItem): boolean {
  const itemType = normalizeItemType(item.type);

  if (itemType === "reasoning") {
    return normalizeStringArray(item.summary).length > 0 || normalizeStringArray(item.content).length > 0;
  }

  if (itemType === "filechange") {
    return extractFileChangePaths(item).length > 0 || firstNonEmptyLine(asString(item.summaryText)).length > 0;
  }

  if (itemType === "websearch") {
    return firstNonEmptyLine(asString(item.query)).length > 0;
  }

  return false;
}

function firstNonEmptyLine(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) || "";
}
