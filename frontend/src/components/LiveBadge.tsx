import { Tooltip } from "antd";

import { useLiveStatus } from "../live";

const LABELS = {
  open: "Live",
  connecting: "Подключение",
  reconnecting: "Переподключение",
  unauthorized: "Сессия истекла",
} as const;

const HINTS = {
  open: "Живые обновления по WebSocket",
  connecting: "Устанавливается WebSocket-соединение",
  reconnecting: "Соединение потеряно, идёт переподключение",
  unauthorized: "Сессия истекла, требуется повторный вход",
} as const;

/** Header indicator for the live WebSocket channel of the current page. */
export function LiveBadge() {
  const status = useLiveStatus();
  return (
    <Tooltip title={HINTS[status]}>
      <span className={`app-live app-live--${status}`}>
        <span className="app-live-dot" />
        {LABELS[status]}
      </span>
    </Tooltip>
  );
}
