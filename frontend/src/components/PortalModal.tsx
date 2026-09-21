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
  Skeleton,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { ApiError } from "../api/client";
import { portalsApi } from "../api/endpoints";
import type { Action, Portal } from "../api/types";
import {
  ACTION_META,
  ACTION_ORDER,
  DANGER_FILLED_ACTIONS,
  DANGER_OUTLINE_ACTIONS,
  PRIMARY_ACTIONS,
} from "../constants";
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
 *
 * The dialog is translucent glass over the live background (blurred content,
 * transparent header) instead of the opaque elevated token.
 *
 * The right-hand history panel shows the 5 latest log entries for this exact
 * portal (`GET /portals/log?portal_id=N`, the backend already filters by id)
 * and links to the full log page pre-filtered to the portal. The recommended
 * action (`portal.recommended_action`, scored backend-side) is outlined in
 * pulsing purple. A CLOSE on a critical portal with creatures inside asks for
 * an explicit confirmation and is then sent with `force=true`.
 */
export function PortalModal({ portal, onClose, onPortalUpdated }: PortalModalProps) {
  const { message, modal } = AntApp.useApp();
  const action = usePortalAction();
  // Keeps the «истекает» countdown and «назад» strings fresh while the modal is open.
  const now = useNow();
  const [pending, setPending] = useState<Action | null>(null);
  // The glass background crossfades in only after the enter animation: blur
  // is always on (it would otherwise pop in when the zoom settles), while the
  // solid elevated token covers the animation itself.
  const [entered, setEntered] = useState(false);
  // The id of the portal currently shown — `null` once closed. The action
  // response may land after the user already closed or switched the modal; the
  // success callback must not resurrect it, so the fresh portal is only fed
  // back while the modal still shows that same portal.
  const openPortalIdRef = useRef<number | null>(null);
  useEffect(() => {
    openPortalIdRef.current = portal?.id ?? null;
  }, [portal]);

  // Latest 5 actions for the shown portal. Refetches on every action success
  // (via the global ["portals"] invalidation in usePortalAction) and on the
  // 30 s log poll, so the panel tracks the log without its own WS channel.
  const history = useQuery({
    queryKey: ["portals", "log", "portal", portal?.id],
    queryFn: () =>
      portalsApi.log({ page: 1, itemsPerPage: 5, portalId: portal!.id, orderBy: "newest" }),
    enabled: portal !== null,
  });

  const doRun = (selected: Action, force: boolean) => {
    if (portal === null) {
      return;
    }
    setPending(selected);
    action.mutate(
      { portalId: portal.id, action: selected, force },
      {
        onSuccess: (fresh) => {
          if (openPortalIdRef.current === fresh.id) {
            // The response carries the recomputed `recommended_action`, so the
            // purple highlight moves to the next suggestion with no extra fetch.
            onPortalUpdated?.(fresh);
          }
          message.success(`Действие «${ACTION_META[selected].label}» выполнено`);
          // DISMISS («оставить открытым») defers the portal: the operator has
          // decided to leave it alone, so the detail modal closes itself.
          if (selected === "DISMISS") {
            onClose();
          }
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

  const run = (selected: Action) => {
    if (portal === null) {
      return;
    }
    // Force-close is backend-gated to CRITICAL portals; confirm the operator
    // really means it before sending `force=true`. Anything else (including a
    // CLOSE on a non-critical portal with creatures) goes through normally and
    // the backend answers 409 with the verbatim reason.
    if (
      selected === "CLOSE" &&
      portal.creatures_count > 0 &&
      portal.danger_level === "CRITICAL" &&
      !portal.closed
    ) {
      modal.confirm({
        title: "Принудительно закрыть портал?",
        content: `Внутри портала есть существа (${portal.creatures_count} шт). Принудительное закрытие разрешено только для критических порталов и может быть опасно. Продолжить?`,
        okText: "Закрыть принудительно",
        okType: "danger",
        cancelText: "Отмена",
        centered: true,
        onOk: () => doRun(selected, true),
      });
      return;
    }
    doRun(selected, false);
  };

  return (
    <Modal
      width={1040}
      open={portal !== null}
      centered
      footer={null}
      onCancel={onClose}
      afterOpenChange={(open) => setEntered(open)}
      styles={{
        container: {
          background: entered ? "rgba(23, 16, 8, 0.6)" : "#1e1409",
          backdropFilter: "blur(12px)",
          transition: "background-color 0.25s ease",
        },
        header: { background: "transparent" },
      }}
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
        <div className="portal-modal-layout">
          <div className="portal-modal-main">
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
                  label: "Уровень угрозы",
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
                  children: portal.closed
                    ? "портал закрыт"
                    : formatTimeLeft(portal.expires_at, now),
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
                const dangerOutline = DANGER_OUTLINE_ACTIONS.has(resolved);
                const danger = dangerOutline || DANGER_FILLED_ACTIONS.has(resolved);
                // Actions other than (un)marking are meaningless on a closed portal;
                // the backend would answer 409 anyway — disable them up front.
                const closedUnavailable =
                  portal.closed && resolved !== "MARK" && resolved !== "UNMARK";
                const recommended = resolved === portal.recommended_action && !portal.closed;
                return (
                  <Col span={8} key={entry}>
                    <Button
                      block
                      danger={danger}
                      type={PRIMARY_ACTIONS.has(resolved) ? "primary" : "default"}
                      icon={<Icon />}
                      loading={pending === resolved}
                      disabled={closedUnavailable || (pending !== null && pending !== resolved)}
                      onClick={() => run(resolved)}
                      className={recommended ? "portal-action-recommended" : undefined}
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
              <span className="portal-recommended-dot" /> Фиолетовая подсветка — рекомендованное
              действие. На закрытом портале доступны только отметка и снятие отметки. Допустимость
              остальных действий проверяет сервер — если действие недопустимо для текущего состояния
              портала, причина будет показана здесь же.
            </Typography.Text>
          </div>

          <aside className="portal-history">
            <div className="portal-history-inner">
              <Typography.Text strong>История портала</Typography.Text>
              <div style={{ marginTop: 8 }}>
                {history.isPending ? (
                  <Skeleton active paragraph={{ rows: 3 }} />
                ) : history.isError ? (
                  <Typography.Text type="secondary">Не удалось загрузить историю</Typography.Text>
                ) : history.data.items.length === 0 ? (
                  <Typography.Text type="secondary">Действий пока нет</Typography.Text>
                ) : (
                  history.data.items.map((entry) => (
                    <div key={entry.id} className="portal-history-row">
                      <Tag color={ACTION_META[entry.action].color}>
                        {ACTION_META[entry.action].label}
                      </Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        <span title={formatDateTime(entry.timestamp)}>
                          {formatRelative(entry.timestamp, now)}
                        </span>
                        {entry.user ? ` · ${entry.user.username}` : ""}
                      </Typography.Text>
                    </div>
                  ))
                )}
              </div>
              <Link
                to={`/log?portal_id=${portal.id}`}
                onClick={onClose}
                style={{ display: "inline-block", marginTop: 10 }}
              >
                Полная история портала
              </Link>
            </div>
          </aside>
        </div>
      )}
    </Modal>
  );
}
