import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { websocketUrl } from "../api/client";
import { portalsApi } from "../api/endpoints";
import type { ActionLogPage, PortalPage, Stats } from "../api/types";
import { useLiveSnapshot } from "./useLiveSnapshot";

/**
 * The backend only pushes snapshots when an action commits, so REST is also
 * polled at a low rate: that keeps expiry-driven changes (a portal closing when
 * its `expires_at` passes) visible. Both REST responses and WebSocket frames are
 * complete page snapshots, so whichever arrives last simply replaces the cache.
 */
const REFRESH_INTERVAL_MS = 30_000;
const STATS_REFRESH_INTERVAL_MS = 20_000;

export const portalPageKey = (page: number, itemsPerPage: number) =>
  ["portals", "page", page, itemsPerPage] as const;

export const actionLogPageKey = (page: number, itemsPerPage: number) =>
  ["portals", "log", page, itemsPerPage] as const;

export const statsKey = ["portals", "stats"] as const;

export function usePortalPage(page: number, itemsPerPage: number) {
  const query = useQuery<PortalPage>({
    queryKey: portalPageKey(page, itemsPerPage),
    queryFn: () => portalsApi.list({ page, itemsPerPage }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_MS
  });

  const liveStatus = useLiveSnapshot<PortalPage>(
    websocketUrl("/portals/ws", { page, items_per_page: itemsPerPage }),
    portalPageKey(page, itemsPerPage)
  );

  return { query, liveStatus };
}

export function useActionLogPage(page: number, itemsPerPage: number) {
  const query = useQuery<ActionLogPage>({
    queryKey: actionLogPageKey(page, itemsPerPage),
    queryFn: () => portalsApi.log({ page, itemsPerPage }),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_MS
  });

  const liveStatus = useLiveSnapshot<ActionLogPage>(
    websocketUrl("/portals/log/ws", { page, items_per_page: itemsPerPage }),
    actionLogPageKey(page, itemsPerPage)
  );

  return { query, liveStatus };
}

/** Aggregate stats have no WebSocket channel, so they are polled and invalidated after actions. */
export function useStats() {
  return useQuery<Stats>({
    queryKey: statsKey,
    queryFn: portalsApi.stats,
    refetchInterval: STATS_REFRESH_INTERVAL_MS
  });
}
