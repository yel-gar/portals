import type { ComponentType } from "react";
import type { ButtonProps } from "antd";
import {
  BarChartOutlined,
  DashboardOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
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
  WarningOutlined,
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
  CRITICAL: { label: "Критический", color: "magenta", hex: "#eb2f96" },
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
  WARN_CREATURES: { label: "Предупредить существ", color: "volcano", Icon: WarningOutlined },
};

/** Every action the backend can log — the full `Action` enum, used by the log filter. */
export const ALL_ACTIONS: Action[] = [
  "DISMISS",
  "STABILIZE",
  "SEND_OBSERVER",
  "RECALL_OBSERVER",
  "CLOSE",
  "MARK",
  "UNMARK",
  "WARN_CREATURES",
];

/**
 * Order in which actions are offered in the portal detail modal. RECALL_OBSERVER
 * is intentionally absent: the «Наблюдатель» entry is a toggle resolved from
 * `portal.has_observer` (send when empty, recall when present) — the two
 * directions stay distinct in the action log only.
 */
export const ACTION_ORDER: Action[] = [
  "DISMISS",
  "STABILIZE",
  "SEND_OBSERVER",
  "CLOSE",
  "MARK",
  "WARN_CREATURES",
];

/**
 * Modal action-button palette. Constructive directions use AntD's tonal
 * `filled` variant (dark tinted background + colored text) so the bright hues
 * settle into the dark theme and the purple "recommended" ring stays legible;
 * the cancel direction of each toggle is a red outline, and DISMISS stays
 * neutral.
 */
export const ACTION_BUTTON_STYLE: Record<
  Action,
  Required<Pick<ButtonProps, "color" | "variant">>
> = {
  DISMISS: { color: "default", variant: "outlined" },
  STABILIZE: { color: "green", variant: "filled" },
  SEND_OBSERVER: { color: "blue", variant: "filled" },
  RECALL_OBSERVER: { color: "danger", variant: "outlined" },
  CLOSE: { color: "danger", variant: "filled" },
  MARK: { color: "yellow", variant: "filled" },
  UNMARK: { color: "danger", variant: "outlined" },
  WARN_CREATURES: { color: "primary", variant: "filled" },
};

export const NAV_ICONS = {
  portals: DashboardOutlined,
  log: UnorderedListOutlined,
  stats: BarChartOutlined,
  worklog: FileTextOutlined,
  admin: SettingOutlined,
};

export const STAT_ICONS = {
  total: DashboardOutlined,
  open: UnlockOutlined,
  closed: LockOutlined,
  marked: FlagOutlined,
  withObserver: EyeOutlined,
  avgRisk: LineChartOutlined,
};

export const LOGO_ICON = ThunderboltOutlined;
