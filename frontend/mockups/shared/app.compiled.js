/* ====================================================================== */
/* GENERATED FILE — do not edit directly.                               */
/* Source: shared/app.js (JSX). Rebuild with `node build.js` in this dir. */
/* ====================================================================== */
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

const {
  useState,
  useMemo
} = React;
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
  LOW: {
    label: "Низкий",
    color: "green",
    hex: "#52c41a"
  },
  MEDIUM: {
    label: "Средний",
    color: "gold",
    hex: "#faad14"
  },
  HIGH: {
    label: "Высокий",
    color: "volcano",
    hex: "#fa541c"
  },
  CRITICAL: {
    label: "Критический",
    color: "magenta",
    hex: "#eb2f96"
  }
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
const NAV = [{
  key: "portals",
  label: "Порталы",
  icon: "DashboardOutlined"
}, {
  key: "log",
  label: "Журнал действий",
  icon: "UnorderedListOutlined"
}, {
  key: "stats",
  label: "Статистика",
  icon: "BarChartOutlined"
}, {
  key: "admin",
  label: "Администрирование",
  icon: "SettingOutlined",
  disabled: true
}];
const PAGE_TITLES = {
  portals: {
    title: "Порталы",
    subtitle: "Живая таблица лаборатории — обновляется по WebSocket"
  },
  log: {
    title: "Журнал действий",
    subtitle: "Все действия операторов — поток по WebSocket"
  },
  stats: {
    title: "Статистика",
    subtitle: "Сводка по порталам лаборатории"
  },
  admin: {
    title: "Администрирование",
    subtitle: "Только для суперпользователя"
  }
};

/* ---- Helpers (mirror the backend risk formula and action semantics) ---- */

function calcRisk(p) {
  const ttl = Math.max(p.ttlSeconds || 0, 0);
  return p.energy / 100 * 0.2 + (1 - p.stability / 100) * 0.2 + 0.1 * p.creatures / (0.1 * p.creatures + 1) * 0.3 + (1 - 0.04 * ttl / (0.04 * ttl + 1)) * 0.3;
}
function calcDanger(r) {
  if (r <= 0.3) return "LOW";
  if (r <= 0.6) return "MEDIUM";
  if (r <= 0.9) return "HIGH";
  return "CRITICAL";
}
function enrich(p) {
  const risk = calcRisk(p);
  return Object.assign({}, p, {
    risk,
    danger: calcDanger(risk),
    closed: p.closed === true || p.ttlSeconds <= 0
  });
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
  const m = Math.round(sec % 3600 / 60);
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
    return {
      disabled: true,
      reason: "Портал закрыт, выполнить действие невозможно"
    };
  }
  switch (action) {
    case "DISMISS":
      return {};
    case "STABILIZE":
      return p.stability >= 50 ? {
        disabled: true,
        reason: "Стабильность портала уже не ниже 50%"
      } : {};
    case "CLOSE":
      return p.creatures > 0 ? {
        disabled: true,
        reason: "Нельзя закрыть портал: внутри есть существа"
      } : p.observer ? {
        disabled: true,
        reason: "Нельзя закрыть портал: внутри находится наблюдатель"
      } : {};
    case "SEND_OBSERVER":
      return p.danger === "CRITICAL" ? {
        disabled: true,
        reason: "Нельзя отправить наблюдателя: критический уровень опасности"
      } : p.observer ? {
        disabled: true,
        reason: "Наблюдатель уже находится внутри портала"
      } : {};
    case "RECALL_OBSERVER":
      return p.observer ? {} : {
        disabled: true,
        reason: "Внутри портала нет наблюдателя, некого отзывать"
      };
    case "MARK":
      return p.marked ? {
        disabled: true,
        reason: "Портал уже отмечен"
      } : {};
    case "UNMARK":
      return p.marked ? {} : {
        disabled: true,
        reason: "Портал не отмечен"
      };
    case "WARN_CREATURES":
      return !p.observer ? {
        disabled: true,
        reason: "Нет наблюдателя, через которого можно предупредить существ"
      } : p.creatures === 0 ? {
        disabled: true,
        reason: "Внутри портала нет существ, некого предупреждать"
      } : {};
  }
  return {};
}
function Icon({
  name,
  className,
  style
}) {
  const C = I[name];
  if (!C) return null;
  return React.createElement(C, {
    className,
    style
  });
}

/* ---- Small shared bits ---- */

function DangerTag({
  level
}) {
  const d = DANGER[level];
  return /*#__PURE__*/React.createElement(Tag, {
    color: d.color
  }, d.label);
}
function StatCards({
  stats
}) {
  // Semantic icon colors mirror the tag colors used elsewhere in the dashboard
  // (green/gold/cyan/red); "total" uses the theme accent, "avg risk" follows
  // the live danger level of the average.
  const avgDanger = DANGER[calcDanger(stats.avg)].hex;
  const items = [{
    title: "Всего порталов",
    value: stats.total,
    icon: "DashboardOutlined",
    iconColor: THEME.colorPrimary
  }, {
    title: "Открыто",
    value: stats.open,
    icon: "UnlockOutlined",
    iconColor: "#52c41a"
  }, {
    title: "Закрыто",
    value: stats.closed,
    icon: "LockOutlined",
    iconColor: "#8c8c8c"
  }, {
    title: "Отмечено",
    value: stats.marked,
    icon: "FlagOutlined",
    iconColor: "#fa8c16"
  }, {
    title: "С наблюдателем",
    value: stats.withObserver,
    icon: "EyeOutlined",
    iconColor: "#13c2c2"
  }, {
    title: "Средний риск",
    value: stats.avg.toFixed(2),
    icon: "LineChartOutlined",
    iconColor: avgDanger,
    accent: true
  }];
  return /*#__PURE__*/React.createElement(Row, {
    gutter: [16, 16]
  }, items.map(it => /*#__PURE__*/React.createElement(Col, {
    key: it.title,
    xs: 24,
    sm: 12,
    lg: 8,
    xl: 4
  }, /*#__PURE__*/React.createElement(Card, {
    size: "small"
  }, /*#__PURE__*/React.createElement(Statistic, {
    title: it.title,
    value: it.value,
    valueStyle: it.accent ? {
      color: avgDanger
    } : undefined,
    prefix: /*#__PURE__*/React.createElement(Icon, {
      name: it.icon,
      style: {
        fontSize: 16,
        marginRight: 4,
        color: it.iconColor
      }
    })
  })))));
}

/* ---- Pages ---- */

function PortalsPage({
  portals,
  onOpen
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return portals;
    return portals.filter(p => (p.code + " " + p.name + " " + p.world).toLowerCase().includes(needle));
  }, [portals, q]);
  const columns = [{
    title: "Портал",
    key: "name",
    width: 210,
    fixed: "left",
    render: (_, p) => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Typography.Text, {
      strong: true
    }, p.code, " \xB7 ", p.name), p.marked && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 2
      }
    }, /*#__PURE__*/React.createElement(Tag, {
      color: "orange",
      style: {
        marginInlineEnd: 0,
        fontSize: 11
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "FlagOutlined",
      style: {
        marginRight: 4
      }
    }), "\u043E\u0442\u043C\u0435\u0447\u0435\u043D")))
  }, {
    title: "Мир назначения",
    dataIndex: "world",
    width: 200,
    ellipsis: true
  }, {
    title: "Энергия",
    key: "energy",
    width: 130,
    render: (_, p) => /*#__PURE__*/React.createElement(Progress, {
      percent: p.energy,
      size: "small",
      format: v => v
    }),
    sorter: (a, b) => a.energy - b.energy
  }, {
    title: "Стабильность",
    key: "stability",
    width: 130,
    render: (_, p) => /*#__PURE__*/React.createElement(Progress, {
      percent: p.stability,
      size: "small",
      strokeColor: stabColor(p.stability),
      format: v => v
    }),
    sorter: (a, b) => a.stability - b.stability
  }, {
    title: "Существа",
    key: "creatures",
    width: 90,
    align: "center",
    render: (_, p) => p.creatures > 0 ? /*#__PURE__*/React.createElement(Tag, {
      color: "geekblue"
    }, p.creatures) : /*#__PURE__*/React.createElement(Typography.Text, {
      type: "secondary"
    }, "\u2014")
  }, {
    title: "Риск",
    key: "risk",
    width: 80,
    align: "center",
    render: (_, p) => /*#__PURE__*/React.createElement(Typography.Text, {
      strong: true,
      style: {
        color: DANGER[p.danger].hex
      }
    }, p.risk.toFixed(2)),
    sorter: (a, b) => a.risk - b.risk
  }, {
    title: "Опасность",
    key: "danger",
    width: 120,
    render: (_, p) => /*#__PURE__*/React.createElement(DangerTag, {
      level: p.danger
    }),
    sorter: (a, b) => Object.keys(DANGER).indexOf(a.danger) - Object.keys(DANGER).indexOf(b.danger)
  }, {
    title: "Наблюдатель",
    key: "observer",
    width: 120,
    align: "center",
    render: (_, p) => p.observer ? /*#__PURE__*/React.createElement(Tag, {
      color: "cyan"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "EyeOutlined",
      style: {
        marginRight: 4
      }
    }), "\u0432\u043D\u0443\u0442\u0440\u0438") : /*#__PURE__*/React.createElement(Typography.Text, {
      type: "secondary"
    }, "\u2014")
  }, {
    title: "Истекает",
    key: "ttl",
    width: 130,
    render: (_, p) => p.closed ? /*#__PURE__*/React.createElement(Tag, {
      color: "red"
    }, "\u0437\u0430\u043A\u0440\u044B\u0442") : /*#__PURE__*/React.createElement("span", null, ttlText(p.ttlSeconds))
  }, {
    title: "Обновлено",
    key: "updated",
    width: 130,
    render: (_, p) => /*#__PURE__*/React.createElement(Typography.Text, {
      type: "secondary"
    }, relTime(p.updatedMin))
  }, {
    title: "",
    key: "actions",
    width: 90,
    fixed: "right",
    align: "center",
    render: (_, p) => /*#__PURE__*/React.createElement(Button, {
      type: "link",
      size: "small",
      onClick: e => {
        e.stopPropagation();
        onOpen(p);
      }
    }, "\u041E\u0442\u043A\u0440\u044B\u0442\u044C")
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(StatCards, {
    stats: statsOf(portals)
  }), /*#__PURE__*/React.createElement(Card, {
    title: /*#__PURE__*/React.createElement(Space, null, /*#__PURE__*/React.createElement(Icon, {
      name: "TableOutlined"
    }), "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u043F\u043E\u0440\u0442\u0430\u043B\u044B"),
    extra: /*#__PURE__*/React.createElement(Space, null, /*#__PURE__*/React.createElement(Input.Search, {
      allowClear: true,
      placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E \u0438\u043B\u0438 \u043C\u0438\u0440\u0443\u2026",
      style: {
        width: 260
      },
      onChange: e => setQ(e.target.value)
    }), /*#__PURE__*/React.createElement(Button, {
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "ReloadOutlined"
      }),
      onClick: () => message.info("Данные запрошены у сервера (макет)")
    }, "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"))
  }, /*#__PURE__*/React.createElement(Table, {
    rowKey: "id",
    columns: columns,
    dataSource: filtered,
    size: "middle",
    scroll: {
      x: 1340
    },
    pagination: {
      pageSize: 8,
      showSizeChanger: false,
      showTotal: (t, r) => `${r[0]}–${r[1]} из ${t}`
    },
    onRow: p => ({
      style: {
        cursor: "pointer"
      },
      onClick: () => onOpen(p)
    })
  })), /*#__PURE__*/React.createElement(Typography.Text, {
    type: "secondary",
    style: {
      fontSize: 12
    }
  }, "\u041A\u043B\u0438\u043A\u043D\u0438\u0442\u0435 \u043F\u043E \u0441\u0442\u0440\u043E\u043A\u0435, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u043F\u043E\u0440\u0442\u0430\u043B\u0430 \u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435. WS-\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0438 \u0446\u0435\u043B\u0438\u043A\u043E\u043C \u0437\u0430\u043C\u0435\u043D\u044F\u044E\u0442 \u0441\u043D\u0430\u043F\u0448\u043E\u0442 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B."));
}
function statsOf(portals) {
  const total = portals.length;
  const open = portals.filter(p => !p.closed).length;
  const closed = total - open;
  const marked = portals.filter(p => p.marked).length;
  const withObserver = portals.filter(p => p.observer).length;
  const avg = total ? portals.reduce((s, p) => s + p.risk, 0) / total : 0;
  const dangerLevels = {};
  Object.keys(DANGER).forEach(d => {
    dangerLevels[d] = portals.filter(p => p.danger === d).length;
  });
  return {
    total,
    open,
    closed,
    marked,
    withObserver,
    avg,
    dangerLevels
  };
}
function LogPage({
  log
}) {
  const [action, setAction] = useState(undefined);
  const [q, setQ] = useState("");
  const portalsById = useMemo(() => {
    const m = {};
    window.MOCK_DATA.portals.forEach(p => {
      m[p.id] = p;
    });
    return m;
  }, []);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return log.filter(e => action ? e.action === action : true).filter(e => {
      if (!needle) return true;
      const p = portalsById[e.portalId] || {};
      return (p.code + " " + (p.name || "")).toLowerCase().includes(needle);
    }).slice().sort((a, b) => b.id - a.id);
  }, [log, action, q, portalsById]);
  const columns = [{
    title: "Время",
    key: "time",
    width: 160,
    render: (_, e) => /*#__PURE__*/React.createElement(Typography.Text, null, relTime(e.minutesAgo))
  }, {
    title: "Портал",
    key: "portal",
    width: 220,
    render: (_, e) => {
      const p = portalsById[e.portalId] || {};
      return /*#__PURE__*/React.createElement(Typography.Text, {
        strong: true
      }, p.code, " \xB7 ", p.name);
    }
  }, {
    title: "Действие",
    key: "action",
    width: 210,
    render: (_, e) => /*#__PURE__*/React.createElement(Tag, {
      color: ACTION_COLOR[e.action]
    }, ACTION_LABEL[e.action])
  }, {
    title: "Пользователь",
    key: "user",
    width: 200,
    render: (_, e) => /*#__PURE__*/React.createElement(Space, {
      size: 8
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "UserOutlined",
      style: {
        color: "var(--nav-fg-muted, #8a94a6)"
      }
    }), e.user)
  }, {
    title: "Запись",
    dataIndex: "id",
    width: 90,
    align: "center",
    render: v => /*#__PURE__*/React.createElement(Typography.Text, {
      type: "secondary"
    }, "#", v)
  }];
  return /*#__PURE__*/React.createElement(Card, {
    title: /*#__PURE__*/React.createElement(Space, null, /*#__PURE__*/React.createElement(Icon, {
      name: "UnorderedListOutlined"
    }), "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F"),
    extra: /*#__PURE__*/React.createElement(Space, null, /*#__PURE__*/React.createElement(Select, {
      allowClear: true,
      placeholder: "\u0412\u0441\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F",
      style: {
        width: 220
      },
      options: Object.keys(ACTION_LABEL).map(a => ({
        value: a,
        label: ACTION_LABEL[a]
      })),
      value: action,
      onChange: setAction
    }), /*#__PURE__*/React.createElement(Input.Search, {
      allowClear: true,
      placeholder: "\u041F\u043E\u0440\u0442\u0430\u043B\u2026",
      style: {
        width: 220
      },
      onChange: e => setQ(e.target.value)
    }))
  }, /*#__PURE__*/React.createElement(Table, {
    rowKey: "id",
    columns: columns,
    dataSource: rows,
    size: "middle",
    pagination: {
      pageSize: 10,
      showSizeChanger: false,
      showTotal: (t, r) => `${r[0]}–${r[1]} из ${t}`
    }
  }));
}
function StatsPage({
  stats
}) {
  const total = stats.total || 1;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(StatCards, {
    stats: stats
  }), /*#__PURE__*/React.createElement(Row, {
    gutter: [16, 16]
  }, /*#__PURE__*/React.createElement(Col, {
    xs: 24,
    lg: 14
  }, /*#__PURE__*/React.createElement(Card, {
    title: "\u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435 \u043F\u043E \u0443\u0440\u043E\u0432\u043D\u044E \u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438"
  }, Object.keys(DANGER).map(d => {
    const count = stats.dangerLevels[d];
    const pct = Math.round(count / total * 100);
    return /*#__PURE__*/React.createElement("div", {
      key: d,
      style: {
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement(DangerTag, {
      level: d
    }), /*#__PURE__*/React.createElement(Typography.Text, {
      type: "secondary"
    }, count, " \u0448\u0442 \xB7 ", pct, "%")), /*#__PURE__*/React.createElement(Progress, {
      percent: pct,
      size: "small",
      strokeColor: DANGER[d].hex,
      showInfo: false
    }));
  }))), /*#__PURE__*/React.createElement(Col, {
    xs: 24,
    lg: 10
  }, /*#__PURE__*/React.createElement(Card, {
    title: "\u0421\u0440\u0435\u0434\u043D\u0438\u0439 \u0440\u0438\u0441\u043A \u043F\u043E \u043B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u0438"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Progress, {
    type: "circle",
    size: 150,
    percent: Math.round(stats.avg * 100),
    strokeColor: DANGER[calcDanger(stats.avg)].hex,
    format: v => /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 22,
        fontWeight: 700
      }
    }, (v / 100).toFixed(2))
  })), /*#__PURE__*/React.createElement(Typography.Text, {
    type: "secondary"
  }, "\u0420\u0438\u0441\u043A \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435 \u043F\u043E \u0444\u043E\u0440\u043C\u0443\u043B\u0435: \u044D\u043D\u0435\u0440\u0433\u0438\u044F, \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u043E\u0441\u0442\u044C, \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0430 \u0438 \u043E\u0441\u0442\u0430\u0432\u0448\u0435\u0435\u0441\u044F \u0432\u0440\u0435\u043C\u044F \u0436\u0438\u0437\u043D\u0438 \u043F\u043E\u0440\u0442\u0430\u043B\u0430.")))));
}

/* ---- Portal detail modal ---- */

function PortalModal({
  portal,
  onClose,
  onAction
}) {
  if (!portal) return null;
  const p = portal;
  return /*#__PURE__*/React.createElement(Modal, {
    width: 720,
    open: !!p,
    onCancel: onClose,
    centered: true,
    footer: null,
    title: /*#__PURE__*/React.createElement(Space, {
      size: 10
    }, /*#__PURE__*/React.createElement(Typography.Text, {
      strong: true,
      style: {
        fontSize: 16
      }
    }, p.code, " \xB7 ", p.name), /*#__PURE__*/React.createElement(DangerTag, {
      level: p.danger
    }), p.closed && /*#__PURE__*/React.createElement(Tag, {
      color: "red"
    }, "\u0437\u0430\u043A\u0440\u044B\u0442"))
  }, /*#__PURE__*/React.createElement(Descriptions, {
    column: 2,
    size: "small",
    bordered: true
  }, /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u041C\u0438\u0440 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F",
    span: 2
  }, p.world), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u042D\u043D\u0435\u0440\u0433\u0438\u044F"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mock-inline-progress"
  }, /*#__PURE__*/React.createElement(Progress, {
    percent: p.energy,
    size: "small",
    format: v => v
  }))), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u0421\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u043E\u0441\u0442\u044C"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mock-inline-progress"
  }, /*#__PURE__*/React.createElement(Progress, {
    percent: p.stability,
    size: "small",
    strokeColor: stabColor(p.stability),
    format: v => v
  }))), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u0420\u0438\u0441\u043A"
  }, /*#__PURE__*/React.createElement(Typography.Text, {
    strong: true,
    style: {
      color: DANGER[p.danger].hex
    }
  }, p.risk.toFixed(2))), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u0423\u0440\u043E\u0432\u0435\u043D\u044C \u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438"
  }, /*#__PURE__*/React.createElement(DangerTag, {
    level: p.danger
  })), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u0421\u0443\u0449\u0435\u0441\u0442\u0432\u0430"
  }, p.creatures > 0 ? `${p.creatures} шт` : "нет"), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u041E\u0442\u043C\u0435\u0442\u043A\u0430"
  }, p.marked ? /*#__PURE__*/React.createElement(Tag, {
    color: "orange"
  }, "\u043E\u0442\u043C\u0435\u0447\u0435\u043D") : "нет"), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u041D\u0430\u0431\u043B\u044E\u0434\u0430\u0442\u0435\u043B\u044C"
  }, p.observer ? /*#__PURE__*/React.createElement(Tag, {
    color: "cyan"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "EyeOutlined",
    style: {
      marginRight: 4
    }
  }), "\u0432\u043D\u0443\u0442\u0440\u0438") : "нет"), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u0418\u0441\u0442\u0435\u043A\u0430\u0435\u0442"
  }, p.closed ? "портал закрыт" : ttlText(p.ttlSeconds)), /*#__PURE__*/React.createElement(Descriptions.Item, {
    label: "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E"
  }, relTime(p.updatedMin))), /*#__PURE__*/React.createElement(Divider, {
    orientation: "left",
    plain: true,
    style: {
      margin: "20px 0 12px"
    }
  }, "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F"), /*#__PURE__*/React.createElement(Row, {
    gutter: [12, 12]
  }, ACTIONS.map(a => {
    const real = a === "MARK" ? p.marked ? "UNMARK" : "MARK" : a;
    const {
      disabled,
      reason
    } = actionState(p, real);
    const label = ACTION_LABEL[real];
    const danger = real === "CLOSE";
    const primary = real === "STABILIZE";
    return /*#__PURE__*/React.createElement(Col, {
      span: 8,
      key: a
    }, /*#__PURE__*/React.createElement(Tooltip, {
      title: disabled ? reason : undefined
    }, /*#__PURE__*/React.createElement(Button, {
      block: true,
      disabled: disabled,
      danger: danger,
      type: danger || primary ? "primary" : "default",
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: actionIcon(real)
      }),
      onClick: () => onAction(p.id, real)
    }, label)));
  })), /*#__PURE__*/React.createElement(Typography.Text, {
    type: "secondary",
    style: {
      display: "block",
      marginTop: 14,
      fontSize: 12
    }
  }, "\u041C\u0430\u043A\u0435\u0442 \u0438\u043C\u0438\u0442\u0438\u0440\u0443\u0435\u0442 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E. \u0412 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442 \u0431\u044D\u043A\u0435\u043D\u0434 (POST /portals/", "{id}", "), \u0430 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043F\u043E\u0441\u043B\u0435\u0434\u0443\u0435\u0442 \u0438\u0437 WS-\u0441\u043D\u0430\u043F\u0448\u043E\u0442\u0430."));
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
    const out = {
      page: "portals",
      portal: null
    };
    const p = q.get("page");
    if (p && PAGE_TITLES[p]) out.page = p;
    const id = Number(q.get("portal"));
    if (Number.isInteger(id) && id > 0) out.portal = id;
    return out;
  })();
  const [page, setPage] = useState(fromQuery.page);
  const [portals, setPortals] = useState(() => window.MOCK_DATA.portals.map(enrich));
  const [log, setLog] = useState(() => window.MOCK_DATA.log.map(e => Object.assign({}, e)));
  const [selected, setSelected] = useState(fromQuery.portal);
  const user = window.MOCK_DATA.user;
  const T = THEME;
  const stats = useMemo(() => statsOf(portals), [portals]);
  const runAction = (portalId, action) => {
    const label = ACTION_LABEL[action];
    setPortals(prev => prev.map(p => {
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
    }));
    setLog(prev => [{
      id: prev.length ? prev[0].id + 1 : 1,
      portalId,
      action,
      user: user.username,
      minutesAgo: 0
    }].concat(prev));
    message.success(`Действие «${label}» выполнено (макет)`);
  };
  const selectedPortal = selected ? portals.find(p => p.id === selected) ?? null : null;
  const navItems = /*#__PURE__*/React.createElement(React.Fragment, null, NAV.map(it => {
    const active = page === it.key;
    const cls = ["mock-nav-item", active ? "mock-nav-item--active" : "", it.disabled ? "mock-nav-item--disabled" : ""].join(" ").trim();
    return /*#__PURE__*/React.createElement("div", {
      key: it.key,
      role: "menuitem",
      className: cls,
      onClick: it.disabled ? undefined : () => setPage(it.key),
      title: it.disabled ? "Раздел появится в реальном приложении" : undefined
    }, /*#__PURE__*/React.createElement("span", {
      className: "mock-nav-icon"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: it.icon
    })), /*#__PURE__*/React.createElement("span", null, it.label), it.badge && /*#__PURE__*/React.createElement("span", {
      className: "mock-nav-badge"
    }, it.badge));
  }));
  const headerRight = /*#__PURE__*/React.createElement("div", {
    className: "mock-header-right"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mock-live"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mock-live-dot"
  }), "Live"), /*#__PURE__*/React.createElement(Button, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "ReloadOutlined"
    }),
    onClick: () => message.info("Снапшот запрошен у сервера (макет)")
  }, "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"), /*#__PURE__*/React.createElement(Space, {
    size: 8
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "UserOutlined",
    style: {
      fontSize: 18,
      color: T.colorPrimary
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      lineHeight: 1.2,
      fontWeight: 600,
      fontSize: 14
    }
  }, user.username), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--header-fg-muted, #8a94a6)"
    }
  }, user.role)), /*#__PURE__*/React.createElement(Button, {
    type: "text",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "LogoutOutlined"
    }),
    onClick: () => message.info("Выход из системы (макет)"),
    title: "\u0412\u044B\u0439\u0442\u0438"
  })));
  const pageMeta = PAGE_TITLES[page] || PAGE_TITLES.portals;
  return /*#__PURE__*/React.createElement(ConfigProvider, {
    theme: {
      algorithm: T.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: T.colorPrimary,
        colorBgLayout: T.bgLayout,
        colorBgContainer: T.bgContainer,
        colorBgElevated: T.bgElevated || T.bgContainer,
        borderRadius: T.borderRadius || 8
      }
    }
  }, /*#__PURE__*/React.createElement(Layout, {
    className: "mock-app",
    style: {
      background: T.bgLayout
    }
  }, T.layout === "topnav" ? /*#__PURE__*/React.createElement(Layout, {
    style: {
      background: T.bgLayout
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mock-topline"
  }), /*#__PURE__*/React.createElement("div", {
    className: "mock-topnav"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mock-logo"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mock-logo-icon"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "ThunderboltOutlined",
    style: {
      color: "#fff"
    }
  })), /*#__PURE__*/React.createElement("span", null, "\u041B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u0440\u0442\u0430\u043B\u043E\u0432")), /*#__PURE__*/React.createElement("nav", {
    className: "mock-nav mock-nav--horizontal"
  }, navItems), /*#__PURE__*/React.createElement("div", {
    className: "mock-topnav-right"
  }, headerRight)), /*#__PURE__*/React.createElement(Layout.Content, {
    className: "mock-content"
  }, page === "portals" && /*#__PURE__*/React.createElement(PortalsPage, {
    portals: portals,
    onOpen: p => setSelected(p.id)
  }), page === "log" && /*#__PURE__*/React.createElement(LogPage, {
    log: log
  }), page === "stats" && /*#__PURE__*/React.createElement(StatsPage, {
    stats: stats
  }), page === "admin" && /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(Typography.Text, {
    type: "secondary"
  }, "\u0420\u0430\u0437\u0434\u0435\u043B \xAB\u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435\xBB (\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438, \u043F\u0430\u0440\u043E\u043B\u0438) \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0438. \u0412 \u043C\u0430\u043A\u0435\u0442\u0435 \u043E\u043D \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D."))), /*#__PURE__*/React.createElement(Layout.Footer, {
    className: "mock-footer"
  }, "\u041B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u0440\u0442\u0430\u043B\u043E\u0432 \xB7 \u043C\u0430\u043A\u0435\u0442 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430 \xB7 \u0434\u0430\u043D\u043D\u044B\u0435 \u0432\u044B\u043C\u044B\u0448\u043B\u0435\u043D\u043D\u044B\u0435 \xB7 \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0434\u0430\u043D\u043D\u044B\u0445 \u2014 \u0431\u044D\u043A\u0435\u043D\u0434")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "mock-sider"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mock-logo"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mock-logo-icon"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "ThunderboltOutlined",
    style: {
      color: "#fff"
    }
  })), /*#__PURE__*/React.createElement("span", null, "\u041B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u0440\u0442\u0430\u043B\u043E\u0432")), /*#__PURE__*/React.createElement("nav", {
    className: "mock-nav"
  }, navItems), /*#__PURE__*/React.createElement("div", {
    className: "mock-userbox"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mock-userbox-row"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "UserOutlined",
    style: {
      fontSize: 20,
      color: T.colorPrimary
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mock-user-name"
  }, user.username), /*#__PURE__*/React.createElement("div", {
    className: "mock-user-role"
  }, user.role))), /*#__PURE__*/React.createElement(Button, {
    block: true,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "LogoutOutlined"
    }),
    onClick: () => message.info("Выход из системы (макет)")
  }, "\u0412\u044B\u0439\u0442\u0438"))), /*#__PURE__*/React.createElement(Layout, {
    style: {
      background: T.bgLayout
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mock-topline"
  }), /*#__PURE__*/React.createElement("div", {
    className: "mock-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mock-title"
  }, pageMeta.title), /*#__PURE__*/React.createElement("div", {
    className: "mock-subtitle"
  }, pageMeta.subtitle)), headerRight), /*#__PURE__*/React.createElement(Layout.Content, {
    className: "mock-content"
  }, page === "portals" && /*#__PURE__*/React.createElement(PortalsPage, {
    portals: portals,
    onOpen: p => setSelected(p.id)
  }), page === "log" && /*#__PURE__*/React.createElement(LogPage, {
    log: log
  }), page === "stats" && /*#__PURE__*/React.createElement(StatsPage, {
    stats: stats
  }), page === "admin" && /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(Typography.Text, {
    type: "secondary"
  }, "\u0420\u0430\u0437\u0434\u0435\u043B \xAB\u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435\xBB (\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438, \u043F\u0430\u0440\u043E\u043B\u0438) \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0438. \u0412 \u043C\u0430\u043A\u0435\u0442\u0435 \u043E\u043D \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D."))), /*#__PURE__*/React.createElement(Layout.Footer, {
    className: "mock-footer"
  }, "\u041B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u0440\u0442\u0430\u043B\u043E\u0432 \xB7 \u043C\u0430\u043A\u0435\u0442 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430 \xB7 \u0434\u0430\u043D\u043D\u044B\u0435 \u0432\u044B\u043C\u044B\u0448\u043B\u0435\u043D\u043D\u044B\u0435 \xB7 \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0434\u0430\u043D\u043D\u044B\u0445 \u2014 \u0431\u044D\u043A\u0435\u043D\u0434")))), /*#__PURE__*/React.createElement(PortalModal, {
    portal: selectedPortal,
    onClose: () => setSelected(null),
    onAction: runAction
  }));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
