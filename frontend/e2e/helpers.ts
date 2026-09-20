import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

/** `frontend/e2e` and the repo root (`frontend/e2e/../..`). */
export const E2E_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(E2E_DIR, "../..");

/** Compose flags targeting the e2e stack; every command runs from the repo root. */
const COMPOSE_FLAGS = ["-f", "docker-compose.e2e.yml"] as const;

/** Run a `docker compose` command against the e2e stack; returns stdout. */
export function dockerCompose(args: string[]): string {
  return execFileSync("docker", ["compose", ...COMPOSE_FLAGS, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

/** Poll an HTTP URL until it answers 2xx or the deadline passes. */
export async function waitHttp(url: string, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Sequential retries via recursion — a `while` + await would trip oxlint's
  // no-await-in-loop, and the retries are intentionally ordered anyway.
  const attempt = async (): Promise<void> => {
    if (Date.now() >= deadline) {
      throw new Error(`Не дождались «${what}» (${url})`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Not up yet — retry.
    }
    await new Promise((settle) => setTimeout(settle, 2000));
    return attempt();
  };
  await attempt();
}

/**
 * Wipe the portal data and re-seed the demo set as a deterministic baseline.
 * Open portals get `expires_at` frozen ~2 h out, so nothing expires mid-run
 * (the demo TTLs start at 3 minutes — Гамма would otherwise close itself while
 * the suite is still running); the seeded closed portal stays closed.
 */
export function resetPortals(): void {
  wipePortals();
  dockerCompose(["exec", "-T", "backend", "/app/.venv/bin/python", "populate.py"]);
  dockerCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "portals",
    "-c",
    "UPDATE portals SET expires_at = now() + interval '2 hours' WHERE is_closed = false;",
  ]);
}

/** Delete every portal and action-log row (cascades; users are untouched). */
export function wipePortals(): void {
  dockerCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "portals",
    "-c",
    "TRUNCATE portals, action_log CASCADE;",
  ]);
}

/**
 * Bulk-insert `count` open demo portals («Портал N», world «Мир N») with TTL
 * frozen at +2 h — volume/shape tests must not depend on a slow seed loop.
 */
export function seedBulkPortals(count: number): void {
  dockerCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "portals",
    "-c",
    `INSERT INTO portals (name, destination_world, energy_level, stability, creatures_count, ` +
      `expires_at, is_marked, has_observer, is_closed) ` +
      `SELECT 'Портал ' || i, 'Мир ' || i, (i * 7) % 101, (i * 13) % 101, i % 12, ` +
      `now() + interval '2 hours', false, false, false FROM generate_series(1, ${count}) AS i;`,
  ]);
}

/**
 * Bulk-insert `count` action-log rows cycling through every action (so each
 * action appears exactly `count / 8` times), newest timestamp last, against the
 * first portal (NULL user — a deleted account is a legitimate log row).
 */
export function seedBulkLogs(count: number): void {
  dockerCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "portals",
    "-c",
    `INSERT INTO action_log (user_id, portal_id, action, timestamp) ` +
      `SELECT NULL, (SELECT id FROM portals ORDER BY id LIMIT 1), ` +
      `(ARRAY['DISMISS','STABILIZE','SEND_OBSERVER','RECALL_OBSERVER','CLOSE','MARK',` +
      `'UNMARK','WARN_CREATURES']::action[])[i % 8 + 1], ` +
      `now() - ((${count} - i) * interval '1 second') FROM generate_series(1, ${count}) AS i;`,
  ]);
}

/** Log in with the given credentials; asserts the app lands on /portals. */
export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Имя пользователя").fill(username);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/portals/);
}

/**
 * Pick an antd Select option: open the select by its `aria-label`, then click
 * the option's `.ant-select-item-option` wrapper. antd's `role="option"` divs
 * are zero-size virtual-list measure nodes (not clickable), and bare `hasText`
 * substring matching would conflate options like «Отмеченные»/«Не отмеченные»,
 * so the click targets the wrapper that exactly contains the option's label.
 */
export async function selectOption(
  page: Page,
  ariaLabel: string,
  optionText: string,
): Promise<void> {
  await page.getByLabel(ariaLabel).click();
  await page
    .locator(".ant-select-item-option")
    .filter({ has: page.getByText(optionText, { exact: true }) })
    .click();
}

/**
 * Data rows of an antd Table. `tbody tr` also matches antd's hidden
 * `.ant-table-measure-row`, so row counts and `.first()` must use this.
 */
export function tableRows(page: Page) {
  return page.locator(".ant-table-row");
}

/**
 * Register a new operator and return the username actually used. Every call
 * gets a unique suffix: some specs share a username (e2e_obs in portals.spec
 * and zz-actions.spec) and kept stacks would otherwise 409 the second attempt.
 * Registration auto-logs the session in (lands on /portals).
 */
export async function registerUser(
  page: Page,
  username: string,
  password: string,
): Promise<string> {
  const unique = `${username}_${Date.now().toString(36)}`;
  await page.goto("/register");
  await page.getByLabel("Имя пользователя").fill(unique);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page).toHaveURL(/\/portals/);
  return unique;
}
