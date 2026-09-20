import { defineConfig, devices } from "@playwright/test";

// E2E suite against the isolated prod-like compose stack
// (docker-compose.e2e.yml, project `portals-e2e`, ports 8010/3010), brought up
// and seeded by global-setup.ts / teardown. Deterministic specs run with
// DISABLE_SIMULATOR=1; the `live` project re-creates just the backend with the
// simulator on (see docker-compose.e2e.live.yml) and must run last.
export default defineConfig({
  testDir: "./e2e",
  // One physical stack shared by every test: never let specs run against each
  // other's writes, and keep `live` strictly after `chromium` (config order).
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3010",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /live\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "live",
      testMatch: /live\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      // Sim ticks + WS reconnect windows make this a deliberately slow smoke.
      timeout: 240_000,
    },
  ],
});
