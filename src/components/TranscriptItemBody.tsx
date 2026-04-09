import type { TranscriptItemBodyProps } from "../types";
import {
  asString,
  extractContextCompactionMessage,
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
      return (
        <div className="reasoning-block">
          {summaryLines.length > 0 ? (
            <ul className="reasoning-summary">
              {summaryLines.map((entry) => (
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
      const summaryText = asString(item.summaryText);

      return (
        <div className="tool-block">
          {paths.length > 0 ? (
            <ul className="reasoning-summary">
              {paths.map((path) => (
                <li key={`${item.id}-${path}`}>{path}</li>
              ))}
            </ul>
          ) : null}
          {paths.length === 0 && summaryText ? <pre className="plain-block">{summaryText}</pre> : null}
        </div>
      );
    }
    case "enteredreviewmode":
    case "exitedreviewmode":
      return <p>{asString(item.review)}</p>;
    case "contextcompaction": {
      const compactionMessage = extractContextCompactionMessage(item);
      return (
        <div className="context-compaction-card">
          <p className="context-compaction-title">Earlier context was compacted for this thread.</p>
          {compactionMessage ? (
            <MarkdownBlock text={compactionMessage} preserveNewlines />
          ) : (
            <p className="context-compaction-copy">
              Codex compacted earlier conversation history to stay within its working context window.
            </p>
          )}
        </div>
      );
    }
    case "websearch":
      return <pre className="code-slab">{JSON.stringify(item, null, 2)}</pre>;
    default:
      return <pre className="code-slab">{JSON.stringify(item, null, 2)}</pre>;
  }
}
