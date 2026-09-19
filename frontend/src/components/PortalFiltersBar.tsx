import { useEffect, useState } from "react";
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

export const DEFAULT_PORTAL_FILTERS: PortalFiltersState = {
  search: "",
  orderBy: "risk"
};

const ORDER_OPTIONS: Array<{ value: PortalOrder; label: string }> = [
  { value: "risk", label: "По риску" },
  { value: "expires_at", label: "Срок истечения" },
  { value: "creatures", label: "Число существ" },
  { value: "name", label: "По алфавиту" }
];

interface PortalFiltersBarProps {
  filters: PortalFiltersState;
  onChange: (patch: Partial<PortalFiltersState>) => void;
  onReset: () => void;
}

/**
 * Server-driven filters/ordering for the portal table. These controls only add
 * query params the backend already supports — no client-side filtering — so the
 * backend remains the single source of truth.
 *
 * The search box keeps a local draft and applies it on submit (Enter / the
 * search button): each keystroke must not trigger a full server round trip and
 * a WebSocket reconnect.
 */
export function PortalFiltersBar({ filters, onChange, onReset }: PortalFiltersBarProps) {
  const [searchDraft, setSearchDraft] = useState(filters.search);

  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  return (
    <Space wrap size="small" style={{ marginBottom: 16 }} data-testid="portal-filters">
      <Input.Search
        allowClear
        aria-label="Поиск по названию или миру"
        placeholder="Поиск: название или мир"
        value={searchDraft}
        onChange={(event) => setSearchDraft(event.target.value)}
        onSearch={(value) => onChange({ search: value.trim() })}
        style={{ width: 260 }}
      />
      <Select
        allowClear
        aria-label="Состояние"
        placeholder="Состояние"
        style={{ width: 150 }}
        value={filters.closed}
        options={[
          { value: false, label: "Открытые" },
          { value: true, label: "Закрытые" }
        ]}
        onChange={(value: boolean | undefined) => onChange({ closed: value })}
      />
      <Select
        allowClear
        aria-label="Уровень опасности"
        placeholder="Уровень опасности"
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
          { value: false, label: "Без наблюдателя" }
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
          { value: false, label: "Не отмеченные" }
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
