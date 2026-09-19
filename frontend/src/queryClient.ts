import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError } from "./api/client";
import { ME_QUERY_KEY } from "./hooks/useAuth";

interface QueryClientOptions {
  /** Query retry count; tests keep it at 0 so MSW handlers never replay. */
  retry?: number | boolean;
  /** How long query data stays fresh; tests use 0 for deterministic results. */
  staleTime?: number;
}

/**
 * Shared QueryClient factory (real app in `main.tsx`, tests in `render.tsx`).
 *
 * Any REST query or mutation answering 401 means the session cookie is gone or
 * invalid. Re-checking the current user — whose 401 is swallowed as a clean
 * «logged out» answer by `useMe` — routes the app back to the login page, the
 * same path the snapshot WebSocket takes on its 4401 close. The me query itself
 * never errors on 401, so this cannot self-trigger.
 */
export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  const { retry = 1, staleTime = 10_000 } = options;

  const sessionExpired = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    }
  };

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: sessionExpired }),
    mutationCache: new MutationCache({ onError: sessionExpired }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry,
        staleTime,
      },
    },
  });

  return queryClient;
}
