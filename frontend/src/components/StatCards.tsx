import { Card, Col, Row, Statistic, theme } from "antd";

import type { Stats } from "../api/types";
import { STAT_ICONS } from "../constants";
import { DeltaIndicator, type DeltaPolarity } from "./DeltaIndicator";

interface StatItem {
  key: string;
  title: string;
  value: number | string;
  color: string;
  /** Signed delta vs the previous stats snapshot (`null` = no baseline yet). */
  delta: number | null;
  polarity: DeltaPolarity;
  /** Deltas below this magnitude (by absolute value) render nothing. */
  minMagnitude?: number;
  format?: (value: number) => string;
}

/**
 * Aggregate cards. Values come straight from `GET /portals/stats`; nothing is
 * derived from the current page. Icon colors are semantic (green = open,
 * grey = closed, orange = marked, cyan = observer). Each card also carries a
 * delta badge vs the previous recorded snapshot, colored by what the change
 * means for the lab (see `DeltaIndicator`).
 */
export function StatCards({ stats, prevStats }: { stats: Stats; prevStats?: Stats }) {
  const { token } = theme.useToken();

  const delta = (pick: (prev: Stats, current: Stats) => number): number | null =>
    prevStats ? pick(prevStats, stats) : null;

  const items: StatItem[] = [
    {
      key: "total",
      title: "Всего порталов",
      value: stats.total,
      color: token.colorPrimary,
      delta: delta((prev, current) => current.total - prev.total),
      polarity: "neutral",
    },
    {
      key: "open",
      title: "Открыто",
      value: stats.open,
      color: "#52c41a",
      delta: delta((prev, current) => current.open - prev.open),
      polarity: "neutral",
    },
    {
      key: "closed",
      title: "Закрыто",
      value: stats.closed,
      color: "#8c8c8c",
      delta: delta((prev, current) => current.closed - prev.closed),
      polarity: "neutral",
    },
    {
      key: "marked",
      title: "Отмечено",
      value: stats.marked,
      color: "#fa8c16",
      delta: delta((prev, current) => current.marked - prev.marked),
      polarity: "good-when-up",
    },
    {
      key: "withObserver",
      title: "С наблюдателем",
      value: stats.with_observer,
      color: "#13c2c2",
      delta: delta((prev, current) => current.with_observer - prev.with_observer),
      polarity: "good-when-up",
    },
    {
      key: "avgRisk",
      title: "Средний риск",
      value: stats.avg_risk.toFixed(2),
      color: token.colorPrimary,
      delta: delta((prev, current) => current.avg_risk - prev.avg_risk),
      polarity: "good-when-down",
      minMagnitude: 0.01,
      format: (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`,
    },
  ];

  return (
    <Row gutter={[16, 16]}>
      {items.map((item) => {
        const Icon = STAT_ICONS[item.key as keyof typeof STAT_ICONS];
        return (
          <Col key={item.key} xs={24} sm={12} lg={8} xl={4}>
            <Card size="small">
              <Statistic
                title={item.title}
                value={item.value}
                prefix={Icon ? <Icon style={{ marginRight: 6, color: item.color }} /> : undefined}
                suffix={
                  item.delta !== null ? (
                    <DeltaIndicator
                      value={item.delta}
                      polarity={item.polarity}
                      minMagnitude={item.minMagnitude}
                      format={item.format}
                    />
                  ) : undefined
                }
              />
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
