import { ReloadOutlined, UserOutlined, LogoutOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Layout, Menu } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useLogout, useMe } from "../hooks/useAuth";
import { LOGO_ICON, NAV_ICONS } from "../constants";
import { FirePanels } from "./fire/FirePanels";
import { LiveBadge } from "./LiveBadge";

interface PageMeta {
  path: string;
  title: string;
  subtitle: string;
}

const PAGE_META: PageMeta[] = [
  {
    path: "/portals",
    title: "Порталы",
    subtitle: "Живая таблица лаборатории — обновляется по WebSocket",
  },
  {
    path: "/log",
    title: "Журнал действий",
    subtitle: "Все действия операторов — поток по WebSocket",
  },
  { path: "/stats", title: "Статистика", subtitle: "Сводка по порталам лаборатории" },
  {
    path: "/worklog",
    title: "Журнал разработки",
    subtitle: "AI-WORKLOG.md — история разработки проекта",
  },
  {
    path: "/admin/users",
    title: "Администрирование",
    subtitle: "Управление пользователями — только для суперпользователя",
  },
];

function usePageMeta(pathname: string): PageMeta {
  return PAGE_META.find((meta) => pathname.startsWith(meta.path)) ?? PAGE_META[0]!;
}

export function AppLayout() {
  const { message } = AntApp.useApp();
  const { data: user } = useMe();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const meta = usePageMeta(location.pathname);
  const LogoIcon = LOGO_ICON;
  const {
    portals: PortalsIcon,
    log: LogIcon,
    stats: StatsIcon,
    worklog: WorklogIcon,
    admin: AdminIcon,
  } = NAV_ICONS;

  const navItems = [
    { key: "/portals", icon: <PortalsIcon />, label: "Порталы" },
    { key: "/log", icon: <LogIcon />, label: "Журнал действий" },
    { key: "/stats", icon: <StatsIcon />, label: "Статистика" },
    { key: "/worklog", icon: <WorklogIcon />, label: "Журнал разработки" },
    ...(user?.is_superuser
      ? [{ key: "/admin/users", icon: <AdminIcon />, label: "Администрирование" }]
      : []),
  ];

  const selectedKey =
    navItems.find((item) => location.pathname.startsWith(item.key))?.key ?? "/portals";

  const onLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        message.success("Вы вышли из системы");
        navigate("/login", { replace: true });
      },
      onError: () => {
        message.error("Не удалось завершить сессию");
      },
    });
  };

  return (
    <div className="app-shell">
      <FirePanels />
      <aside className="app-sider">
        <div className="app-logo">
          <span className="app-logo-icon">
            <LogoIcon />
          </span>
          <span>Лаборатория порталов</span>
        </div>
        <nav className="app-nav">
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[selectedKey]}
            items={navItems}
            onClick={({ key }) => navigate(key)}
            style={{ background: "transparent", borderInlineEnd: "none" }}
          />
        </nav>
        <div className="app-userbox">
          <div className="app-userbox-row">
            <UserOutlined style={{ fontSize: 20, color: "#ff6a00" }} />
            <div>
              <div className="app-user-name">{user?.username ?? "—"}</div>
              <div className="app-user-role">
                {user?.is_superuser ? "Суперпользователь" : "Оператор"}
              </div>
            </div>
          </div>
          <Button
            block
            icon={<LogoutOutlined />}
            loading={logout.isPending}
            onClick={onLogout}
            style={{ marginTop: 12 }}
          >
            Выйти
          </Button>
        </div>
      </aside>

      <div className="app-main">
        <div className="app-topline" />
        <header className="app-header">
          <div>
            <div className="app-title">{meta.title}</div>
            <div className="app-subtitle">{meta.subtitle}</div>
          </div>
          <div className="app-header-right">
            <LiveBadge />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["portals"] });
              }}
            >
              Обновить
            </Button>
          </div>
        </header>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
        <footer className="app-footer">
          Лаборатория порталов · единственный источник данных — бэкенд
        </footer>
      </div>
    </div>
  );
}
