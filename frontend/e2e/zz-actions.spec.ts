import { expect, test } from "@playwright/test";

import { registerUser, resetPortals, tableRows } from "./helpers";

// Portal-action specs mutate shared state (mark/close/observer), so they run
// serially against a freshly seeded stack; a failed test skips the rest instead
// of letting every subsequent assertion see the leftovers.
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetPortals();
});

test("отметка и снятие отметки обновляют модалку и таблицу", async ({ page }) => {
  await registerUser(page, "e2e_actor", "actor-pass-1");
  const row = page.locator(".ant-table-row", { hasText: "Портал Альфа" });
  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Портал Альфа")).toBeVisible();

  await dialog.getByRole("button", { name: "Отметить" }).click();
  await expect(dialog.getByRole("button", { name: "Снять отметку" })).toBeVisible();
  // The table badge appears via the snapshot WebSocket, no manual refresh.
  await expect(row.getByText("Отмечено")).toBeVisible();

  await dialog.getByRole("button", { name: "Снять отметку" }).click();
  await expect(dialog.getByRole("button", { name: "Отметить" })).toBeVisible();
  await expect(row.getByText("Отмечено")).toHaveCount(0);
});

test("закрытие портала блокирует действия и помечает строку", async ({ page }) => {
  await registerUser(page, "e2e_closer", "closer-pass-1");
  const row = page.locator(".ant-table-row", { hasText: "Портал Дельта" });
  await row.click();
  const dialog = page.getByRole("dialog");
  // The modal's own close (X) button picks up the ru_RU aria-label «Закрыть», so
  // the action button is addressed inside the modal body only.
  await dialog.locator(".ant-modal-body").getByRole("button", { name: "Закрыть" }).click();
  await expect(dialog.getByText("закрыт", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Стабилизировать" })).toBeDisabled();

  await page.keyboard.press("Escape");
  // The closed row now wears the red «закрыт» tag in the «Истекает» column.
  await expect(row.getByText("закрыт", { exact: true })).toBeVisible();
});

test("наблюдатель: отправить и отозвать", async ({ page }) => {
  await registerUser(page, "e2e_obs", "observer-pass-1");
  const row = page.locator(".ant-table-row", { hasText: "Портал Эта" });
  await row.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Отозвать наблюдателя" }).click();
  await expect(dialog.getByRole("button", { name: "Отправить наблюдателя" })).toBeVisible();
  await dialog.getByRole("button", { name: "Отправить наблюдателя" }).click();
  await expect(dialog.getByRole("button", { name: "Отозвать наблюдателя" })).toBeVisible();
});

test("закрытый портал: доступны только отметка и снятие отметки", async ({ page }) => {
  await registerUser(page, "e2e_closed", "closed-pass-1");
  const row = page.locator(".ant-table-row", { hasText: "Портал Эпсилон" });
  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("закрыт", { exact: true })).toBeVisible();
  await expect(
    dialog.locator(".ant-modal-body").getByRole("button", { name: "Закрыть" }),
  ).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Стабилизировать" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Отправить наблюдателя" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Отметить" })).toBeEnabled();
});

test("действия фиксируются в журнале", async ({ page }) => {
  const user = await registerUser(page, "e2e_logged", "logged-pass-1");
  const row = page.locator(".ant-table-row", { hasText: "Портал Зета" });
  await row.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Отметить" }).click();
  await dialog.getByRole("button", { name: "Снять отметку" }).click();

  // The portal modal stays open and its full-screen wrap would intercept the
  // nav click, so close it first.
  await page.keyboard.press("Escape");

  await page.locator(".app-nav").getByText("Журнал действий", { exact: true }).click();
  await expect(page).toHaveURL(/\/log/);
  // The log table lists portals by id (no name column), so address the newest
  // row — the operator's own last action — instead of a portal name.
  await expect(tableRows(page).first().getByText("Снять отметку")).toBeVisible();
  await expect(tableRows(page).first().getByText(user)).toBeVisible();
});
