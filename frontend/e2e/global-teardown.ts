import { dockerCompose } from "./helpers";

/**
 * Runs once after all projects: tear the stack down with `-v` so every run
 * starts from a fresh volume (deterministic seeding). Set `E2E_KEEP_STACK=1`
 * to leave it running for local debugging.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_STACK === "1") {
    return;
  }
  dockerCompose(["down", "-v"]);
}
