import { useState } from "react";
import { Button, Input, Select, Space } from "antd";

import type { DangerLevel, PortalOrder } from "../api/types";
import { DANGER_META, DANGER_ORDER } from "../constants";

/** Client-held filter state for the portals page — mapped to backend query params. */
export interface PortalFiltersState {
  search: string;
  closed?: boolean;
  dangerLevel?: DangerLevel;
  hasObserver?: boolean;
  isMarked?: boolean;
  orderBy: PortalOrder;
}

/**
 * The fully-cleared filter state. The optional keys are listed explicitly (as
 * `undefined`) so a reset replaces them instead of spreading stale values over
 * the previous state — `onReset` must not silently keep a filter the operator
 * already cleared.
 */
export const DEFAULT_PORTAL_FILTERS: PortalFiltersState = {
  search: "",
  closed: undefined,
  dangerLevel: undefined,
  hasObserver: undefined,
  isMarked: undefined,
  orderBy: "risk",
};

const ORDER_OPTIONS: Array<{ value: PortalOrder; label: string }> = [
  { value: "risk", label: "По риску" },
  { value: "expires_at", label: "Срок истечения" },
  { value: "creatures", label: "Число существ" },
  { value: "name", label: "По алфавиту" },
];

interface PortalFiltersBarProps {
  filters: PortalFiltersState;
  onChange: (patch: Partial<PortalFiltersState>) => void;
  onReset: () => void;
}

/**
 * Search box owning its typing draft; commits only on submit (Enter / button).
 * The parent remounts it via `key` when the server-driven params change, so the
 * draft needs no props-sync effect.
 */
function SearchInput({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <Input.Search
      allowClear
      aria-label="Поиск по названию или миру"
      placeholder="Поиск: название или мир"
      value={draft}
      // Mirrors the backend cap (`Query(max_length=256)` in the portals list
      // route): longer input would otherwise produce a raw 422.
      maxLength={256}
      onChange={(event) => setDraft(event.target.value)}
      onSearch={(submitted) => onSearch(submitted.trim())}
      style={{ width: 260 }}
    />
  );
}

/**
 * Server-driven filters/ordering for the portal table. These controls only add
 * query params the backend already supports — no client-side filtering — so the
 * backend remains the single source of truth.
 *
 * The search box keeps a local draft and applies it on submit (Enter / the
 * search button): each keystroke must not trigger a full server round trip and
 * a WebSocket reconnect. The box is remounted via `key` whenever the server
 * params change externally (reset, back navigation), so its draft always
 * follows `filters.search` without a sync effect.
 */
export function PortalFiltersBar({ filters, onChange, onReset }: PortalFiltersBarProps) {
  return (
    <Space wrap size="small" style={{ marginBottom: 16 }} data-testid="portal-filters">
      <SearchInput
        key={filters.search}
        value={filters.search}
        onSearch={(value) => onChange({ search: value })}
      />
      <Select
        allowClear
        aria-label="Состояние"
        placeholder="Состояние"
        style={{ width: 150 }}
        value={filters.closed}
        options={[
          { value: false, label: "Открытые" },
          { value: true, label: "Закрытые" },
        ]}
        onChange={(value: boolean | undefined) => onChange({ closed: value })}
      />
      <Select
        allowClear
        aria-label="Уровень угрозы"
        placeholder="Уровень угрозы"
        style={{ width: 190 }}
        value={filters.dangerLevel}
        options={DANGER_ORDER.map((level) => ({ value: level, label: DANGER_META[level].label }))}
        onChange={(value: DangerLevel | undefined) => onChange({ dangerLevel: value })}
      />
      <Select
        allowClear
        aria-label="Наблюдатель"
        placeholder="Наблюдатель"
        style={{ width: 160 }}
        value={filters.hasObserver}
        options={[
          { value: true, label: "С наблюдателем" },
          { value: false, label: "Без наблюдателя" },
        ]}
        onChange={(value: boolean | undefined) => onChange({ hasObserver: value })}
      />
      <Select
        allowClear
        aria-label="Отметка"
        placeholder="Отметка"
        style={{ width: 160 }}
        value={filters.isMarked}
        options={[
          { value: true, label: "Отмеченные" },
          { value: false, label: "Не отмеченные" },
        ]}
        onChange={(value: boolean | undefined) => onChange({ isMarked: value })}
      />
      <Select
        aria-label="Сортировка"
        placeholder="Сортировка"
        style={{ width: 170 }}
        value={filters.orderBy}
        options={ORDER_OPTIONS}
        onChange={(value: PortalOrder) => onChange({ orderBy: value })}
      />
      <Button onClick={onReset}>Сбросить</Button>
    </Space>
  );
}
