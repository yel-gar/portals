import { useState } from "react";
import { EyeOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Col, Descriptions, Divider, Modal, Row, Tag, Typography } from "antd";

import { ApiError } from "../api/client";
import type { Action, Portal } from "../api/types";
import { ACTION_META, ACTION_ORDER, DANGER_ACTIONS, PRIMARY_ACTIONS } from "../constants";
import { formatDateTime, formatRelative, formatTimeLeft } from "../format";
import { usePortalAction } from "../hooks/usePortalAction";
import { DangerTag, RiskValue } from "./DangerTag";

interface PortalModalProps {
  portal: Portal | null;
  onClose: () => void;
}

/**
 * Portal detail modal with the full action set. Actions are never disabled
 * client-side: availability is business logic owned by the backend, and a
 * rejected action returns its reason (HTTP 409) which is shown verbatim.
 */
export function PortalModal({ portal, onClose }: PortalModalProps) {
  const { message } = AntApp.useApp();
  const action = usePortalAction();
  const [pending, setPending] = useState<Action | null>(null);

  if (portal === null) {
    return null;
  }

  const run = (selected: Action) => {
    setPending(selected);
    action.mutate(
      { portalId: portal.id, action: selected },
      {
        onSuccess: () => {
          message.success(`Действие «${ACTION_META[selected].label}» выполнено`);
        },
        onError: (error) => {
          const text =
            error instanceof ApiError ? error.message : "Не удалось выполнить действие: сервер недоступен";
          message.error(text);
        },
        onSettled: () => {
          setPending(null);
        }
      }
    );
  };

  return (
    <Modal
      width={720}
      open
      centered
      footer={null}
      onCancel={onClose}
      title={
        <span>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {portal.name}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ marginInlineStart: 8 }}>
            #{portal.id}
          </Typography.Text>
          <span style={{ marginInlineStart: 10 }}>
            <DangerTag level={portal.danger_level} />
          </span>
          {portal.closed && (
            <Tag color="red" style={{ marginInlineStart: 6 }}>
              закрыт
            </Tag>
          )}
        </span>
      }
    >
      <Descriptions
        column={2}
        size="small"
        bordered
        items={[
          { key: "world", label: "Мир назначения", span: 2, children: portal.destination_world },
          {
            key: "energy",
            label: "Энергия",
            children: <span className="portal-inline-progress">{portal.energy_level}%</span>
          },
          {
            key: "stability",
            label: "Стабильность",
            children: <span className="portal-inline-progress">{portal.stability}%</span>
          },
          {
            key: "risk",
            label: "Риск",
            children: <RiskValue value={portal.risk_factor} level={portal.danger_level} strong />
          },
          { key: "danger", label: "Уровень опасности", children: <DangerTag level={portal.danger_level} /> },
          {
            key: "creatures",
            label: "Существа",
            children: portal.creatures_count > 0 ? `${portal.creatures_count} шт` : "нет"
          },
          {
            key: "marked",
            label: "Отметка",
            children: portal.is_marked ? <Tag color="orange">отмечен</Tag> : "нет"
          },
          {
            key: "observer",
            label: "Наблюдатель",
            children: portal.has_observer ? (
              <Tag color="cyan" icon={<EyeOutlined />}>
                внутри
              </Tag>
            ) : (
              "нет"
            )
          },
          {
            key: "expires",
            label: "Истекает",
            children: portal.closed ? "портал закрыт" : formatTimeLeft(portal.expires_at)
          },
          {
            key: "updated",
            label: "Обновлено",
            children: (
              <span title={formatDateTime(portal.last_update)}>{formatRelative(portal.last_update)}</span>
            )
          },
          { key: "expires_at", label: "Момент истечения", children: formatDateTime(portal.expires_at) }
        ]}
      />

      <Divider titlePlacement="left" plain style={{ margin: "20px 0 12px" }}>
        Действия
      </Divider>
      <Row gutter={[12, 12]}>
        {ACTION_ORDER.map((entry) => {
          const resolved: Action = entry === "MARK" ? (portal.is_marked ? "UNMARK" : "MARK") : entry;
          const meta = ACTION_META[resolved];
          const { Icon } = meta;
          const danger = DANGER_ACTIONS.has(resolved);
          return (
            <Col span={8} key={entry}>
              <Button
                block
                danger={danger}
                type={danger || PRIMARY_ACTIONS.has(resolved) ? "primary" : "default"}
                icon={<Icon />}
                loading={pending === resolved}
                disabled={pending !== null && pending !== resolved}
                onClick={() => run(resolved)}
              >
                {meta.label}
              </Button>
            </Col>
          );
        })}
      </Row>
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 14, fontSize: 12 }}>
        Допустимость действия проверяет сервер. Если оно недопустимо для текущего состояния портала, причина будет
        показана здесь же.
      </Typography.Text>
    </Modal>
  );
}
