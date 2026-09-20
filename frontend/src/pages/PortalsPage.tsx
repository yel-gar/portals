import { useState } from "react";
import { TableOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Skeleton, Space, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import { portalsApi } from "../api/endpoints";
import type { Portal, PortalListParams } from "../api/types";
import {
  DEFAULT_PORTAL_FILTERS,
  PortalFiltersBar,
  type PortalFiltersState,
} from "../components/PortalFiltersBar";
import { PortalModal } from "../components/PortalModal";
import { PortalTable } from "../components/PortalTable";
import { StatCards } from "../components/StatCards";
import { portalPageKey, statsKey, usePortalPage, useStats } from "../hooks/usePortalData";
import { useSnapshotBaseline } from "../hooks/useSnapshotBaseline";
import { useReportLiveStatus } from "../live";

export function PortalsPage() {
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [filters, setFilters] = useState<PortalFiltersState>(DEFAULT_PORTAL_FILTERS);
  // The open modal must survive reordering: keep the portal the user clicked,
  // not a lookup against the current page snapshot.
  const [selectedPortal, setSelectedPortal] = useState<Portal | null>(null);

  const params: PortalListParams = { page, itemsPerPage, ...filters };
  const applyFilters = (patch: Partial<PortalFiltersState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const { query, liveStatus } = usePortalPage(params);
  const stats = useStats();
  useReportLiveStatus(liveStatus);
  // Placeholders (`keepPreviousData` from a previous scope) are excluded, so the
  // delta baseline never mixes snapshots from different pages/filters.
  const prevPage = useSnapshotBaseline(
    portalPageKey(params),
    query.isPlaceholderData ? undefined : query.data,
  );
  const prevStats = useSnapshotBaseline(statsKey, stats.isPlaceholderData ? undefined : stats.data);

  const portals = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const selectedId = selectedPortal?.id ?? null;
  // The open modal polls the single-portal endpoint: if the portal closes in
  // the background (expiry while the modal is open), the fresh copy greys out
  // the actions without waiting for the page snapshot to catch up.
  const detail = useQuery({
    queryKey: ["portals", "detail", selectedId],
    queryFn: () => portalsApi.info(selectedId!),
    enabled: selectedId !== null,
    refetchInterval: 10_000,
  });
  // `closed` is terminal (expiry and CLOSE never revert), so latch it: once
  // either source reports the portal closed, keep showing a closed copy. The
  // page snapshot must never flip the open card back to open — only the
  // detail endpoint (the correct per-portal data) moves it forward.
  const snapshotRow =
    selectedId !== null ? portals.find((portal) => portal.id === selectedId) : undefined;
  const closedCopy =
    snapshotRow?.closed === true
      ? snapshotRow
      : detail.data?.closed === true
        ? detail.data
        : undefined;
  // Otherwise the freshest source wins: background expiry reaches the card
  // through the detail poll, socket closes through the page snapshot. Ties
  // fall back to the snapshot row, then to the last known object so the modal
  // stays usable when the portal drops off the visible page (risk-DESC
  // reordering, a CLOSE sinking it to the end).
  const selected =
    selectedId === null
      ? null
      : (closedCopy ??
        (detail.data !== undefined && detail.dataUpdatedAt > query.dataUpdatedAt
          ? detail.data
          : (snapshotRow ?? selectedPortal)));

  return (
    <>
      {stats.data ? (
        <StatCards stats={stats.data} prevStats={prevStats} />
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
                prevPortals={prevPage?.items}
                loading={query.isPending}
                page={page}
                itemsPerPage={itemsPerPage}
                total={total}
                onPageChange={(nextPage, nextSize) => {
                  setPage(nextPage);
                  setItemsPerPage(nextSize);
                }}
                onOpen={(portal) => setSelectedPortal(portal)}
              />
            </div>
          </>
        )}
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Нажмите на портал, чтобы управлять им. Обновления приходят по WebSocket и целиком заменяют
        снапшот страницы.
      </Typography.Text>

      <PortalModal
        portal={selected}
        onClose={() => setSelectedPortal(null)}
        onPortalUpdated={(fresh) => setSelectedPortal(fresh)}
      />
    </>
  );
}
