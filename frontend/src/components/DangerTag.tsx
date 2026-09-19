import { Tag, Tooltip } from "antd";

import type { DangerLevel } from "../api/types";
import { DANGER_META } from "../constants";

/** Danger level as reported by the backend (`PortalSchema.danger_level`). */
export function DangerTag({ level }: { level: DangerLevel }) {
  const meta = DANGER_META[level];
  return (
    <Tag color={meta.color}>
      {meta.label}
    </Tag>
  );
}

interface RiskValueProps {
  value: number;
  level: DangerLevel;
  strong?: boolean;
}

export function RiskValue({ value, level, strong = false }: RiskValueProps) {
  const meta = DANGER_META[level];
  return (
    <Tooltip title={`Уровень опасности: ${meta.label.toLowerCase()}`}>
      <span style={{ color: meta.hex, fontWeight: strong ? 600 : 400 }}>{value.toFixed(2)}</span>
    </Tooltip>
  );
}
