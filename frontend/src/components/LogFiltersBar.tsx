import { Button, Select, Space } from "antd";

import type { Action, LogOrder } from "../api/types";
import { ACTION_META, ALL_ACTIONS } from "../constants";

/** Client-held filter state for the action log — mapped to backend query params. */
export interface LogFiltersState {
  action?: Action;
  orderBy: LogOrder;
}

export const DEFAULT_LOG_FILTERS: LogFiltersState = { orderBy: "newest" };

const ORDER_OPTIONS: Array<{ value: LogOrder; label: string }> = [
  { value: "newest", label: "Сначала новые" },
  { value: "oldest", label: "Сначала старые" },
];

interface LogFiltersBarProps {
  filters: LogFiltersState;
  onChange: (patch: Partial<LogFiltersState>) => void;
  onReset: () => void;
}

/** Server-driven filters/ordering for the action log (no client-side filtering). */
export function LogFiltersBar({ filters, onChange, onReset }: LogFiltersBarProps) {
  return (
    <Space wrap size="small" style={{ marginBottom: 16 }} data-testid="log-filters">
      <Select
        allowClear
        aria-label="Действие"
        placeholder="Действие"
        style={{ width: 230 }}
        value={filters.action}
        options={ALL_ACTIONS.map((action) => ({ value: action, label: ACTION_META[action].label }))}
        onChange={(value: Action | undefined) => onChange({ action: value })}
      />
      <Select
        aria-label="Сортировка"
        placeholder="Сортировка"
        style={{ width: 180 }}
        value={filters.orderBy}
        options={ORDER_OPTIONS}
        onChange={(value: LogOrder) => onChange({ orderBy: value })}
      />
      <Button onClick={onReset}>Сбросить</Button>
    </Space>
  );
}
