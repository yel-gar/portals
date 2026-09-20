import { dockerCompose, resetPortals, waitHttp } from "./helpers";

/**
 * Runs once per `playwright test` invocation: bring the isolated `portals-e2e`
 * compose project up (own ports 8010/3010, own volume — no dev override or
 * `.env` involvement), wait for backend health, seed the demo portals. The
 * `live` project later re-creates only the backend with the simulator enabled.
 */
export default async function globalSetup(): Promise<void> {
  dockerCompose(["up", "-d", "--build"]);
  await waitHttp("http://localhost:8010/health", 300_000, "health бэкенда");
  resetPortals();
  await waitHttp("http://localhost:3010/", 60_000, "фронтенда");
}
