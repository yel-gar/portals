import { useState } from "react";
import { UnorderedListOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { ApiError } from "../api/client";
import type { ActionLogEntry } from "../api/types";
import { ACTION_META } from "../constants";
import { formatDateTime, formatRelative } from "../format";
import { useActionLogPage } from "../hooks/usePortalData";
import { useReportLiveStatus } from "../live";

export function LogPage() {
  const [page, setPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const { query, liveStatus } = useActionLogPage(page, itemsPerPage);
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
          <Typography.Text>{formatRelative(entry.timestamp)}</Typography.Text>
        </Tooltip>
      )
    },
    {
      title: "Портал",
      key: "portal",
      width: 160,
      render: (_, entry) => <Typography.Text strong>#{entry.portal_id}</Typography.Text>
    },
    {
      title: "Действие",
      key: "action",
      width: 230,
      render: (_, entry) => {
        const meta = ACTION_META[entry.action];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      }
    },
    {
      title: "Пользователь",
      key: "user",
      width: 200,
      render: (_, entry) =>
        entry.user ? entry.user.username : <Typography.Text type="secondary">учётная запись удалена</Typography.Text>
    },
    {
      title: "Запись",
      key: "id",
      width: 100,
      align: "center",
      render: (_, entry) => <Typography.Text type="secondary">#{entry.id}</Typography.Text>
    }
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
          message="Не удалось загрузить журнал действий"
          description={query.error instanceof ApiError ? query.error.message : undefined}
          action={<Button onClick={() => void query.refetch()}>Повторить</Button>}
        />
      ) : (
        <Table<ActionLogEntry>
          rowKey="id"
          columns={columns}
          dataSource={entries}
          loading={query.isPending}
          size="middle"
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
            showTotal: (count, range) => `${range[0]}–${range[1]} из ${count}`
          }}
        />
      )}
    </Card>
  );
}
