import { startTransition, useEffect, useState } from "react";

import { UnauthorizedError, fetchInit, listAllThreads } from "../client/api";
import { getErrorMessage } from "../lib/errors";
import { safeSocketEvent } from "../lib/socket";
import { useAppStore } from "../client/store";
import type { UseBackendInitializationOptions } from "../types";

export function useBackendInitialization(options: UseBackendInitializationOptions) {
  const { backendStatus, enabled, replaceThreads, setActionError, setSnapshot } = options;
  const [listLoading, setListLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setListLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await fetchInit();
        if (!cancelled) {
          setSnapshot(snapshot);
        }
      } catch (error) {
        if (!cancelled && !(error instanceof UnauthorizedError)) {
          setActionError(getErrorMessage(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, setActionError, setSnapshot]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/events`);

      socket.onmessage = (messageEvent) => {
        const event = safeSocketEvent(messageEvent.data);
        if (!event) {
          return;
        }

        if (event.type === "snapshot" || event.type === "backendStatus") {
          useAppStore.getState().setSnapshot(event.payload);
          return;
        }

        if (event.type === "notification") {
          useAppStore.getState().applyNotification(event.method, event.params);
          return;
        }

        useAppStore.getState().putServerRequest(event.request);
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }

        retryTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      active = false;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      socket?.close();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || backendStatus !== "ready") {
      return;
    }

    let cancelled = false;

    void (async () => {
      setListLoading(true);
      try {
        const threads = await listAllThreads();
        if (!cancelled) {
          startTransition(() => {
            replaceThreads(threads);
          });
        }
      } catch (error) {
        if (!cancelled && !(error instanceof UnauthorizedError)) {
          setActionError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setListLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [backendStatus, enabled, replaceThreads, setActionError]);

  return {
    listLoading,
  };
}
