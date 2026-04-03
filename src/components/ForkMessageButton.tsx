import type { ForkMessageButtonProps } from "../types";

export function ForkMessageButton(props: ForkMessageButtonProps) {
  return (
    <button
      type="button"
      className={`copy-icon-button ${props.className ?? ""}`.trim()}
      onClick={props.onClick}
      aria-label="Fork from this message"
      title="Fork"
    >
      <ForkGlyph />
    </button>
  );
}

function ForkGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="message-copy-icon">
      <path d="M5.5 2.5a2 2 0 1 0-1 1.732V6.5A2.5 2.5 0 0 0 7 9h2a1.5 1.5 0 0 1 1.5 1.5v1.268a2 2 0 1 0 1 0V10.5A2.5 2.5 0 0 0 9 8H7a1.5 1.5 0 0 1-1.5-1.5V4.232A2 2 0 0 0 5.5 2.5Zm0-1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm6 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" fill="currentColor" />
    </svg>
  );
}
