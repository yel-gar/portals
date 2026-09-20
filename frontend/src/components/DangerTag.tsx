import { Tag, Tooltip } from "antd";

import type { DangerLevel } from "../api/types";
import { DANGER_META } from "../constants";
import { toRiskPercent } from "../format";

/** Danger level as reported by the backend (`PortalSchema.danger_level`). */
export function DangerTag({ level }: { level: DangerLevel }) {
  const meta = DANGER_META[level];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

interface RiskValueProps {
  value: number;
  level: DangerLevel;
  strong?: boolean;
}

export function RiskValue({ value, level, strong = false }: RiskValueProps) {
  const meta = DANGER_META[level];
  return (
    <Tooltip title={`Уровень угрозы: ${meta.label.toLowerCase()}`}>
      <span style={{ color: meta.hex, fontWeight: strong ? 600 : 400 }}>
        {toRiskPercent(value)}
      </span>
    </Tooltip>
  );
}
