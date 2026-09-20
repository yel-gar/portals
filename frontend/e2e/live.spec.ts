import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { registerUser, REPO_ROOT, waitHttp } from "./helpers";

/**
 * The one live-updates smoke test, running as the trailing `live` project: the
 * deterministic suite leaves the stack with DISABLE_SIMULATOR=1, so this test
 * re-creates ONLY the backend with the simulator enabled (`docker-compose.e2e.live.yml`
 * merged over the base). With the sim off, stability/creatures never move and
 * delta badges never render (the 30 s REST poll only shifts risk by < 0.01,
 * below the badge threshold) — their appearance proves the WebSocket frames.
 */
test("симулятор двигает данные, таблица обновляется по WebSocket", async ({ page }) => {
  test.setTimeout(240_000);

  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.e2e.yml",
      "-f",
      "docker-compose.e2e.live.yml",
      "up",
      "-d",
      "--no-build",
      "--force-recreate",
      "backend",
    ],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  await waitHttp("http://localhost:8010/health", 120_000, "health бэкенда (live)");

  await registerUser(page, "e2e_live", "live-pass-1");
  await expect(page.locator(".app-live--open")).toBeVisible({ timeout: 60_000 });

  // Sim ticks run every 10 s; with six open portals the chance of all rows
  // staying identical on every tick is negligible — a delta badge appears
  // within a few ticks.
  await expect(page.locator(".delta-indicator").first()).toBeVisible({ timeout: 120_000 });
});
