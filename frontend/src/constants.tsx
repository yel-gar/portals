import type { ComponentType } from "react";
import {
  BarChartOutlined,
  DashboardOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  FlagFilled,
  FlagOutlined,
  LineChartOutlined,
  LockOutlined,
  RollbackOutlined,
  SendOutlined,
  SettingOutlined,
  SlidersOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UnlockOutlined,
  UnorderedListOutlined,
  WarningOutlined
} from "@ant-design/icons";

import type { Action, DangerLevel } from "./api/types";

/**
 * Presentation metadata only — Russian labels and AntD tag colors. Action
 * availability and risk/danger values are decided by the backend and must not
 * be recomputed here.
 */

export interface DangerMeta {
  label: string;
  /** AntD Tag color name. */
  color: string;
  /** Raw hex used for progress bars and text. */
  hex: string;
}

export const DANGER_META: Record<DangerLevel, DangerMeta> = {
  LOW: { label: "Низкий", color: "green", hex: "#52c41a" },
  MEDIUM: { label: "Средний", color: "gold", hex: "#faad14" },
  HIGH: { label: "Высокий", color: "volcano", hex: "#fa541c" },
  CRITICAL: { label: "Критический", color: "magenta", hex: "#eb2f96" }
};

export const DANGER_ORDER: DangerLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export interface ActionMeta {
  label: string;
  color: string;
  Icon: ComponentType;
}

export const ACTION_META: Record<Action, ActionMeta> = {
  CLOSE: { label: "Закрыть", color: "red", Icon: StopOutlined },
  STABILIZE: { label: "Стабилизировать", color: "blue", Icon: SlidersOutlined },
  DISMISS: { label: "Оставить открытым", color: "default", Icon: FieldTimeOutlined },
  SEND_OBSERVER: { label: "Отправить наблюдателя", color: "cyan", Icon: SendOutlined },
  RECALL_OBSERVER: { label: "Отозвать наблюдателя", color: "purple", Icon: RollbackOutlined },
  MARK: { label: "Отметить", color: "orange", Icon: FlagFilled },
  UNMARK: { label: "Снять отметку", color: "gold", Icon: FlagOutlined },
  WARN_CREATURES: { label: "Предупредить существ", color: "volcano", Icon: WarningOutlined }
};

/** Order in which actions are offered in the portal detail modal. */
export const ACTION_ORDER: Action[] = [
  "DISMISS",
  "STABILIZE",
  "SEND_OBSERVER",
  "RECALL_OBSERVER",
  "CLOSE",
  "MARK",
  "WARN_CREATURES"
];

/** Primary (filled) actions in the modal. */
export const PRIMARY_ACTIONS: ReadonlySet<Action> = new Set<Action>(["STABILIZE", "CLOSE"]);

/** Actions rendered with the AntD `danger` style. */
export const DANGER_ACTIONS: ReadonlySet<Action> = new Set<Action>(["CLOSE"]);

export const NAV_ICONS = {
  portals: DashboardOutlined,
  log: UnorderedListOutlined,
  stats: BarChartOutlined,
  admin: SettingOutlined
};

export const STAT_ICONS = {
  total: DashboardOutlined,
  open: UnlockOutlined,
  closed: LockOutlined,
  marked: FlagOutlined,
  withObserver: EyeOutlined,
  avgRisk: LineChartOutlined
};

export const LOGO_ICON = ThunderboltOutlined;
