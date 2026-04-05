import type { TranscriptItemBodyProps } from "../types";
import {
  asString,
  extractFileChangePaths,
  normalizeStringArray,
  normalizeItemType,
  renderUserInputs,
} from "../lib/threads";
import { MarkdownBlock } from "./MarkdownBlock";

export function TranscriptItemBody(props: TranscriptItemBodyProps) {
  const { item } = props;
  const itemType = normalizeItemType(item.type);

  switch (itemType) {
    case "usermessage":
      return <MarkdownBlock text={renderUserInputs(item.content)} preserveNewlines />;
    case "agentmessage":
      return <MarkdownBlock text={asString(item.text)} />;
    case "reasoning": {
      const summaryLines = normalizeStringArray(item.summary);
      const contentLines = normalizeStringArray(item.content);
      const firstLine = summaryLines[0] || contentLines[0] || "";
      const hasMore = summaryLines.length > 1 || contentLines.length > 0;
      return (
        <div className="reasoning-block">
          {firstLine ? <p className="reasoning-first-line">{firstLine}</p> : null}
          {hasMore ? (
            <details className="collapsible-block">
              <summary className="collapsible-summary">more reasoning</summary>
              {summaryLines.length > 1 ? (
                <ul className="reasoning-summary">
                  {summaryLines.slice(1).map((entry) => (
                    <li key={`${item.id}-summary-${entry}`}>{entry}</li>
                  ))}
                </ul>
              ) : null}
              {contentLines.length > 0 ? (
                <div className="markdown-shell">
                  {contentLines.map((entry) => (
                    <p key={`${item.id}-content-${entry}`}>{entry}</p>
                  ))}
                </div>
              ) : null}
            </details>
          ) : null}
        </div>
      );
    }
    case "plan":
      return <pre className="plain-block">{asString(item.text)}</pre>;
    case "commandexecution":
      return (
        <details className="collapsible-block">
          <summary className="collapsible-summary"><span className="collapsible-command">{asString(item.command) || "(command)"}</span></summary>
          <div className="tool-block" style={{ marginTop: 6 }}>
            <p className="approval-meta">cwd: {asString(item.cwd)}</p>
            {asString(item.aggregatedOutput) ? <pre className="plain-block">{asString(item.aggregatedOutput)}</pre> : null}
          </div>
        </details>
      );
    case "filechange": {
      const paths = extractFileChangePaths(item);
      return (
        <div className="tool-block">
          {paths.length > 0 ? (
            <ul className="reasoning-summary">
              {paths.map((path) => (
                <li key={`${item.id}-${path}`}>{path}</li>
              ))}
            </ul>
          ) : null}
          {asString(item.summaryText) ? <pre className="plain-block">{asString(item.summaryText)}</pre> : null}
        </div>
      );
    }
    case "enteredreviewmode":
    case "exitedreviewmode":
      return <p>{asString(item.review)}</p>;
    case "contextcompaction":
      return <p>Context compaction was recorded for this turn.</p>;
    default:
      return <pre className="code-slab">{JSON.stringify(item, null, 2)}</pre>;
  }
}
