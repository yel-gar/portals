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

test("вход с несуществующим именем пользователя отклоняется", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Имя пользователя").fill("e2e_absent_user");
  await page.getByLabel("Пароль").fill("absent-pass-1");
  await page.getByRole("button", { name: "Войти" }).click();
  // The backend intentionally answers the same message for a missing username
  // and for a wrong password (timing-equalised), so only the message matters.
  await expect(page.getByText("Неверное имя пользователя или пароль")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("вход со слишком длинными данными отклоняется", async ({ page }) => {
  await page.goto("/login");
  // The login form has no maxLength rules — the 422 comes from the backend
  // (username ≤ 64, password ≤ 128) and its pydantic message is shown verbatim.
  await page.getByLabel("Имя пользователя").fill("x".repeat(200));
  await page.getByLabel("Пароль").fill("y".repeat(200));
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText(/String should have at most 64 characters/)).toBeVisible();
  await expect(page.getByText(/String should have at most 128 characters/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("регистрация без данных показывает ошибки валидации", async ({ page }) => {
  await page.goto("/register");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  // antd Form rules block the submit client-side; nothing reaches the server.
  await expect(page.getByText("Введите имя пользователя")).toBeVisible();
  await expect(page.getByText("Введите пароль")).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});

test("регистрация со слишком длинными данными блокируется формой", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Имя пользователя").fill("x".repeat(200));
  await page.getByLabel("Пароль").fill("y".repeat(200));
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByText("Длина имени — от 4 до 64 символов")).toBeVisible();
  await expect(page.getByText("Длина пароля — от 8 до 128 символов")).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});
