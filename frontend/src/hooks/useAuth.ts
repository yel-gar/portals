import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import { authApi } from "../api/endpoints";
import type { Credentials, UserOut } from "../api/types";

/** Query key for the current user; `null` means "not authenticated". */
export const ME_QUERY_KEY = ["me"] as const;

/**
 * Thrown by `useRegister` when the account was created but the follow-up
 * auto-login failed — the user has an account and must sign in manually.
 */
export class PostRegisterLoginError extends Error {
  constructor(cause: unknown) {
    super("registration succeeded, but the automatic login failed");
    this.name = "PostRegisterLoginError";
    this.cause = cause;
  }
}

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
    staleTime: Infinity,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) => authApi.login(credentials),
    onSuccess: (user) => {
      queryClient.setQueryData(ME_QUERY_KEY, user);
    },
  });
}

/** Register a new account and, on success, log it straight in. */
export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: Credentials) => {
      await authApi.register(credentials);
      try {
        return await authApi.login(credentials);
      } catch (error) {
        // The account exists but the session wasn't established: the caller
        // must offer a manual sign-in instead of claiming registration failed.
        throw new PostRegisterLoginError(error);
      }
    },
    onSuccess: (user) => {
      queryClient.setQueryData(ME_QUERY_KEY, user);
    },
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
    },
  });
}
