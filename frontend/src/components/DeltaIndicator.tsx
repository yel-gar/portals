import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

/** What an increase means for the metric the delta is attached to. */
export type DeltaPolarity = "good-when-up" | "good-when-down" | "neutral";

const COLOR_GOOD = "#52c41a";
const COLOR_BAD = "#fa541c";
const COLOR_NEUTRAL = "#b8864f";

export interface DeltaIndicatorProps {
  /** Signed difference: positive = increase, negative = decrease. */
  value: number;
  polarity: DeltaPolarity;
  /** Optional formatting (e.g. risk percent points) — defaults to the plain signed number. */
  format?: (value: number) => string;
  /** Deltas smaller than this magnitude (by absolute value) render nothing — kills risk jitter. */
  minMagnitude?: number;
}

/**
 * «▲ +3» / «▼ −2» badge showing the change since the last recorded snapshot.
 * Colored by polarity so an operator can read at a glance whether the change
 * is good (green), bad (red) or neutral (embers amber). Renders nothing for a
 * zero delta or one below `minMagnitude`.
 */
export function DeltaIndicator({ value, polarity, format, minMagnitude = 0 }: DeltaIndicatorProps) {
  if (value === 0 || Math.abs(value) < minMagnitude) {
    return null;
  }
  const increase = value > 0;
  const isGood = polarity === "neutral" ? null : polarity === "good-when-up" ? increase : !increase;
  const color = isGood === null ? COLOR_NEUTRAL : isGood ? COLOR_GOOD : COLOR_BAD;
  const text = format ? format(value) : `${increase ? "+" : ""}${value}`;
  const Arrow = increase ? ArrowUpOutlined : ArrowDownOutlined;

  return (
    <Tooltip title="Изменение с прошлого снапшота">
      <span className="delta-indicator" style={{ color, fontSize: 12 }} aria-label="delta">
        <Arrow style={{ fontSize: 10 }} />
        {text}
      </span>
    </Tooltip>
  );
}
