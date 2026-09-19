import { Card, Col, Row, Statistic, theme } from "antd";

import type { Stats } from "../api/types";
import { STAT_ICONS } from "../constants";

interface StatItem {
  key: string;
  title: string;
  value: number | string;
  color: string;
}

/**
 * Aggregate cards. Values come straight from `GET /portals/stats`; nothing is
 * derived from the current page. Icon colors are semantic (green = open,
 * grey = closed, orange = marked, cyan = observer).
 */
export function StatCards({ stats }: { stats: Stats }) {
  const { token } = theme.useToken();

  const items: StatItem[] = [
    { key: "total", title: "Всего порталов", value: stats.total, color: token.colorPrimary },
    { key: "open", title: "Открыто", value: stats.open, color: "#52c41a" },
    { key: "closed", title: "Закрыто", value: stats.closed, color: "#8c8c8c" },
    { key: "marked", title: "Отмечено", value: stats.marked, color: "#fa8c16" },
    { key: "withObserver", title: "С наблюдателем", value: stats.with_observer, color: "#13c2c2" },
    { key: "avgRisk", title: "Средний риск", value: stats.avg_risk.toFixed(2), color: token.colorPrimary }
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
              />
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
