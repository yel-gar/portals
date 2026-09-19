import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { websocketUrl } from "../api/client";
import { actionLogQuery, portalsApi, portalListQuery } from "../api/endpoints";
import type { ActionLogPage, ActionLogParams, PortalListParams, PortalPage, Stats } from "../api/types";
import { useLiveSnapshot } from "./useLiveSnapshot";

/**
 * The backend only pushes snapshots when an action commits, so REST is also
 * polled at a low rate: that keeps expiry-driven changes (a portal closing when
 * its `expires_at` passes) visible. Both REST responses and WebSocket frames are
 * complete page snapshots, so whichever arrives last simply replaces the cache.
 */
const REFRESH_INTERVAL_MS = 30_000;
const STATS_REFRESH_INTERVAL_MS = 20_000;

/**
 * Query keys carry the full params object: two different filter/order states
 * never share a cache entry, and the snapshot WS writes under the same key it
 * was requested with. TanStack Query hashes objects structurally, so a new
 * object with equal values dedupes to the same key.
 */
export const portalPageKey = (params: PortalListParams) => ["portals", "page", params] as const;

export const actionLogPageKey = (params: ActionLogParams) => ["portals", "log", params] as const;

export const statsKey = ["portals", "stats"] as const;

export function usePortalPage(params: PortalListParams) {
  const query = useQuery<PortalPage>({
    queryKey: portalPageKey(params),
    queryFn: () => portalsApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_MS
  });

  const liveStatus = useLiveSnapshot<PortalPage>(
    websocketUrl("/portals/ws", portalListQuery(params)),
    portalPageKey(params)
  );

  return { query, liveStatus };
}

export function useActionLogPage(params: ActionLogParams) {
  const query = useQuery<ActionLogPage>({
    queryKey: actionLogPageKey(params),
    queryFn: () => portalsApi.log(params),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_INTERVAL_MS
  });

  const liveStatus = useLiveSnapshot<ActionLogPage>(
    websocketUrl("/portals/log/ws", actionLogQuery(params)),
    actionLogPageKey(params)
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
