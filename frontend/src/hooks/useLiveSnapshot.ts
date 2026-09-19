import { useQueryClient } from "@tanstack/react-query";

import { ME_QUERY_KEY } from "./useAuth";
import { useSnapshotWs, type LiveStatus } from "./useSnapshotWs";

/**
 * Write a snapshot WebSocket straight into the React Query cache under
 * `queryKey`. Each frame replaces the whole cached page (atomic replacement, no
 * merging), so the same hook can feed the portals page or the action log.
 *
 * A 4401 close means the session is gone: re-checking the current user routes
 * the app back to the login page.
 */
export function useLiveSnapshot<T>(url: string, queryKey: readonly unknown[]): LiveStatus {
  const queryClient = useQueryClient();
  return useSnapshotWs<T>(
    url,
    (snapshot) => {
      queryClient.setQueryData(queryKey, snapshot);
    },
    () => {
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    }
  );
}
