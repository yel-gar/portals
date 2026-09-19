import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import { authApi } from "../api/endpoints";
import type { Credentials, UserOut } from "../api/types";

/** Query key for the current user; `null` means "not authenticated". */
export const ME_QUERY_KEY = ["me"] as const;

/**
 * Current user. A 401 is a normal "logged out" state, not an error, so the app
 * can route to the login page without an error boundary.
 */
export function useMe() {
  return useQuery<UserOut | null>({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) => authApi.login(credentials),
    onSuccess: (user) => {
      queryClient.setQueryData(ME_QUERY_KEY, user);
    }
  });
}

/** Register a new account and, on success, log it straight in. */
export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: Credentials) => {
      await authApi.register(credentials);
      return authApi.login(credentials);
    },
    onSuccess: (user) => {
      queryClient.setQueryData(ME_QUERY_KEY, user);
    }
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.setQueryData(ME_QUERY_KEY, null);
      // Drop every cached page so the next user never sees stale data.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    }
  });
}
