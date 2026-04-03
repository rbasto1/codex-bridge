import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

import type { MarkdownBlockProps } from "../types";

export function MarkdownBlock(props: MarkdownBlockProps) {
  const text = props.preserveNewlines ? props.text.replace(/\n/g, "  \n") : props.text;

  return (
    <div className="markdown-shell">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...rest }: any) {
            const match = /language-(\w+)/.exec(className ?? "");
            if (!inline && match) {
              return (
                <SyntaxHighlighter
                  {...rest}
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: 6,
                    background: "#101010",
                    border: "1px solid #282828",
                    padding: "8px 12px",
                    fontSize: "13px",
                    lineHeight: "150%",
                  }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }

            return <code className={className}>{children}</code>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
