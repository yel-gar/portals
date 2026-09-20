import { expect, test } from "@playwright/test";

import { registerUser } from "./helpers";

test("страница журнала разработки рендерит AI-WORKLOG.md", async ({ page }) => {
  await registerUser(page, "e2e_wl", "worklog-pass-1");
  await page.locator(".app-nav").getByText("Журнал разработки", { exact: true }).click();
  await expect(page).toHaveURL(/\/worklog/);
  // The canonical repo-root file is served and rendered as markdown with
  // highlighted code fences (rehype-highlight) — smoke-level assertions.
  await expect(page.locator(".worklog-markdown h1").first()).toBeVisible();
  await expect(page.locator(".worklog-markdown pre code").first()).toBeVisible();
});
