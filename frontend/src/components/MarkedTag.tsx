import { FlagFilled } from "@ant-design/icons";
import { Tag, Tooltip } from "antd";

/**
 * «Отмечено» badge for marked portals. Marked portals get no other client-side
 * treatment (no hiding or reordering) — per the "badge only" decision.
 */
export function MarkedTag() {
  return (
    <Tooltip title="Портал отмечен">
      <Tag color="orange" icon={<FlagFilled />} style={{ marginInlineStart: 6 }}>
        Отмечено
      </Tag>
    </Tooltip>
  );
}
