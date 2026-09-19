import { useState } from "react";
import { TableOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Skeleton, Space, Typography } from "antd";

import { ApiError } from "../api/client";
import type { PortalListParams } from "../api/types";
import {
  DEFAULT_PORTAL_FILTERS,
  PortalFiltersBar,
  type PortalFiltersState,
} from "../components/PortalFiltersBar";
import { PortalModal } from "../components/PortalModal";
import { PortalTable } from "../components/PortalTable";
import { StatCards } from "../components/StatCards";
import { usePortalPage, useStats } from "../hooks/usePortalData";
import { useReportLiveStatus } from "../live";

export function PortalsPage() {
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [filters, setFilters] = useState<PortalFiltersState>(DEFAULT_PORTAL_FILTERS);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params: PortalListParams = { page, itemsPerPage, ...filters };
  const applyFilters = (patch: Partial<PortalFiltersState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const { query, liveStatus } = usePortalPage(params);
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
        <Alert type="warning" showIcon title="Статистика недоступна" />
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
            title="Не удалось загрузить порталы"
            description={query.error instanceof ApiError ? query.error.message : undefined}
            action={<Button onClick={() => void query.refetch()}>Повторить</Button>}
          />
        ) : (
          <>
            <PortalFiltersBar
              filters={filters}
              onChange={applyFilters}
              onReset={() => applyFilters(DEFAULT_PORTAL_FILTERS)}
            />
            <div className="portals-table-bleed">
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
            </div>
          </>
        )}
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Кликните по строке, чтобы открыть карточку портала и выполнить действие. Обновления приходят
        по WebSocket и целиком заменяют снапшот страницы.
      </Typography.Text>

      <PortalModal portal={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
