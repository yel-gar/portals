import { request } from "./client";
import type { Action, ActionLogPage, Credentials, Portal, PortalPage, Stats, UserOut } from "./types";

export const authApi = {
  me: () => request<UserOut>("/auth/me"),
  login: (body: Credentials) => request<UserOut>("/auth/login", { method: "POST", body }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  register: (body: Credentials) => request<UserOut>("/auth/register", { method: "POST", body })
};

export interface PageParams {
  page: number;
  itemsPerPage: number;
}

function pageQuery({ page, itemsPerPage }: PageParams) {
  return { page, items_per_page: itemsPerPage };
}

export const portalsApi = {
  list: (params: PageParams) => request<PortalPage>("/portals", { query: pageQuery(params) }),
  log: (params: PageParams) => request<ActionLogPage>("/portals/log", { query: pageQuery(params) }),
  stats: () => request<Stats>("/portals/stats"),
  /** Execute an action; the backend validates it and records it in the action log. */
  action: (portalId: number, action: Action) =>
    request<Portal>(`/portals/${portalId}`, { method: "POST", query: { action } })
};

export const adminApi = {
  listUsers: () => request<UserOut[]>("/admin/users"),
  createUser: (body: Credentials) => request<UserOut>("/admin/users", { method: "POST", body }),
  deleteUser: (userId: number) => request<void>(`/admin/users/${userId}`, { method: "DELETE" }),
  setPassword: (userId: number, password: string) =>
    request<void>(`/admin/users/${userId}/set-password`, { method: "POST", body: { password } })
};
