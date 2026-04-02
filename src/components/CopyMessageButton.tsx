import type { CopyMessageButtonProps } from "../types";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { CheckCircleIcon } from "./graphics/CheckCircleIcon";
import { ClipboardIcon } from "./graphics/ClipboardIcon";

export function CopyMessageButton(props: CopyMessageButtonProps) {
  const { copied, copy } = useCopyToClipboard();

  async function handleCopy() {
    try {
      await copy(props.text);
    } catch (error) {
      console.error("Copy failed", error);
    }
  }

  return (
    <button
      type="button"
      className={`copy-icon-button ${props.className ?? ""} ${copied ? "copied" : ""}`.trim()}
      onClick={() => void handleCopy()}
      aria-label={copied ? "Copied message" : "Copy message"}
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? <CheckCircleIcon /> : <ClipboardIcon />}
    </button>
  );
}
