import { useMutation, useQueryClient } from "@tanstack/react-query";

import { portalsApi } from "../api/endpoints";
import type { Action } from "../api/types";

export interface PortalActionVariables {
  portalId: number;
  action: Action;
  force?: boolean;
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
    mutationFn: ({ portalId, action, force }: PortalActionVariables) =>
      portalsApi.action(portalId, action, force ?? false),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portals"] });
    },
  });
}
