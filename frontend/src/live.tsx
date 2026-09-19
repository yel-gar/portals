import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { LiveStatus } from "./hooks/useSnapshotWs";

interface LiveStatusValue {
  status: LiveStatus;
  report: (status: LiveStatus) => void;
}

const LiveStatusContext = createContext<LiveStatusValue | null>(null);

/**
 * Tracks the WebSocket status of the page that owns the live channel, so the
 * shell header can show it without every page rendering its own indicator.
 */
export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const value = useMemo<LiveStatusValue>(() => ({ status, report: setStatus }), [status]);
  return <LiveStatusContext.Provider value={value}>{children}</LiveStatusContext.Provider>;
}

export function useLiveStatus(): LiveStatus {
  return useContext(LiveStatusContext)?.status ?? "connecting";
}

/** Report the current page's WebSocket status to the shell header. */
export function useReportLiveStatus(status: LiveStatus): void {
  const report = useContext(LiveStatusContext)?.report;
  useEffect(() => {
    report?.(status);
  }, [report, status]);
}
