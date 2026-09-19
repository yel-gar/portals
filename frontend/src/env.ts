/**
 * Runtime configuration from Vite env vars. The backend stays the single
 * source of truth; these flags only mirror what compose already wired into
 * the backend (see `docker-compose.yml` / `docker-compose.override.yml.dev`).
 */

/** Env values are strings; treat empty/0/false as off, anything else as on. */
export function isTruthyEnv(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

/**
 * When truthy the Register page must not offer signup: the backend returns
 * 403 "Регистрация отключена" for any attempt, so the UI hides the form. Read
 * lazily so tests can stub it via `vi.stubEnv`.
 */
export function isRegistrationDisabled(): boolean {
  return isTruthyEnv(import.meta.env.VITE_DISABLE_REGISTRATION);
}
