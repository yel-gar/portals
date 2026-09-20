import { FileTextOutlined, ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Skeleton, Space, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.min.css";

/**
 * The worklog is read at runtime from the frontend origin (`/AI-WORKLOG.md`):
 * production nginx and the dev Vite server both mount the repo-root
 * `AI-WORKLOG.md` (see the docker-compose files), so the file displayed is
 * always the canonical one — there is no bundled copy to keep in sync.
 */
export function WorklogPage() {
  const worklog = useQuery({
    queryKey: ["worklog"],
    queryFn: async () => {
      const response = await fetch("/AI-WORKLOG.md");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    },
  });

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
      {worklog.isPending ? (
        <Skeleton active paragraph={{ rows: 12 }} />
      ) : worklog.isError ? (
        <Alert
          type="error"
          showIcon
          title="Не удалось загрузить журнал"
          description="Файл AI-WORKLOG.md недоступен на origin фронтенда. Проверьте монтирование тома в docker compose и повторите попытку."
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => worklog.refetch()}>
              Повторить
            </Button>
          }
        />
      ) : (
        <div className="worklog-markdown">
          <ReactMarkdown rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}>
            {worklog.data}
          </ReactMarkdown>
        </div>
      )}
    </Card>
  );
}
