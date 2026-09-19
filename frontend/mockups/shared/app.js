/* Shared mock dashboard renderer.
   Loaded in every theme page (frontend/mockups/themes/*.html) as
   <script src="../shared/app.compiled.js"></script> — a plain-JS build of this
   file (JSX compiled by `node build.js`), so pages work when opened straight
   from the filesystem (file://) where Babel's XHR script loading is blocked.

   It renders a full fake dashboard (portals table, portal detail modal with
   actions, action log, stats) using real AntD components from CDN, themed
   through window.THEME (defined per theme page) + the CSS variables from each
   theme's <style> block.

   This is mockup-only code: it will NOT be reused in the real scaffolded app. */

const { useState, useMemo } = React;
const A = window.antd;
const {
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Divider,
  Input,
  Layout,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message
} = A;
const antdTheme = A.theme;
const I = window.icons || {};
const THEME = window.THEME;

/* ---- Constants mirroring backend app/models.py / schemas.py ---- */

const DANGER = {
  LOW: { label: "Низкий", color: "green", hex: "#52c41a" },
  MEDIUM: { label: "Средний", color: "gold", hex: "#faad14" },
  HIGH: { label: "Высокий", color: "volcano", hex: "#fa541c" },
  CRITICAL: { label: "Критический", color: "magenta", hex: "#eb2f96" }
};

const ACTION_LABEL = {
  CLOSE: "Закрыть",
  STABILIZE: "Стабилизировать",
  DISMISS: "Оставить открытым",
  SEND_OBSERVER: "Отправить наблюдателя",
  RECALL_OBSERVER: "Отозвать наблюдателя",
  MARK: "Отметить",
  UNMARK: "Снять отметку",
  WARN_CREATURES: "Предупредить существ"
};

const ACTION_COLOR = {
  CLOSE: "red",
  STABILIZE: "blue",
  DISMISS: "default",
  SEND_OBSERVER: "cyan",
  RECALL_OBSERVER: "purple",
  MARK: "orange",
  UNMARK: "gold",
  WARN_CREATURES: "volcano"
};

// Order in which actions are offered in the portal detail drawer.
const ACTIONS = ["DISMISS", "STABILIZE", "SEND_OBSERVER", "RECALL_OBSERVER", "CLOSE", "MARK", "WARN_CREATURES"];

const NAV = [
  { key: "portals", label: "Порталы", icon: "DashboardOutlined" },
  { key: "log", label: "Журнал действий", icon: "UnorderedListOutlined" },
  { key: "stats", label: "Статистика", icon: "BarChartOutlined" },
  { key: "admin", label: "Администрирование", icon: "SettingOutlined", disabled: true }
];

const PAGE_TITLES = {
  portals: { title: "Порталы", subtitle: "Живая таблица лаборатории — обновляется по WebSocket" },
  log: { title: "Журнал действий", subtitle: "Все действия операторов — поток по WebSocket" },
  stats: { title: "Статистика", subtitle: "Сводка по порталам лаборатории" },
  admin: { title: "Администрирование", subtitle: "Только для суперпользователя" }
};

/* ---- Helpers (mirror the backend risk formula and action semantics) ---- */

function calcRisk(p) {
  const ttl = Math.max(p.ttlSeconds || 0, 0);
  return (
    (p.energy / 100) * 0.2 +
    (1 - p.stability / 100) * 0.2 +
    (0.1 * p.creatures / (0.1 * p.creatures + 1)) * 0.3 +
    (1 - 0.04 * ttl / (0.04 * ttl + 1)) * 0.3
  );
}

function calcDanger(r) {
  if (r <= 0.3) return "LOW";
  if (r <= 0.6) return "MEDIUM";
  if (r <= 0.9) return "HIGH";
  return "CRITICAL";
}

function enrich(p) {
  const risk = calcRisk(p);
  return Object.assign({}, p, { risk, danger: calcDanger(risk), closed: p.closed === true || p.ttlSeconds <= 0 });
}

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

function relTime(min) {
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин назад` : `${h} ч назад`;
}

function ttlText(sec) {
  if (sec <= 0) return "истёк";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `через ${m} мин`;
  return m ? `через ${h} ч ${m} мин` : `через ${h} ч`;
}

function stabColor(v) {
  if (v < 50) return "#fa541c";
  if (v < 80) return "#faad14";
  return "#52c41a";
}

/* Availability of an action for a portal — mirrors Portal model methods. */
function actionState(p, action) {
  if (p.closed && action !== "MARK" && action !== "UNMARK") {
    return { disabled: true, reason: "Портал закрыт, выполнить действие невозможно" };
  }
  switch (action) {
    case "DISMISS":
      return {};
    case "STABILIZE":
      return p.stability >= 50 ? { disabled: true, reason: "Стабильность портала уже не ниже 50%" } : {};
    case "CLOSE":
      return p.creatures > 0
        ? { disabled: true, reason: "Нельзя закрыть портал: внутри есть существа" }
        : p.observer
          ? { disabled: true, reason: "Нельзя закрыть портал: внутри находится наблюдатель" }
          : {};
    case "SEND_OBSERVER":
      return p.danger === "CRITICAL"
        ? { disabled: true, reason: "Нельзя отправить наблюдателя: критический уровень опасности" }
        : p.observer
          ? { disabled: true, reason: "Наблюдатель уже находится внутри портала" }
          : {};
    case "RECALL_OBSERVER":
      return p.observer ? {} : { disabled: true, reason: "Внутри портала нет наблюдателя, некого отзывать" };
    case "MARK":
      return p.marked ? { disabled: true, reason: "Портал уже отмечен" } : {};
    case "UNMARK":
      return p.marked ? {} : { disabled: true, reason: "Портал не отмечен" };
    case "WARN_CREATURES":
      return !p.observer
        ? { disabled: true, reason: "Нет наблюдателя, через которого можно предупредить существ" }
        : p.creatures === 0
          ? { disabled: true, reason: "Внутри портала нет существ, некого предупреждать" }
          : {};
  }
  return {};
}

function Icon({ name, className, style }) {
  const C = I[name];
  if (!C) return null;
  return React.createElement(C, { className, style });
}

/* ---- Small shared bits ---- */

function DangerTag({ level }) {
  const d = DANGER[level];
  return <Tag color={d.color}>{d.label}</Tag>;
}

function StatCards({ stats }) {
  // Semantic icon colors mirror the tag colors used elsewhere in the dashboard
  // (green/gold/cyan/red); "total" uses the theme accent, "avg risk" follows
  // the live danger level of the average.
  const avgDanger = DANGER[calcDanger(stats.avg)].hex;
  const items = [
    { title: "Всего порталов", value: stats.total, icon: "DashboardOutlined", iconColor: THEME.colorPrimary },
    { title: "Открыто", value: stats.open, icon: "UnlockOutlined", iconColor: "#52c41a" },
    { title: "Закрыто", value: stats.closed, icon: "LockOutlined", iconColor: "#8c8c8c" },
    { title: "Отмечено", value: stats.marked, icon: "FlagOutlined", iconColor: "#fa8c16" },
    { title: "С наблюдателем", value: stats.withObserver, icon: "EyeOutlined", iconColor: "#13c2c2" },
    { title: "Средний риск", value: stats.avg.toFixed(2), icon: "LineChartOutlined", iconColor: avgDanger, accent: true }
  ];
  return (
    <Row gutter={[16, 16]}>
      {items.map((it) => (
        <Col key={it.title} xs={24} sm={12} lg={8} xl={4}>
          <Card size="small">
            <Statistic
              title={it.title}
              value={it.value}
              valueStyle={it.accent ? { color: avgDanger } : undefined}
              prefix={<Icon name={it.icon} style={{ fontSize: 16, marginRight: 4, color: it.iconColor }} />}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

/* ---- Pages ---- */

function PortalsPage({ portals, onOpen }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return portals;
    return portals.filter((p) => (p.code + " " + p.name + " " + p.world).toLowerCase().includes(needle));
  }, [portals, q]);

  const columns = [
    {
      title: "Портал",
      key: "name",
      width: 210,
      fixed: "left",
      render: (_, p) => (
        <div>
          <Typography.Text strong>
            {p.code} · {p.name}
          </Typography.Text>
          {p.marked && (
            <div style={{ marginTop: 2 }}>
              <Tag color="orange" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                <Icon name="FlagOutlined" style={{ marginRight: 4 }} />
                отмечен
              </Tag>
            </div>
          )}
        </div>
      )
    },
    { title: "Мир назначения", dataIndex: "world", width: 200, ellipsis: true },
    {
      title: "Энергия",
      key: "energy",
      width: 130,
      render: (_, p) => <Progress percent={p.energy} size="small" format={(v) => v} />,
      sorter: (a, b) => a.energy - b.energy
    },
    {
      title: "Стабильность",
      key: "stability",
      width: 130,
      render: (_, p) => (
        <Progress percent={p.stability} size="small" strokeColor={stabColor(p.stability)} format={(v) => v} />
      ),
      sorter: (a, b) => a.stability - b.stability
    },
    {
      title: "Существа",
      key: "creatures",
      width: 90,
      align: "center",
      render: (_, p) => (p.creatures > 0 ? <Tag color="geekblue">{p.creatures}</Tag> : <Typography.Text type="secondary">—</Typography.Text>)
    },
    {
      title: "Риск",
      key: "risk",
      width: 80,
      align: "center",
      render: (_, p) => (
        <Typography.Text strong style={{ color: DANGER[p.danger].hex }}>
          {p.risk.toFixed(2)}
        </Typography.Text>
      ),
      sorter: (a, b) => a.risk - b.risk
    },
    {
      title: "Опасность",
      key: "danger",
      width: 120,
      render: (_, p) => <DangerTag level={p.danger} />,
      sorter: (a, b) => Object.keys(DANGER).indexOf(a.danger) - Object.keys(DANGER).indexOf(b.danger)
    },
    {
      title: "Наблюдатель",
      key: "observer",
      width: 120,
      align: "center",
      render: (_, p) =>
        p.observer ? (
          <Tag color="cyan">
            <Icon name="EyeOutlined" style={{ marginRight: 4 }} />
            внутри
          </Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        )
    },
    {
      title: "Истекает",
      key: "ttl",
      width: 130,
      render: (_, p) => (p.closed ? <Tag color="red">закрыт</Tag> : <span>{ttlText(p.ttlSeconds)}</span>)
    },
    {
      title: "Обновлено",
      key: "updated",
      width: 130,
      render: (_, p) => <Typography.Text type="secondary">{relTime(p.updatedMin)}</Typography.Text>
    },
    {
      title: "",
      key: "actions",
      width: 90,
      fixed: "right",
      align: "center",
      render: (_, p) => (
        <Button
          type="link"
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(p);
          }}
        >
          Открыть
        </Button>
      )
    }
  ];

  return (
    <>
      <StatCards stats={statsOf(portals)} />
      <Card
        title={
          <Space>
            <Icon name="TableOutlined" />
            Активные порталы
          </Space>
        }
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="Поиск по названию или миру…"
              style={{ width: 260 }}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button icon={<Icon name="ReloadOutlined" />} onClick={() => message.info("Данные запрошены у сервера (макет)")}>
              Обновить
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          size="middle"
          scroll={{ x: 1340 }}
          pagination={{ pageSize: 8, showSizeChanger: false, showTotal: (t, r) => `${r[0]}–${r[1]} из ${t}` }}
          onRow={(p) => ({
            style: { cursor: "pointer" },
            onClick: () => onOpen(p)
          })}
        />
      </Card>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Кликните по строке, чтобы открыть карточку портала и выполнить действие. WS-обновления в реальном приложении
        целиком заменяют снапшот страницы.
      </Typography.Text>
    </>
  );
}

function statsOf(portals) {
  const total = portals.length;
  const open = portals.filter((p) => !p.closed).length;
  const closed = total - open;
  const marked = portals.filter((p) => p.marked).length;
  const withObserver = portals.filter((p) => p.observer).length;
  const avg = total ? portals.reduce((s, p) => s + p.risk, 0) / total : 0;
  const dangerLevels = {};
  Object.keys(DANGER).forEach((d) => {
    dangerLevels[d] = portals.filter((p) => p.danger === d).length;
  });
  return { total, open, closed, marked, withObserver, avg, dangerLevels };
}

function LogPage({ log }) {
  const [action, setAction] = useState(undefined);
  const [q, setQ] = useState("");
  const portalsById = useMemo(() => {
    const m = {};
    window.MOCK_DATA.portals.forEach((p) => {
      m[p.id] = p;
    });
    return m;
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return log
      .filter((e) => (action ? e.action === action : true))
      .filter((e) => {
        if (!needle) return true;
        const p = portalsById[e.portalId] || {};
        return (p.code + " " + (p.name || "")).toLowerCase().includes(needle);
      })
      .slice()
      .sort((a, b) => b.id - a.id);
  }, [log, action, q, portalsById]);

  const columns = [
    {
      title: "Время",
      key: "time",
      width: 160,
      render: (_, e) => <Typography.Text>{relTime(e.minutesAgo)}</Typography.Text>
    },
    {
      title: "Портал",
      key: "portal",
      width: 220,
      render: (_, e) => {
        const p = portalsById[e.portalId] || {};
        return (
          <Typography.Text strong>
            {p.code} · {p.name}
          </Typography.Text>
        );
      }
    },
    {
      title: "Действие",
      key: "action",
      width: 210,
      render: (_, e) => <Tag color={ACTION_COLOR[e.action]}>{ACTION_LABEL[e.action]}</Tag>
    },
    {
      title: "Пользователь",
      key: "user",
      width: 200,
      render: (_, e) => (
        <Space size={8}>
          <Icon name="UserOutlined" style={{ color: "var(--nav-fg-muted, #8a94a6)" }} />
          {e.user}
        </Space>
      )
    },
    { title: "Запись", dataIndex: "id", width: 90, align: "center", render: (v) => <Typography.Text type="secondary">#{v}</Typography.Text> }
  ];

  return (
    <Card
      title={
        <Space>
          <Icon name="UnorderedListOutlined" />
          Последние действия
        </Space>
      }
      extra={
        <Space>
          <Select
            allowClear
            placeholder="Все действия"
            style={{ width: 220 }}
            options={Object.keys(ACTION_LABEL).map((a) => ({ value: a, label: ACTION_LABEL[a] }))}
            value={action}
            onChange={setAction}
          />
          <Input.Search allowClear placeholder="Портал…" style={{ width: 220 }} onChange={(e) => setQ(e.target.value)} />
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={rows}
        size="middle"
        pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t, r) => `${r[0]}–${r[1]} из ${t}` }}
      />
    </Card>
  );
}

function StatsPage({ stats }) {
  const total = stats.total || 1;
  return (
    <>
      <StatCards stats={stats} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Распределение по уровню опасности">
            {Object.keys(DANGER).map((d) => {
              const count = stats.dangerLevels[d];
              const pct = Math.round((count / total) * 100);
              return (
                <div key={d} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <DangerTag level={d} />
                    <Typography.Text type="secondary">
                      {count} шт · {pct}%
                    </Typography.Text>
                  </div>
                  <Progress percent={pct} size="small" strokeColor={DANGER[d].hex} showInfo={false} />
                </div>
              );
            })}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Средний риск по лаборатории">
            <div style={{ marginBottom: 18 }}>
              <Progress
                type="circle"
                size={150}
                percent={Math.round(stats.avg * 100)}
                strokeColor={DANGER[calcDanger(stats.avg)].hex}
                format={(v) => (
                  <span style={{ fontSize: 22, fontWeight: 700 }}>{(v / 100).toFixed(2)}</span>
                )}
              />
            </div>
            <Typography.Text type="secondary">
              Риск считается на сервере по формуле: энергия, стабильность, существа и оставшееся время жизни портала.
            </Typography.Text>
          </Card>
        </Col>
      </Row>
    </>
  );
}

/* ---- Portal detail modal ---- */

function PortalModal({ portal, onClose, onAction }) {
  if (!portal) return null;
  const p = portal;
  return (
    <Modal
      width={720}
      open={!!p}
      onCancel={onClose}
      centered
      footer={null}
      title={
        <Space size={10}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {p.code} · {p.name}
          </Typography.Text>
          <DangerTag level={p.danger} />
          {p.closed && <Tag color="red">закрыт</Tag>}
        </Space>
      }
    >
      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="Мир назначения" span={2}>
          {p.world}
        </Descriptions.Item>
        <Descriptions.Item label="Энергия">
          <span className="mock-inline-progress">
            <Progress percent={p.energy} size="small" format={(v) => v} />
          </span>
        </Descriptions.Item>
        <Descriptions.Item label="Стабильность">
          <span className="mock-inline-progress">
            <Progress percent={p.stability} size="small" strokeColor={stabColor(p.stability)} format={(v) => v} />
          </span>
        </Descriptions.Item>
        <Descriptions.Item label="Риск">
          <Typography.Text strong style={{ color: DANGER[p.danger].hex }}>
            {p.risk.toFixed(2)}
          </Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Уровень опасности">
          <DangerTag level={p.danger} />
        </Descriptions.Item>
        <Descriptions.Item label="Существа">{p.creatures > 0 ? `${p.creatures} шт` : "нет"}</Descriptions.Item>
        <Descriptions.Item label="Отметка">{p.marked ? <Tag color="orange">отмечен</Tag> : "нет"}</Descriptions.Item>
        <Descriptions.Item label="Наблюдатель">
          {p.observer ? (
            <Tag color="cyan">
              <Icon name="EyeOutlined" style={{ marginRight: 4 }} />
              внутри
            </Tag>
          ) : (
            "нет"
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Истекает">{p.closed ? "портал закрыт" : ttlText(p.ttlSeconds)}</Descriptions.Item>
        <Descriptions.Item label="Обновлено">{relTime(p.updatedMin)}</Descriptions.Item>
      </Descriptions>

      <Divider orientation="left" plain style={{ margin: "20px 0 12px" }}>
        Доступные действия
      </Divider>
      <Row gutter={[12, 12]}>
        {ACTIONS.map((a) => {
          const real = a === "MARK" ? (p.marked ? "UNMARK" : "MARK") : a;
          const { disabled, reason } = actionState(p, real);
          const label = ACTION_LABEL[real];
          const danger = real === "CLOSE";
          const primary = real === "STABILIZE";
          return (
            <Col span={8} key={a}>
              <Tooltip title={disabled ? reason : undefined}>
                <Button
                  block
                  disabled={disabled}
                  danger={danger}
                  type={danger || primary ? "primary" : "default"}
                  icon={<Icon name={actionIcon(real)} />}
                  onClick={() => onAction(p.id, real)}
                >
                  {label}
                </Button>
              </Tooltip>
            </Col>
          );
        })}
      </Row>
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 14, fontSize: 12 }}>
        Макет имитирует результат действия локально. В приложении действие выполнит бэкенд (POST /portals/{"{id}"}), а
        состояние последует из WS-снапшота.
      </Typography.Text>
    </Modal>
  );
}

function actionIcon(a) {
  switch (a) {
    case "CLOSE":
      return "StopOutlined";
    case "STABILIZE":
      return "SlidersOutlined";
    case "DISMISS":
      return "FieldTimeOutlined";
    case "SEND_OBSERVER":
      return "SendOutlined";
    case "RECALL_OBSERVER":
      return "RollbackOutlined";
    case "MARK":
      return "FlagFilled";
    case "UNMARK":
      return "FlagOutlined";
    case "WARN_CREATURES":
      return "WarningOutlined";
    default:
      return "QuestionOutlined";
  }
}

/* ---- App shell ---- */

function App() {
  // Optional deep links for evaluation: ?page=log|stats|admin, ?portal=<id>
  // (opens the portal detail drawer). Example: themes/embers.html?page=log&portal=1
  const fromQuery = (() => {
    const q = new URLSearchParams(window.location.search);
    const out = { page: "portals", portal: null };
    const p = q.get("page");
    if (p && PAGE_TITLES[p]) out.page = p;
    const id = Number(q.get("portal"));
    if (Number.isInteger(id) && id > 0) out.portal = id;
    return out;
  })();
  const [page, setPage] = useState(fromQuery.page);
  const [portals, setPortals] = useState(() => window.MOCK_DATA.portals.map(enrich));
  const [log, setLog] = useState(() => window.MOCK_DATA.log.map((e) => Object.assign({}, e)));
  const [selected, setSelected] = useState(fromQuery.portal);
  const user = window.MOCK_DATA.user;
  const T = THEME;

  const stats = useMemo(() => statsOf(portals), [portals]);

  const runAction = (portalId, action) => {
    const label = ACTION_LABEL[action];
    setPortals((prev) =>
      prev.map((p) => {
        if (p.id !== portalId) return p;
        const next = Object.assign({}, p);
        if (action === "DISMISS") next.updatedMin = 0;
        if (action === "STABILIZE") next.stability = Math.min(p.stability + randInt(10, 30), 100);
        if (action === "CLOSE") next.closed = true;
        if (action === "SEND_OBSERVER") next.observer = true;
        if (action === "RECALL_OBSERVER") next.observer = false;
        if (action === "MARK") next.marked = true;
        if (action === "UNMARK") next.marked = false;
        if (action === "WARN_CREATURES") next.creatures = 0;
        return enrich(next);
      })
    );
    setLog((prev) => [{ id: prev.length ? prev[0].id + 1 : 1, portalId, action, user: user.username, minutesAgo: 0 }].concat(prev));
    message.success(`Действие «${label}» выполнено (макет)`);
  };

  const selectedPortal = selected ? portals.find((p) => p.id === selected) ?? null : null;

  const navItems = (
    <>
      {NAV.map((it) => {
        const active = page === it.key;
        const cls = ["mock-nav-item", active ? "mock-nav-item--active" : "", it.disabled ? "mock-nav-item--disabled" : ""].join(" ").trim();
        return (
          <div
            key={it.key}
            role="menuitem"
            className={cls}
            onClick={it.disabled ? undefined : () => setPage(it.key)}
            title={it.disabled ? "Раздел появится в реальном приложении" : undefined}
          >
            <span className="mock-nav-icon">
              <Icon name={it.icon} />
            </span>
            <span>{it.label}</span>
            {it.badge && <span className="mock-nav-badge">{it.badge}</span>}
          </div>
        );
      })}
    </>
  );

  const headerRight = (
    <div className="mock-header-right">
      <span className="mock-live">
        <span className="mock-live-dot" />
        Live
      </span>
      <Button icon={<Icon name="ReloadOutlined" />} onClick={() => message.info("Снапшот запрошен у сервера (макет)")}>
        Обновить
      </Button>
      <Space size={8}>
        <Icon name="UserOutlined" style={{ fontSize: 18, color: T.colorPrimary }} />
        <div>
          <div style={{ lineHeight: 1.2, fontWeight: 600, fontSize: 14 }}>{user.username}</div>
          <div style={{ fontSize: 12, color: "var(--header-fg-muted, #8a94a6)" }}>{user.role}</div>
        </div>
        <Button
          type="text"
          icon={<Icon name="LogoutOutlined" />}
          onClick={() => message.info("Выход из системы (макет)")}
          title="Выйти"
        />
      </Space>
    </div>
  );

  const pageMeta = PAGE_TITLES[page] || PAGE_TITLES.portals;

  return (
    <ConfigProvider
      theme={{
        algorithm: T.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: T.colorPrimary,
          colorBgLayout: T.bgLayout,
          colorBgContainer: T.bgContainer,
          colorBgElevated: T.bgElevated || T.bgContainer,
          borderRadius: T.borderRadius || 8
        }
      }}
    >
      <Layout className="mock-app" style={{ background: T.bgLayout }}>
        {T.layout === "topnav" ? (
          <Layout style={{ background: T.bgLayout }}>
            <div className="mock-topline" />
            <div className="mock-topnav">
              <div className="mock-logo">
                <span className="mock-logo-icon">
                  <Icon name="ThunderboltOutlined" style={{ color: "#fff" }} />
                </span>
                <span>Лаборатория порталов</span>
              </div>
              <nav className="mock-nav mock-nav--horizontal">{navItems}</nav>
              <div className="mock-topnav-right">{headerRight}</div>
            </div>
            <Layout.Content className="mock-content">
              {page === "portals" && <PortalsPage portals={portals} onOpen={(p) => setSelected(p.id)} />}
              {page === "log" && <LogPage log={log} />}
              {page === "stats" && <StatsPage stats={stats} />}
              {page === "admin" && (
                <Card>
                  <Typography.Text type="secondary">
                    Раздел «Администрирование» (пользователи, пароли) появится в реальном приложении. В макете он
                    заблокирован.
                  </Typography.Text>
                </Card>
              )}
            </Layout.Content>
            <Layout.Footer className="mock-footer">
              Лаборатория порталов · макет интерфейса · данные вымышленные · единственный источник данных — бэкенд
            </Layout.Footer>
          </Layout>
        ) : (
          <>
            <div className="mock-sider">
              <div className="mock-logo">
                <span className="mock-logo-icon">
                  <Icon name="ThunderboltOutlined" style={{ color: "#fff" }} />
                </span>
                <span>Лаборатория порталов</span>
              </div>
              <nav className="mock-nav">{navItems}</nav>
              <div className="mock-userbox">
                <div className="mock-userbox-row">
                  <Icon name="UserOutlined" style={{ fontSize: 20, color: T.colorPrimary }} />
                  <div>
                    <div className="mock-user-name">{user.username}</div>
                    <div className="mock-user-role">{user.role}</div>
                  </div>
                </div>
                <Button
                  block
                  icon={<Icon name="LogoutOutlined" />}
                  onClick={() => message.info("Выход из системы (макет)")}
                >
                  Выйти
                </Button>
              </div>
            </div>
            <Layout style={{ background: T.bgLayout }}>
              <div className="mock-topline" />
              <div className="mock-header">
                <div>
                  <div className="mock-title">{pageMeta.title}</div>
                  <div className="mock-subtitle">{pageMeta.subtitle}</div>
                </div>
                {headerRight}
              </div>
              <Layout.Content className="mock-content">
                {page === "portals" && <PortalsPage portals={portals} onOpen={(p) => setSelected(p.id)} />}
                {page === "log" && <LogPage log={log} />}
                {page === "stats" && <StatsPage stats={stats} />}
                {page === "admin" && (
                  <Card>
                    <Typography.Text type="secondary">
                      Раздел «Администрирование» (пользователи, пароли) появится в реальном приложении. В макете он
                      заблокирован.
                    </Typography.Text>
                  </Card>
                )}
              </Layout.Content>
              <Layout.Footer className="mock-footer">
                Лаборатория порталов · макет интерфейса · данные вымышленные · единственный источник данных — бэкенд
              </Layout.Footer>
            </Layout>
          </>
        )}
      </Layout>
      <PortalModal portal={selectedPortal} onClose={() => setSelected(null)} onAction={runAction} />
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
