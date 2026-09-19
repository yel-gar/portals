import { useEffect, useRef, useState } from "react";

export type LiveStatus = "connecting" | "open" | "reconnecting" | "unauthorized";

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 15_000;
/** Close code the backend uses when the session cookie is missing or invalid. */
const AUTH_FAILED_CODE = 4401;

/**
 * Subscribe to a snapshot WebSocket. Every frame is a complete page snapshot and
 * is handed to `onSnapshot`, which replaces the cached page atomically — frames
 * are never merged.
 *
 * Reconnects with exponential backoff on unexpected closes and stops for good on
 * 4401, reporting the failure through `onUnauthorized`.
 */
export function useSnapshotWs<T>(
  url: string | null,
  onSnapshot: (snapshot: T) => void,
  onUnauthorized?: () => void
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const onSnapshotRef = useRef(onSnapshot);
  const onUnauthorizedRef = useRef(onUnauthorized);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
    onUnauthorizedRef.current = onUnauthorized;
  });

  useEffect(() => {
    if (!url) {
      return;
    }
    let disposed = false;
    let opened = false;
    let socket: WebSocket | null = null;
    let retries = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      if (disposed) {
        return;
      }
      setStatus(retries === 0 ? "connecting" : "reconnecting");
      opened = false;
      socket = new WebSocket(url);

      socket.onopen = () => {
        opened = true;
        retries = 0;
        setStatus("open");
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          onSnapshotRef.current(JSON.parse(event.data) as T);
        } catch {
          // A malformed frame is ignored; the next full snapshot replaces state.
        }
      };

      socket.onclose = (event: CloseEvent) => {
        if (disposed) {
          return;
        }
        if (event.code === AUTH_FAILED_CODE) {
          // The backend rejects an invalid-session handshake with this code
          // (post-accept); a rejected handshake (pre-accept) surfaces in the
          // browser as a plain 1006, caught by the `opened` check below.
          setStatus("unauthorized");
          onUnauthorizedRef.current?.();
          return;
        }
        if (!opened) {
          // Closed before the handshake completed: in practice an expired
          // session — the backend answers a bad cookie with HTTP 403, which
          // browsers surface as close 1006 rather than the 4401 the server
          // requested. Re-check auth; if the session really is gone the app
          // routes to login, otherwise the reconnect below just continues.
          onUnauthorizedRef.current?.();
        }
        const delay = Math.min(INITIAL_RETRY_MS * 2 ** retries, MAX_RETRY_MS);
        retries += 1;
        setStatus("reconnecting");
        retryTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      socket?.close();
    };
  }, [url]);

  return status;
}
