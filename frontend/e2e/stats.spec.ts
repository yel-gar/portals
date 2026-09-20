import { expect, test } from "@playwright/test";

import { registerUser, resetPortals } from "./helpers";

// Aggregate counts come from the pristine demo set (7 portals, 1 closed);
// reset so a frozen-TTL baseline can never be skewed by earlier run leftovers.
test.beforeAll(() => {
  resetPortals();
});

test("карточки статистики отражают демо-данные", async ({ page }) => {
  await registerUser(page, "e2e_stats", "stats-pass-1");
  await page.locator(".app-nav").getByText("Статистика", { exact: true }).click();
  await expect(page).toHaveURL(/\/stats/);

  // The numeric value only (`.ant-statistic-content-value`), so a delta suffix
  // appearing after the 20 s stats poll cannot break the assertion.
  const stat = (title: string) =>
    page.locator(".ant-statistic", { hasText: title }).locator(".ant-statistic-content-value");

  await expect(stat("Всего порталов")).toHaveText("7");
  await expect(stat("Открыто")).toHaveText("6");
  await expect(stat("Закрыто")).toHaveText("1");
});
