import { expect, test } from "@playwright/test";

import { login } from "./helpers";

// Credentials match `INITIAL_SUPERUSER_*` in docker-compose.e2e.yml.
const SUPERUSER_USERNAME = "admin";
const SUPERUSER_PASSWORD = "e2e-admin-pw-1";

test("суперпользователь управляет пользователями", async ({ page }) => {
  await login(page, SUPERUSER_USERNAME, SUPERUSER_PASSWORD);
  await expect(page.locator(".app-user-role")).toHaveText("Суперпользователь");

  await page.locator(".app-nav").getByText("Администрирование", { exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users/);

  // The bootstrapped superuser is listed with its role.
  const adminRow = page.locator(".ant-table-row", { hasText: SUPERUSER_USERNAME });
  await expect(adminRow.getByText("Суперпользователь")).toBeVisible();

  // Create an operator through the modal.
  await page.getByRole("button", { name: "Создать пользователя" }).click();
  await page.getByLabel("Имя пользователя").fill("e2e_target");
  await page.getByLabel("Пароль").fill("target-pass-1");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  const targetRow = page.locator(".ant-table-row", { hasText: "e2e_target" });
  await expect(targetRow).toBeVisible();
  await expect(targetRow.getByText("Оператор")).toBeVisible();

  // Change the operator's password.
  await targetRow.getByRole("button", { name: "Сменить пароль" }).click();
  await expect(page.getByText("Смена пароля: e2e_target")).toBeVisible();
  // Both modal forms render an input with id="password", so the «Новый пароль»
  // label resolves to the closed create-modal's hidden input — address the
  // visible dialog instead.
  const passwordDialog = page.getByRole("dialog", { name: "Смена пароля: e2e_target" });
  await passwordDialog.locator("input[type='password']").fill("target-pass-2");
  await passwordDialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Пароль изменён")).toBeVisible();

  // Delete the operator (Popconfirm confirm button, scoped to the popover —
  // the row has its own «Удалить» trigger too).
  await targetRow.getByRole("button", { name: "Удалить" }).click();
  await page.locator(".ant-popover").getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByText("Пользователь удалён")).toBeVisible();
  await expect(page.locator(".ant-table-row", { hasText: "e2e_target" })).toHaveCount(0);
});
