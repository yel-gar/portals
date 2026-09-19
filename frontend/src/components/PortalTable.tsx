import { EyeOutlined } from "@ant-design/icons";
import { Button, Progress, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Portal } from "../api/types";
import { formatDateTime, formatRelative, formatTimeLeft } from "../format";
import { DangerTag, RiskValue } from "./DangerTag";
import { MarkedTag } from "./MarkedTag";

/** Client-side presentation bands for the stability bar (not backend rules). */
function stabilityColor(value: number): string {
  if (value < 40) return "#fa541c";
  if (value < 70) return "#faad14";
  return "#52c41a";
}

interface PortalTableProps {
  portals: Portal[];
  loading: boolean;
  page: number;
  itemsPerPage: number;
  total: number;
  onPageChange: (page: number, itemsPerPage: number) => void;
  onOpen: (portal: Portal) => void;
}

export function PortalTable({
  portals,
  loading,
  page,
  itemsPerPage,
  total,
  onPageChange,
  onOpen,
}: PortalTableProps) {
  const columns: ColumnsType<Portal> = [
    {
      title: "Портал",
      key: "name",
      width: 220,
      fixed: "left",
      render: (_, portal) => (
        <div>
          <Typography.Text strong>{portal.name}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              #{portal.id}
            </Typography.Text>
            {portal.is_marked && <MarkedTag />}
          </div>
        </div>
      ),
    },
    {
      title: "Мир назначения",
      dataIndex: "destination_world",
      key: "world",
      width: 200,
      ellipsis: true,
    },
    {
      title: "Энергия",
      key: "energy",
      width: 140,
      render: (_, portal) => (
        <Progress percent={portal.energy_level} size="small" format={(value) => value} />
      ),
    },
    {
      title: "Стабильность",
      key: "stability",
      width: 140,
      render: (_, portal) => (
        <Progress
          percent={portal.stability}
          size="small"
          strokeColor={stabilityColor(portal.stability)}
          format={(value) => value}
        />
      ),
    },
    {
      title: "Существа",
      key: "creatures",
      width: 100,
      align: "center",
      render: (_, portal) =>
        portal.creatures_count > 0 ? (
          <Tag color="geekblue">{portal.creatures_count}</Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Риск",
      key: "risk",
      width: 90,
      align: "center",
      render: (_, portal) => (
        <RiskValue value={portal.risk_factor} level={portal.danger_level} strong />
      ),
    },
    {
      title: "Опасность",
      key: "danger",
      width: 130,
      render: (_, portal) => <DangerTag level={portal.danger_level} />,
    },
    {
      title: "Наблюдатель",
      key: "observer",
      width: 130,
      align: "center",
      render: (_, portal) =>
        portal.has_observer ? (
          <Tag color="cyan" icon={<EyeOutlined />}>
            внутри
          </Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Истекает",
      key: "expires",
      width: 150,
      render: (_, portal) =>
        portal.closed ? (
          <Tag color="red">закрыт</Tag>
        ) : (
          <Tooltip title={formatDateTime(portal.expires_at)}>
            {formatTimeLeft(portal.expires_at)}
          </Tooltip>
        ),
    },
    {
      title: "Обновлено",
      key: "updated",
      width: 150,
      render: (_, portal) => (
        <Tooltip title={formatDateTime(portal.last_update)}>
          <Typography.Text type="secondary">{formatRelative(portal.last_update)}</Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 100,
      fixed: "right",
      align: "center",
      render: (_, portal) => (
        <Button
          type="link"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(portal);
          }}
        >
          Открыть
        </Button>
      ),
    },
  ];

  return (
    <Table<Portal>
      rowKey="id"
      columns={columns}
      dataSource={portals}
      loading={loading}
      size="medium"
      scroll={{ x: 1450 }}
      onRow={(portal) => ({
        style: { cursor: "pointer" },
        onClick: () => onOpen(portal),
      })}
      pagination={{
        current: page,
        pageSize: itemsPerPage,
        total,
        showSizeChanger: true,
        pageSizeOptions: ["10", "20", "50", "100"],
        showTotal: (count, range) => `${range[0]}–${range[1]} из ${count}`,
      }}
      onChange={(pagination) => {
        const nextPage = pagination.current ?? 1;
        const nextSize = pagination.pageSize ?? itemsPerPage;
        if (nextPage !== page || nextSize !== itemsPerPage) {
          onPageChange(nextPage, nextSize);
        }
      }}
    />
  );
}
