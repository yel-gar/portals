import { useMutation, useQueryClient } from "@tanstack/react-query";

import { portalsApi } from "../api/endpoints";
import type { Action } from "../api/types";

export interface PortalActionVariables {
  portalId: number;
  action: Action;
}

/**
 * Execute a portal action. The backend validates it. On success every portal
 * query is invalidated so the table, log and stats refresh even if the live
 * WebSocket is unavailable; when it is available the pushed snapshot lands on
 * top as the same complete page payload.
 */
export function usePortalAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ portalId, action }: PortalActionVariables) => portalsApi.action(portalId, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portals"] });
    }
  });
}
