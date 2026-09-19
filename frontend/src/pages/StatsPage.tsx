import { Alert, Card, Col, Progress, Row, Skeleton, Typography, theme } from "antd";

import { DANGER_META, DANGER_ORDER } from "../constants";
import { toPercent } from "../format";
import { useStats } from "../hooks/usePortalData";
import { StatCards } from "../components/StatCards";

export function StatsPage() {
  const { token } = theme.useToken();
  const stats = useStats();

  if (stats.isError) {
    return <Alert type="error" showIcon title="Не удалось загрузить статистику" />;
  }
  if (!stats.data) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  const data = stats.data;
  const avgPercent = Math.round(data.avg_risk * 100);

  return (
    <>
      <StatCards stats={data} />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Распределение по уровню опасности" extra={<Typography.Text type="secondary">открытые порталы</Typography.Text>}>
            {DANGER_ORDER.map((level) => {
              const count = data.danger_levels[level] ?? 0;
              const percent = toPercent(count, data.open);
              return (
                <div key={level} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span>{DANGER_META[level].label}</span>
                    <Typography.Text type="secondary">
                      {count} шт · {percent}%
                    </Typography.Text>
                  </div>
                  <Progress
                    percent={percent}
                    size="small"
                    strokeColor={DANGER_META[level].hex}
                    showInfo={false}
                  />
                </div>
              );
            })}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Общее число порталов — {data.total}, из них открыто {data.open}, закрыто {data.closed}. Уровни опасности
              и средний риск рассчитываются сервером по открытым порталам.
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Средний риск по лаборатории">
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <Progress
                type="circle"
                size={150}
                percent={avgPercent}
                strokeColor={token.colorPrimary}
                format={() => (
                  <span style={{ fontSize: 22, fontWeight: 700 }}>{data.avg_risk.toFixed(2)}</span>
                )}
              />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Средний риск считается на сервере по энергии, стабильности, числу существ и оставшемуся времени жизни
              порталов.
            </Typography.Text>
          </Card>
        </Col>
      </Row>
    </>
  );
}
