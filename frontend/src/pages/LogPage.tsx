import { useState } from "react";
import { UnorderedListOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "../api/client";
import type { ActionLogEntry, ActionLogParams } from "../api/types";
import { ACTION_META } from "../constants";
import {
  DEFAULT_LOG_FILTERS,
  LogFiltersBar,
  type LogFiltersState,
} from "../components/LogFiltersBar";
import { formatDateTime, formatRelative } from "../format";
import { useNow } from "../hooks/useNow";
import { useActionLogPage } from "../hooks/usePortalData";
import { useReportLiveStatus } from "../live";

export function LogPage() {
  const now = useNow();
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [searchParams, setSearchParams] = useSearchParams();
  // A per-portal history link (`/log?portal_id=N`, e.g. from the portal modal)
  // pre-filters the log to that portal. Read once on mount; afterwards the
  // filter lives in component state so «Сбросить» clears it like any other.
  const [filters, setFilters] = useState<LogFiltersState>(() => {
    const portalId = Number(searchParams.get("portal_id"));
    return {
      ...DEFAULT_LOG_FILTERS,
      portalId: Number.isInteger(portalId) && portalId > 0 ? portalId : undefined,
    };
  });

  const params: ActionLogParams = { page, itemsPerPage, ...filters };
  const applyFilters = (patch: Partial<LogFiltersState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };
  const clearPortalFilter = () => {
    applyFilters({ portalId: undefined });
    setSearchParams(
      (prev) => {
        prev.delete("portal_id");
        return prev;
      },
      { replace: true },
    );
  };

  const { query, liveStatus } = useActionLogPage(params);
  useReportLiveStatus(liveStatus);

  const entries = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const columns: ColumnsType<ActionLogEntry> = [
    {
      title: "Время",
      key: "time",
      width: 170,
      render: (_, entry) => (
        <Tooltip title={formatDateTime(entry.timestamp)}>
          <Typography.Text>{formatRelative(entry.timestamp, now)}</Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "Портал",
      key: "portal",
      width: 160,
      render: (_, entry) => <Typography.Text strong>#{entry.portal_id}</Typography.Text>,
    },
    {
      title: "Действие",
      key: "action",
      width: 230,
      render: (_, entry) => {
        const meta = ACTION_META[entry.action];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "Пользователь",
      key: "user",
      width: 200,
      render: (_, entry) =>
        entry.user ? (
          entry.user.username
        ) : (
          <Typography.Text type="secondary">учётная запись удалена</Typography.Text>
        ),
    },
    {
      title: "Запись",
      key: "id",
      width: 100,
      align: "center",
      render: (_, entry) => <Typography.Text type="secondary">#{entry.id}</Typography.Text>,
    },
  ];

  return (
    <Card
      title={
        <Space>
          <UnorderedListOutlined />
          Последние действия
        </Space>
      }
      extra={<Typography.Text type="secondary">Всего: {total}</Typography.Text>}
    >
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          title="Не удалось загрузить журнал действий"
          description={query.error instanceof ApiError ? query.error.message : undefined}
          action={<Button onClick={() => void query.refetch()}>Повторить</Button>}
        />
      ) : (
        <>
          <LogFiltersBar
            filters={filters}
            onChange={applyFilters}
            onReset={() => {
              applyFilters(DEFAULT_LOG_FILTERS);
              setSearchParams((prev) => {
                prev.delete("portal_id");
                return prev;
              });
            }}
          />
          {filters.portalId !== undefined && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              title={`Показаны действия портала #${filters.portalId}`}
              action={<Button onClick={clearPortalFilter}>Показать все</Button>}
            />
          )}
          <Table<ActionLogEntry>
            rowKey="id"
            columns={columns}
            dataSource={entries}
            loading={query.isPending}
            size="medium"
            onChange={(pagination) => {
              const nextPage = pagination.current ?? 1;
              const nextSize = pagination.pageSize ?? itemsPerPage;
              if (nextPage !== page || nextSize !== itemsPerPage) {
                setPage(nextPage);
                setItemsPerPage(nextSize);
              }
            }}
            pagination={{
              current: page,
              pageSize: itemsPerPage,
              total,
              showSizeChanger: true,
              pageSizeOptions: ["10", "20", "50", "100"],
              showTotal: (count, range) => `${range[0]}–${range[1]} из ${count}`,
            }}
          />
        </>
      )}
    </Card>
  );
}
