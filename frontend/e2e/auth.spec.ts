import { expect, test } from "@playwright/test";

import { login, registerUser } from "./helpers";

test("новая учётная запись регистрируется и сразу входит", async ({ page }) => {
  const user = await registerUser(page, "e2e_op", "operator-pass-1");
  await expect(page.locator(".app-live--open")).toBeVisible();
  await expect(page.locator(".app-user-name")).toHaveText(user);
});

test("неавторизованный визит ведёт на страницу входа", async ({ page }) => {
  await page.goto("/portals");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
});

test("выход и повторный вход", async ({ page }) => {
  const user = await registerUser(page, "e2e_again", "again-pass-1");
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, user, "again-pass-1");
  await expect(page.locator(".app-user-name")).toHaveText(user);
});

test("неверный пароль отклоняется с сообщением", async ({ page }) => {
  const user = await registerUser(page, "e2e_owner", "owner-pass-1");
  await page.getByRole("button", { name: "Выйти" }).click();
  await page.goto("/login");
  await page.getByLabel("Имя пользователя").fill(user);
  await page.getByLabel("Пароль").fill("wrong-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("Неверное имя пользователя или пароль")).toBeVisible();
});

test("обычный оператор не видит администрирование", async ({ page }) => {
  await registerUser(page, "e2e_regular", "regular-pass-1");
  await expect(page.locator(".app-nav").getByText("Администрирование")).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(page.getByText("Раздел доступен только суперпользователю.")).toBeVisible();
});
