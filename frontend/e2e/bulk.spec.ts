import { expect, test } from "@playwright/test";

import {
  registerUser,
  seedBulkLogs,
  seedBulkPortals,
  selectOption,
  tableRows,
  wipePortals,
} from "./helpers";

// Volume and empty-state scenarios that deliberately leave the DB in a
// non-demo shape. Every other spec re-seeds in its own beforeAll, so the
// alphabetical file order never leaks these leftovers into their assertions.

test("пустая доска: таблица пуста и показывает ноль порталов", async ({ page }) => {
  wipePortals();
  await registerUser(page, "e2e_void", "void-pass-1");
  await expect(page.getByText("Всего: 0")).toBeVisible();
  // antd's Empty image also carries a «Нет данных» <title>, so target the
  // description element to avoid a strict-mode clash.
  await expect(page.locator(".ant-empty-description")).toBeVisible();
  await expect(tableRows(page)).toHaveCount(0);
});

test("пустая статистика рендерит нули без ошибок", async ({ page }) => {
  wipePortals();
  await registerUser(page, "e2e_voidstats", "voidstats-pass-1");
  await page.locator(".app-nav").getByText("Статистика", { exact: true }).click();
  await expect(page).toHaveURL(/\/stats/);
  await expect(
    page.getByText("Общее число порталов — 0, из них открыто 0, закрыто 0"),
  ).toBeVisible();
  // Average risk for zero open portals is 0.00, not NaN.
  await expect(page.getByText("0.00").first()).toBeVisible();
});

test("десять тысяч порталов на доске рендерятся постранично", async ({ page }) => {
  wipePortals();
  seedBulkPortals(10_000);
  await registerUser(page, "e2e_bulk", "bulk-pass-1");
  await expect(page.getByText("Всего: 10000")).toBeVisible();
  // The table paginates at 20 rows per page.
  await expect(page.getByText("1–20 из 10000")).toBeVisible();
  await expect(tableRows(page)).toHaveCount(20);
});

test("пустой журнал действий показывает пустое состояние", async ({ page }) => {
  wipePortals();
  await registerUser(page, "e2e_emptylog", "emptylog-pass-1");
  await page.locator(".app-nav").getByText("Журнал действий", { exact: true }).click();
  await expect(page).toHaveURL(/\/log/);
  await expect(page.getByText("Всего: 0")).toBeVisible();
  await expect(page.locator(".ant-empty-description")).toBeVisible();
});

test("сто тысяч записей журнала рендерятся и фильтруются", async ({ page }) => {
  wipePortals();
  // The log rows need a portal for the FK; one suffices.
  seedBulkPortals(1);
  // Rows cycle all eight actions, so «Снять отметку» is exactly 100000 / 8.
  seedBulkLogs(100_000);
  await registerUser(page, "e2e_biglog", "biglog-pass-1");
  await page.locator(".app-nav").getByText("Журнал действий", { exact: true }).click();
  await expect(page).toHaveURL(/\/log/);
  await expect(page.getByText("Всего: 100000")).toBeVisible();
  await expect(tableRows(page)).toHaveCount(20);

  await selectOption(page, "Действие", "Снять отметку");
  await expect(page.getByText("Всего: 12500")).toBeVisible();

  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page.getByText("Всего: 100000")).toBeVisible();
});
