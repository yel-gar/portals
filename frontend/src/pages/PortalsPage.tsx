import { useState } from "react";
import { TableOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Skeleton, Space, Typography } from "antd";

import { ApiError } from "../api/client";
import { PortalModal } from "../components/PortalModal";
import { PortalTable } from "../components/PortalTable";
import { StatCards } from "../components/StatCards";
import { usePortalPage, useStats } from "../hooks/usePortalData";
import { useReportLiveStatus } from "../live";

export function PortalsPage() {
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { query, liveStatus } = usePortalPage(page, itemsPerPage);
  const stats = useStats();
  useReportLiveStatus(liveStatus);

  const portals = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const selected = portals.find((portal) => portal.id === selectedId) ?? null;

  return (
    <>
      {stats.data ? (
        <StatCards stats={stats.data} />
      ) : stats.isError ? (
        <Alert type="warning" showIcon message="Статистика недоступна" />
      ) : (
        <Skeleton active paragraph={{ rows: 2 }} />
      )}

      <Card
        title={
          <Space>
            <TableOutlined />
            Активные порталы
          </Space>
        }
        extra={<Typography.Text type="secondary">Всего: {total}</Typography.Text>}
      >
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            message="Не удалось загрузить порталы"
            description={query.error instanceof ApiError ? query.error.message : undefined}
            action={<Button onClick={() => void query.refetch()}>Повторить</Button>}
          />
        ) : (
          <PortalTable
            portals={portals}
            loading={query.isPending}
            page={page}
            itemsPerPage={itemsPerPage}
            total={total}
            onPageChange={(nextPage, nextSize) => {
              setPage(nextPage);
              setItemsPerPage(nextSize);
            }}
            onOpen={(portal) => setSelectedId(portal.id)}
          />
        )}
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Кликните по строке, чтобы открыть карточку портала и выполнить действие. Обновления приходят по WebSocket и
        целиком заменяют снапшот страницы.
      </Typography.Text>

      <PortalModal portal={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
