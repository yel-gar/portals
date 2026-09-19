import { Layout, Typography } from "antd";

/**
 * Temporary shell used to validate the build pipeline. The real router,
 * pages and snapshot WebSocket wiring are implemented in the next milestone.
 */
export default function App() {
  return (
    <Layout className="app-shell">
      <div className="app-sider">
        <div className="app-logo">
          <span className="app-logo-icon">◈</span>
          <span>Лаборатория порталов</span>
        </div>
      </div>
      <div className="app-main">
        <div className="app-topline" />
        <div className="app-header">
          <div className="app-title">Порталы</div>
          <span className="app-live">
            <span className="app-live-dot" />
            Live
          </span>
        </div>
        <Layout.Content className="app-content">
          <Typography.Paragraph type="secondary">
            Каркас приложения собран. Реализация интерфейса — следующий шаг.
          </Typography.Paragraph>
        </Layout.Content>
      </div>
    </Layout>
  );
}
