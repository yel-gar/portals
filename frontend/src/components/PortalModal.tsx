import { useEffect, useRef, useState } from "react";
import { EyeOutlined } from "@ant-design/icons";
import {
  App as AntApp,
  Button,
  Col,
  Descriptions,
  Divider,
  Modal,
  Row,
  Tag,
  Typography,
} from "antd";

import { ApiError } from "../api/client";
import type { Action, Portal } from "../api/types";
import { ACTION_META, ACTION_ORDER, DANGER_ACTIONS, PRIMARY_ACTIONS } from "../constants";
import { formatDateTime, formatRelative, formatTimeLeft } from "../format";
import { usePortalAction } from "../hooks/usePortalAction";
import { useNow } from "../hooks/useNow";
import { DangerTag, RiskValue } from "./DangerTag";

interface PortalModalProps {
  portal: Portal | null;
  onClose: () => void;
  /**
   * Called with the freshest portal right after an action succeeds, so the
   * parent can keep its copy in sync (e.g. a CLOSE immediately greys out every
   * action) without waiting on the next snapshot.
   */
  onPortalUpdated?: (portal: Portal) => void;
}

/**
 * Portal detail modal with the full action set. On a closed portal only
 * MARK/UNMARK stay available — every other action is disabled client-side
 * because the backend rejects them with 409 for closed portals (that reason is
 * shown verbatim). Availability beyond that remains backend-owned.
 *
 * The Modal stays mounted with `open` controlled so antd plays the closing
 * motion too — unmounting the whole component on close would cut it short.
 */
export function PortalModal({ portal, onClose, onPortalUpdated }: PortalModalProps) {
  const { message } = AntApp.useApp();
  const action = usePortalAction();
  // Keeps the «истекает» countdown and «назад» strings fresh while the modal is open.
  const now = useNow();
  const [pending, setPending] = useState<Action | null>(null);
  // The id of the portal currently shown — `null` once closed. The action
  // response may land after the user already closed or switched the modal; the
  // success callback must not resurrect it, so the fresh portal is only fed
  // back while the modal still shows that same portal.
  const openPortalIdRef = useRef<number | null>(null);
  useEffect(() => {
    openPortalIdRef.current = portal?.id ?? null;
  }, [portal]);

  const run = (selected: Action) => {
    if (portal === null) {
      return;
    }
    setPending(selected);
    action.mutate(
      { portalId: portal.id, action: selected },
      {
        onSuccess: (fresh) => {
          if (openPortalIdRef.current === fresh.id) {
            onPortalUpdated?.(fresh);
          }
          message.success(`Действие «${ACTION_META[selected].label}» выполнено`);
        },
        onError: (error) => {
          const text =
            error instanceof ApiError
              ? error.message
              : "Не удалось выполнить действие: сервер недоступен";
          message.error(text);
        },
        onSettled: () => {
          setPending(null);
        },
      },
    );
  };

  return (
    <Modal
      width={720}
      open={portal !== null}
      centered
      footer={null}
      onCancel={onClose}
      title={
        portal !== null ? (
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
        ) : undefined
      }
    >
      {portal !== null && (
        <>
          <Descriptions
            column={2}
            size="small"
            bordered
            items={[
              {
                key: "world",
                label: "Мир назначения",
                span: 2,
                children: portal.destination_world,
              },
              {
                key: "energy",
                label: "Энергия",
                children: <span className="portal-inline-progress">{portal.energy_level}%</span>,
              },
              {
                key: "stability",
                label: "Стабильность",
                children: <span className="portal-inline-progress">{portal.stability}%</span>,
              },
              {
                key: "risk",
                label: "Риск",
                children: (
                  <RiskValue value={portal.risk_factor} level={portal.danger_level} strong />
                ),
              },
              {
                key: "danger",
                label: "Уровень опасности",
                children: <DangerTag level={portal.danger_level} />,
              },
              {
                key: "creatures",
                label: "Существа",
                children: portal.creatures_count > 0 ? `${portal.creatures_count} шт` : "нет",
              },
              {
                key: "marked",
                label: "Отметка",
                children: portal.is_marked ? <Tag color="orange">отмечен</Tag> : "нет",
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
                ),
              },
              {
                key: "expires",
                label: "Истекает",
                children: portal.closed ? "портал закрыт" : formatTimeLeft(portal.expires_at, now),
              },
              {
                key: "updated",
                label: "Обновлено",
                children: (
                  <span title={formatDateTime(portal.last_update)}>
                    {formatRelative(portal.last_update, now)}
                  </span>
                ),
              },
              {
                key: "expires_at",
                label: "Момент истечения",
                children: formatDateTime(portal.expires_at),
              },
            ]}
          />

          <Divider titlePlacement="left" plain style={{ margin: "20px 0 12px" }}>
            Действия
          </Divider>
          <Row gutter={[12, 12]}>
            {ACTION_ORDER.map((entry) => {
              const resolved: Action =
                entry === "MARK"
                  ? portal.is_marked
                    ? "UNMARK"
                    : "MARK"
                  : entry === "SEND_OBSERVER"
                    ? portal.has_observer
                      ? "RECALL_OBSERVER"
                      : "SEND_OBSERVER"
                    : entry;
              const meta = ACTION_META[resolved];
              const { Icon } = meta;
              const danger = DANGER_ACTIONS.has(resolved);
              // Actions other than (un)marking are meaningless on a closed portal;
              // the backend would answer 409 anyway — disable them up front.
              const closedUnavailable =
                portal.closed && resolved !== "MARK" && resolved !== "UNMARK";
              return (
                <Col span={8} key={entry}>
                  <Button
                    block
                    danger={danger}
                    type={danger || PRIMARY_ACTIONS.has(resolved) ? "primary" : "default"}
                    icon={<Icon />}
                    loading={pending === resolved}
                    disabled={closedUnavailable || (pending !== null && pending !== resolved)}
                    onClick={() => run(resolved)}
                  >
                    {meta.label}
                  </Button>
                </Col>
              );
            })}
          </Row>
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginTop: 14, fontSize: 12 }}
          >
            На закрытом портале доступны только отметка и снятие отметки. Допустимость остальных
            действий проверяет сервер — если действие недопустимо для текущего состояния портала,
            причина будет показана здесь же.
          </Typography.Text>
        </>
      )}
    </Modal>
  );
}
