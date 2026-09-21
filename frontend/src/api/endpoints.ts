import { request, type QueryValue } from "./client";
import type {
  Action,
  ActionLogPage,
  ActionLogParams,
  Credentials,
  Portal,
  PortalListParams,
  PortalPage,
  Stats,
  UserOut,
} from "./types";

export const authApi = {
  me: () => request<UserOut>("/auth/me"),
  login: (body: Credentials) => request<UserOut>("/auth/login", { method: "POST", body }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  register: (body: Credentials) => request<UserOut>("/auth/register", { method: "POST", body }),
};

/**
 * Full query-string mapping for the portal list — shared by the REST call and
 * the snapshot WS URL so both always request the exact same filtered page.
 * `undefined`/`null` values are dropped by the client, `""` filters nothing.
 */
export function portalListQuery(params: PortalListParams): Record<string, QueryValue> {
  return {
    page: params.page,
    items_per_page: params.itemsPerPage,
    closed: params.closed,
    danger_level: params.dangerLevel,
    has_observer: params.hasObserver,
    is_marked: params.isMarked,
    search: params.search || undefined,
    order_by: params.orderBy,
  };
}

/** Same shared mapping for the action log (REST + snapshot WS). */
export function actionLogQuery(params: ActionLogParams): Record<string, QueryValue> {
  return {
    page: params.page,
    items_per_page: params.itemsPerPage,
    action: params.action,
    portal_id: params.portalId,
    user_id: params.userId,
    order_by: params.orderBy,
  };
}

export const portalsApi = {
  list: (params: PortalListParams) =>
    request<PortalPage>("/portals", { query: portalListQuery(params) }),
  log: (params: ActionLogParams) =>
    request<ActionLogPage>("/portals/log", { query: actionLogQuery(params) }),
  stats: () => request<Stats>("/portals/stats"),
  /** Single portal detail (`GET /portals/{id}`) — used to poll the open modal. */
  info: (portalId: number) => request<Portal>(`/portals/${portalId}`),
  /** Execute an action; the backend validates it and records it in the action log. */
  action: (portalId: number, action: Action, force = false) =>
    request<Portal>(`/portals/${portalId}`, {
      method: "POST",
      query: force ? { action, force: true } : { action },
    }),
};

export const adminApi = {
  listUsers: () => request<UserOut[]>("/admin/users"),
  createUser: (body: Credentials) => request<UserOut>("/admin/users", { method: "POST", body }),
  deleteUser: (userId: number) => request<void>(`/admin/users/${userId}`, { method: "DELETE" }),
  setPassword: (userId: number, password: string) =>
    request<void>(`/admin/users/${userId}/set-password`, { method: "POST", body: { password } }),
};
