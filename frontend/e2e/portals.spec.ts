import { expect, test } from "@playwright/test";

import { registerUser, resetPortals, selectOption, tableRows } from "./helpers";

// Filters and counts are asserted against the pristine demo set; reset it so a
// stale DB (e.g. from a locally kept stack) cannot skew them.
test.beforeAll(() => {
  resetPortals();
});

test("таблица показывает посеянные порталы и статусы", async ({ page }) => {
  await registerUser(page, "e2e_table", "table-pass-1");
  await expect(page.getByText("Всего: 7")).toBeVisible();
  // Decorative fire side panels render in every environment (here the static
  // gradient — headless chromium has no WebGPU and reduced motion is emulated).
  await expect(page.locator(".fire-panels")).toBeVisible();
  await expect(page.locator(".ant-table-row", { hasText: "Портал Гамма" })).toBeVisible();
  await expect(
    page
      .locator(".ant-table-row", { hasText: "Портал Эпсилон" })
      .getByText("закрыт", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".ant-table-row", { hasText: "Портал Бета" }).getByText("Отмечено"),
  ).toBeVisible();
});

test("поиск по названию сужает таблицу", async ({ page }) => {
  await registerUser(page, "e2e_search", "search-pass-1");
  const search = page.getByLabel("Поиск по названию или миру");
  await search.fill("Эпсилон");
  await search.press("Enter");
  await expect(page.getByText("Всего: 1")).toBeVisible();
  await expect(tableRows(page)).toHaveCount(1);
  await expect(tableRows(page).getByText("Портал Эпсилон")).toBeVisible();
});

test("фильтр «Закрытые» показывает только закрытые", async ({ page }) => {
  await registerUser(page, "e2e_closed", "closed-pass-1");
  await selectOption(page, "Состояние", "Закрытые");
  await expect(page.getByText("Всего: 1")).toBeVisible();
  await expect(tableRows(page).getByText("Портал Эпсилон")).toBeVisible();
});

test("фильтр по уровню опасности «Средний»", async ({ page }) => {
  await registerUser(page, "e2e_mid", "mid-pass-1");
  await selectOption(page, "Уровень опасности", "Средний");
  await expect(page.getByText("Всего: 3")).toBeVisible();
});

test("фильтр «С наблюдателем»", async ({ page }) => {
  await registerUser(page, "e2e_obs", "obs-pass-1");
  await selectOption(page, "Наблюдатель", "С наблюдателем");
  await expect(page.getByText("Всего: 2")).toBeVisible();
  await expect(page.locator(".ant-table-row", { hasText: "Портал Альфа" })).toBeVisible();
  await expect(page.locator(".ant-table-row", { hasText: "Портал Эта" })).toBeVisible();
});

test("фильтр «Отмеченные»", async ({ page }) => {
  await registerUser(page, "e2e_marked", "marked-pass-1");
  await selectOption(page, "Отметка", "Отмеченные");
  await expect(page.getByText("Всего: 2")).toBeVisible();
  await expect(tableRows(page).getByText("Отмечено")).toHaveCount(2);
});

test("сброс фильтров возвращает полный список", async ({ page }) => {
  await registerUser(page, "e2e_reset", "reset-pass-1");
  const search = page.getByLabel("Поиск по названию или миру");
  await search.fill("Эпсилон");
  await search.press("Enter");
  await expect(page.getByText("Всего: 1")).toBeVisible();
  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page.getByText("Всего: 7")).toBeVisible();
});

test("сортировка по алфавиту", async ({ page }) => {
  await registerUser(page, "e2e_sort", "sort-pass-1");
  await selectOption(page, "Сортировка", "По алфавиту");
  await expect(tableRows(page).first().getByText("Портал Альфа")).toBeVisible();
});
