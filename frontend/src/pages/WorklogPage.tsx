import { FileTextOutlined } from "@ant-design/icons";
import { Card, Space, Typography } from "antd";
import ReactMarkdown from "react-markdown";

/**
 * Root `AI-WORKLOG.md` is a repository document; the Vite build context is
 * `frontend/` only, so a copy lives under `src/worklog/` and is bundled by the
 * `?raw` import. Keep the copy in sync with the repo-root file.
 */
import worklogSource from "../worklog/AI-WORKLOG.md?raw";

export function WorklogPage() {
  return (
    <Card
      title={
        <Space>
          <FileTextOutlined />
          Журнал разработки
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            AI-WORKLOG.md
          </Typography.Text>
        </Space>
      }
    >
      <div className="worklog-markdown">
        <ReactMarkdown>{worklogSource}</ReactMarkdown>
      </div>
    </Card>
  );
}
