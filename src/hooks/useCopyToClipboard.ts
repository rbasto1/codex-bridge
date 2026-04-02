import { useEffect, useRef, useState } from "react";

import { copyTextToClipboard } from "../lib/clipboard";

export function useCopyToClipboard(timeoutMs = 2000) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function copy(text: string) {
    if (!text) {
      return;
    }

    await copyTextToClipboard(text);
    setCopied(true);

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
    }, timeoutMs);
  }

  return {
    copied,
    copy,
  };
}
