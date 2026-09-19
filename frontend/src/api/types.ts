/**
 * TypeScript mirrors of the backend Pydantic schemas (`backend/app/schemas.py`)
 * and enums (`backend/app/models.py`). The backend is the single source of
 * truth: these types must follow it, never the other way around.
 */

export type Action =
  | "CLOSE"
  | "STABILIZE"
  | "DISMISS"
  | "SEND_OBSERVER"
  | "RECALL_OBSERVER"
  | "MARK"
  | "UNMARK"
  | "WARN_CREATURES";

export type DangerLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** `PortalSchema`. */
export interface Portal {
  id: number;
  name: string;
  destination_world: string;
  energy_level: number;
  stability: number;
  closed: boolean;
  creatures_count: number;
  is_marked: boolean;
  has_observer: boolean;
  /** ISO 8601 UTC timestamp. */
  last_update: string;
  /** ISO 8601 UTC timestamp. */
  expires_at: string;
  risk_factor: number;
  danger_level: DangerLevel;
}

/** `PortalListSchema` — also the payload pushed over `/portals/ws`. */
export interface PortalPage {
  items: Portal[];
  page: number;
  items_per_page: number;
  total: number;
}

/** `UserOutSchema`. */
export interface UserOut {
  id: number;
  username: string;
  is_superuser: boolean;
}

/** `ActionLogEntrySchema`. */
export interface ActionLogEntry {
  id: number;
  portal_id: number;
  action: Action;
  /** ISO 8601 UTC timestamp. */
  timestamp: string;
  user: UserOut | null;
}

/** `ActionLogListSchema` — also the payload pushed over `/portals/log/ws`. */
export interface ActionLogPage {
  items: ActionLogEntry[];
  page: number;
  items_per_page: number;
  total: number;
}

/** `StatsSchema`. `danger_levels`/`avg_risk` cover open portals only. */
export interface Stats {
  total: number;
  open: number;
  closed: number;
  marked: number;
  with_observer: number;
  danger_levels: Record<DangerLevel, number>;
  avg_risk: number;
}

/** `LoginSchema` / `UserRegisterSchema` request bodies. */
export interface Credentials {
  username: string;
  password: string;
}
