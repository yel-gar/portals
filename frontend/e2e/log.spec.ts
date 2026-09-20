import { expect, test } from "@playwright/test";

import { registerUser, resetPortals, selectOption, tableRows } from "./helpers";

// The log assertions rely on an empty log: reset the demo data first (no portal
// actions have happened before this file — nothing here depends on the users
// registered earlier in the run).
test.beforeAll(() => {
  resetPortals();
});

test("действия оператора фиксируются в журнале и фильтруются", async ({ page }) => {
  await registerUser(page, "e2e_logger", "logger-pass-1");

  // Mark then unmark Зета: two committed actions → two log entries.
  await page.locator(".ant-table-row", { hasText: "Портал Зета" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Отметить" }).click();
  await dialog.getByRole("button", { name: "Снять отметку" }).click();

  // The portal modal stays open and its full-screen wrap would intercept the
  // nav click, so close it first.
  await page.keyboard.press("Escape");

  await page.locator(".app-nav").getByText("Журнал действий", { exact: true }).click();
  await expect(page).toHaveURL(/\/log/);
  await expect(page.getByText("Всего: 2")).toBeVisible();

  // Filter by «Снять отметку» → a single row remains.
  await selectOption(page, "Действие", "Снять отметку");
  await expect(tableRows(page)).toHaveCount(1);
  await expect(tableRows(page).getByText("Снять отметку")).toBeVisible();

  // Reset the filters → both entries are back.
  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page.getByText("Всего: 2")).toBeVisible();
});
