import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import type { Portal, PortalPage, Stats, UserOut } from "../api/types";

/** Must mirror `test.env.VITE_BACKEND_URL` (vite.config.ts). */
export const BACKEND_ORIGIN = "http://localhost:8000";

/** Build an absolute handler URL: `API_URL("/auth/login")`. */
export const API_URL = (path: string): string => `${BACKEND_ORIGIN}${path}`;

export const DEMO_USER: UserOut = { id: 1, username: "demo", is_superuser: false };
export const SUPER_USER: UserOut = { id: 2, username: "admin", is_superuser: true };

const MOCK_NOW = "2026-09-19T12:00:00Z";

export const OPEN_PORTAL: Portal = {
  id: 1,
  name: "Портал Альфа",
  destination_world: "Зеркальная пустошь",
  energy_level: 82,
  stability: 64,
  closed: false,
  creatures_count: 3,
  is_marked: false,
  has_observer: true,
  last_update: "2026-09-19T11:55:00Z",
  expires_at: "2026-09-19T14:00:00Z",
  dismissed_until: null,
  risk_factor: 0.41,
  danger_level: "MEDIUM",
};

export const CLOSED_PORTAL: Portal = {
  id: 2,
  name: "Портал Бета",
  destination_world: "Долина туманов",
  energy_level: 10,
  stability: 100,
  closed: true,
  creatures_count: 0,
  is_marked: true,
  has_observer: false,
  last_update: "2026-09-18T20:00:00Z",
  expires_at: "2026-09-18T20:00:00Z",
  dismissed_until: null,
  risk_factor: 0.12,
  danger_level: "LOW",
};

export function portalPage(
  items: Portal[] = [OPEN_PORTAL, CLOSED_PORTAL],
  page = 1,
  itemsPerPage = 20,
): PortalPage {
  return { items, page, items_per_page: itemsPerPage, total: items.length };
}

export const MOCK_STATS: Stats = {
  total: 2,
  open: 1,
  closed: 1,
  marked: 1,
  with_observer: 1,
  danger_levels: { LOW: 0, MEDIUM: 1, HIGH: 0, CRITICAL: 0 },
  avg_risk: 0.41,
};

/**
 * Default `/AI-WORKLOG.md` payload for tests. Production/dev deployments mount
 * the repo-root `AI-WORKLOG.md` into the container (see the compose files);
 * tests use this deterministic fixture instead.
 */
export const WORKLOG_MARKDOWN = `# Этап 1: конфигурация проекта и CI pipeline

Абзац о настройке CI-пайплайна.

\`\`\`python
def hello():
    return "world"
\`\`\`

## Этап 2: бэкенд и тесты
`;

/**
 * Default API surface for tests. Individual tests override handlers with
 * `server.use(...)` when they need a specific behaviour (see `server.ts`).
 * Handler URLs are absolute: path-only patterns do not resolve against the
 * backend origin in the current MSW build.
 */
export const handlers = [
  // By default no session exists; login/register succeed.
  http.get(`${BACKEND_ORIGIN}/auth/me`, () => HttpResponse.json(null, { status: 401 })),
  http.post(`${BACKEND_ORIGIN}/auth/login`, () => HttpResponse.json(DEMO_USER)),
  http.post(`${BACKEND_ORIGIN}/auth/register`, () => HttpResponse.json(DEMO_USER, { status: 201 })),
  http.post(`${BACKEND_ORIGIN}/auth/logout`, () => new HttpResponse(null, { status: 204 })),

  http.get(`${BACKEND_ORIGIN}/portals`, () => HttpResponse.json(portalPage())),
  http.post(`${BACKEND_ORIGIN}/portals/:id`, () => HttpResponse.json(OPEN_PORTAL)),
  http.get(`${BACKEND_ORIGIN}/portals/stats`, () => HttpResponse.json(MOCK_STATS)),
  http.get(`${BACKEND_ORIGIN}/portals/log`, () =>
    HttpResponse.json({ items: [], page: 1, items_per_page: 20, total: 0 }),
  ),

  // The worklog lives on the frontend origin: any host + path matches.
  http.get("*/AI-WORKLOG.md", () => HttpResponse.text(WORKLOG_MARKDOWN)),
];

export const server = setupServer(...handlers);

export { MOCK_NOW };
