import { ClockCircleOutlined } from "@ant-design/icons";
import { Tag, Tooltip } from "antd";

import { formatDateTime } from "../format";

/**
 * «Отложен» badge for portals parked by DISMISS («Оставить открытым»). The
 * backend sinks parked portals below the rest of the open list, so without a
 * marker a higher-danger portal could sit under a lower-danger one with no
 * visible reason. Rendered while `dismissed_until` is still in the future.
 */
export function ParkedTag({ until }: { until: string }) {
  return (
    <Tooltip title={`Отложен до ${formatDateTime(until)}`}>
      <Tag color="blue" icon={<ClockCircleOutlined />} style={{ marginInlineStart: 6 }}>
        Отложен
      </Tag>
    </Tooltip>
  );
}
