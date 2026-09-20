import { EyeOutlined } from "@ant-design/icons";
import { Progress, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useRef } from "react";

import type { Portal } from "../api/types";
import { formatDateTime, formatRelative, formatRiskDelta, formatTimeLeft } from "../format";
import { useFlip } from "../hooks/useFlip";
import { useNow } from "../hooks/useNow";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { DeltaIndicator } from "./DeltaIndicator";
import { DangerTag, RiskValue } from "./DangerTag";
import { MarkedTag } from "./MarkedTag";

/** Client-side presentation bands for the stability bar (not backend rules). */
function stabilityColor(value: number): string {
  if (value < 40) return "#fa541c";
  if (value < 70) return "#faad14";
  return "#52c41a";
}

/** Energy bar mirrors stability: full energy burns bright orange, empty is calm green. */
function energyColor(value: number): string {
  if (value > 60) return "#fa541c";
  if (value > 30) return "#faad14";
  return "#52c41a";
}

interface PortalTableProps {
  portals: Portal[];
  /** The `items` of the previous page snapshot — per-row deltas live here. */
  prevPortals?: Portal[];
  loading: boolean;
  page: number;
  itemsPerPage: number;
  total: number;
  onPageChange: (page: number, itemsPerPage: number) => void;
  onOpen: (portal: Portal) => void;
}

export function PortalTable({
  portals,
  prevPortals,
  loading,
  page,
  itemsPerPage,
  total,
  onPageChange,
  onOpen,
}: PortalTableProps) {
  // Re-render on a clock so «истекает» countdowns and «назад» strings stay fresh.
  const now = useNow();
  // FLIP move animation on row reorders: rows are keyed via `data-flip-key`,
  // and the animation is skipped under reduced motion.
  const flipRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const flipKeys = useMemo(() => portals.map((portal) => portal.id), [portals]);
  useFlip(flipKeys, flipRef, !reducedMotion);
  // Snapshots may reorder or add rows; deltas are only meaningful per portal id.
  const prevById = useMemo(
    () => new Map(prevPortals?.map((portal) => [portal.id, portal]) ?? []),
    [prevPortals],
  );
  const delta = (
    portal: Portal,
    pick: (prev: Portal, current: Portal) => number,
  ): number | null => {
    const prev = prevById.get(portal.id);
    return prev ? pick(prev, portal) : null;
  };

  const columns: ColumnsType<Portal> = [
    {
      title: "Портал",
      key: "name",
      width: 220,
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
      width: 150,
      render: (_, portal) => {
        const value = delta(portal, (prev, current) => current.energy_level - prev.energy_level);
        return (
          <div className="portal-cell-numeric">
            <Progress
              percent={portal.energy_level}
              size="small"
              strokeColor={energyColor(portal.energy_level)}
              format={(v) => v}
            />
            {value !== null && <DeltaIndicator value={value} polarity="good-when-down" />}
          </div>
        );
      },
    },
    {
      title: "Стабильность",
      key: "stability",
      width: 150,
      render: (_, portal) => {
        const value = delta(portal, (prev, current) => current.stability - prev.stability);
        return (
          <div className="portal-cell-numeric">
            <Progress
              percent={portal.stability}
              size="small"
              strokeColor={stabilityColor(portal.stability)}
              format={(v) => v}
            />
            {value !== null && <DeltaIndicator value={value} polarity="good-when-up" />}
          </div>
        );
      },
    },
    {
      title: "Существа",
      key: "creatures",
      width: 100,
      align: "center",
      render: (_, portal) => {
        const value = delta(
          portal,
          (prev, current) => current.creatures_count - prev.creatures_count,
        );
        return (
          <div className="portal-cell-numeric portal-cell-numeric--center">
            {portal.creatures_count > 0 ? (
              <Tag color="geekblue">{portal.creatures_count}</Tag>
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
            {value !== null && <DeltaIndicator value={value} polarity="good-when-down" />}
          </div>
        );
      },
    },
    {
      title: "Риск",
      key: "risk",
      width: 100,
      align: "center",
      render: (_, portal) => {
        const value = delta(portal, (prev, current) => current.risk_factor - prev.risk_factor);
        return (
          <div className="portal-cell-numeric portal-cell-numeric--center">
            <RiskValue value={portal.risk_factor} level={portal.danger_level} strong />
            {value !== null && (
              <DeltaIndicator
                value={value}
                polarity="good-when-down"
                minMagnitude={0.01}
                format={(v) => formatRiskDelta(v)}
              />
            )}
          </div>
        );
      },
    },
    {
      title: "Уровень угрозы",
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
            {formatTimeLeft(portal.expires_at, now)}
          </Tooltip>
        ),
    },
    {
      title: "Обновлено",
      key: "updated",
      width: 150,
      render: (_, portal) => (
        <Tooltip title={formatDateTime(portal.last_update)}>
          <Typography.Text type="secondary">
            {formatRelative(portal.last_update, now)}
          </Typography.Text>
        </Tooltip>
      ),
    },
  ];

  return (
    <div ref={flipRef}>
      <Table<Portal>
        rowKey="id"
        columns={columns}
        dataSource={portals}
        loading={loading}
        size="medium"
        scroll={{ x: 1480 }}
        onRow={(portal) => ({
          "data-flip-key": String(portal.id),
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
    </div>
  );
}
