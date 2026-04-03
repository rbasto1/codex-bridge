import { useLayoutEffect, useRef, useState, type PropsWithChildren } from "react";

type ScrollViewportProps = PropsWithChildren<{
  className?: string;
}>;

const MIN_THUMB_HEIGHT = 32;
const TRACK_PADDING = 8;
const AUTO_SCROLL_THRESHOLD = 24;

export function ScrollViewport(props: ScrollViewportProps) {
  const { className, children } = props;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startScrollTop: number } | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const [thumbState, setThumbState] = useState({ visible: false, height: 0, top: 0 });
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateThumb = () => {
      const { clientHeight, scrollHeight, scrollTop } = viewport;
      if (scrollHeight <= clientHeight || clientHeight <= 0) {
        setThumbState({ visible: false, height: 0, top: 0 });
        return;
      }

      const trackHeight = clientHeight - TRACK_PADDING * 2;
      const rawHeight = (clientHeight / scrollHeight) * trackHeight;
      const height = Math.max(rawHeight, MIN_THUMB_HEIGHT);
      const maxScrollTop = scrollHeight - clientHeight;
      const maxThumbTop = Math.max(trackHeight - height, 0);
      const top = maxScrollTop > 0 ? TRACK_PADDING + (scrollTop / maxScrollTop) * maxThumbTop : TRACK_PADDING;

      setThumbState({ visible: true, height, top });
    };

    const isAtBottom = () => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= AUTO_SCROLL_THRESHOLD;

    const syncAutoScrollEnabled = (nextValue: boolean) => {
      autoScrollEnabledRef.current = nextValue;
      setAutoScrollEnabled((currentValue) => (currentValue === nextValue ? currentValue : nextValue));
    };

    const scrollToBottom = () => {
      viewport.scrollTop = viewport.scrollHeight;
    };

    const syncViewport = () => {
      if (autoScrollEnabledRef.current) {
        scrollToBottom();
      }
      updateThumb();
      syncAutoScrollEnabled(isAtBottom());
    };

    const handleScroll = () => {
      updateThumb();
      syncAutoScrollEnabled(isAtBottom());
    };

    syncViewport();
    const frameId = requestAnimationFrame(syncViewport);
    viewport.addEventListener("scroll", handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(syncViewport);
    resizeObserver.observe(viewport);
    if (viewport.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(viewport.firstElementChild);
    }

    const mutationObserver = new MutationObserver(syncViewport);
    if (viewport.firstElementChild instanceof HTMLElement) {
      mutationObserver.observe(viewport.firstElementChild, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    return () => {
      cancelAnimationFrame(frameId);
      viewport.removeEventListener("scroll", handleScroll);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const thumb = thumbRef.current;
    const viewport = viewportRef.current;
    if (!thumb || !viewport) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      const deltaY = event.clientY - dragState.startY;
      const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
      const maxThumbTop = viewport.clientHeight - thumbState.height - TRACK_PADDING * 2;
      if (maxScrollTop <= 0 || maxThumbTop <= 0) {
        return;
      }

      viewport.scrollTop = dragState.startScrollTop + deltaY * (maxScrollTop / maxThumbTop);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (thumb.hasPointerCapture(event.pointerId)) {
        thumb.releasePointerCapture(event.pointerId);
      }
      dragStateRef.current = null;
      thumb.dataset.dragging = "false";
      thumb.removeEventListener("pointermove", handlePointerMove);
      thumb.removeEventListener("pointerup", handlePointerUp);
    };

    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      dragStateRef.current = {
        startY: event.clientY,
        startScrollTop: viewport.scrollTop,
      };
      thumb.dataset.dragging = "true";
      thumb.setPointerCapture(event.pointerId);
      thumb.addEventListener("pointermove", handlePointerMove);
      thumb.addEventListener("pointerup", handlePointerUp);
    };

    thumb.addEventListener("pointerdown", handlePointerDown);

    return () => {
      thumb.removeEventListener("pointerdown", handlePointerDown);
      thumb.removeEventListener("pointermove", handlePointerMove);
      thumb.removeEventListener("pointerup", handlePointerUp);
    };
  }, [thumbState.height]);

  return (
    <div className="scroll-viewport">
      <div ref={viewportRef} className={className}>
        {children}
      </div>

      {!autoScrollEnabled ? (
        <button
          type="button"
          className="scroll-viewport-jump"
          aria-label="Scroll to latest message"
          onClick={() => {
            const viewport = viewportRef.current;
            if (!viewport) {
              return;
            }

            autoScrollEnabledRef.current = true;
            setAutoScrollEnabled(true);
            viewport.scrollTop = viewport.scrollHeight;
          }}
        >
          <span className="scroll-viewport-jump-icon" aria-hidden="true" />
        </button>
      ) : null}

      {thumbState.visible ? (
        <div
          ref={thumbRef}
          className="scroll-viewport-thumb"
          data-dragging="false"
          style={{
            height: `${thumbState.height}px`,
            transform: `translateY(${thumbState.top}px)`,
          }}
        />
      ) : null}
    </div>
  );
}
