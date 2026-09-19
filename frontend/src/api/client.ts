/**
 * Base backend origin. Baked into the production bundle via the `VITE_BACKEND_URL`
 * build arg (see `Dockerfile` / `docker-compose.yml`); injected at runtime for the
 * Vite dev server by the compose override. When empty, the app talks to its own
 * origin (useful behind a reverse proxy).
 */
export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/+$/, "");

/** An error response from the API, carrying the HTTP status and Russian `detail`. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Turn a FastAPI `detail` payload (string or validation-error list) into a readable message. */
export function detailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.length > 0) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item && typeof item.msg === "string") {
          const loc = "loc" in item && Array.isArray(item.loc) ? item.loc.join(".") : "";
          return loc ? `${loc}: ${item.msg}` : item.msg;
        }
        return null;
      })
      .filter((part): part is string => part !== null);
    if (parts.length > 0) {
      return parts.join("; ");
    }
  }
  return fallback;
}

type QueryValue = string | number | boolean | null | undefined;
export type { QueryValue };

function withQuery(path: string, query?: Record<string, QueryValue>): string {
  if (!query) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
}

/**
 * Perform a JSON request against the backend. Cookies are always included, so the
 * httpOnly `session_token` set by `/auth/login` authenticates every call.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query } = options;
  const response = await fetch(`${BACKEND_URL}${withQuery(path, query)}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = (await response.json()) as unknown;
    } catch {
      detail = undefined;
    }
    const message =
      detail && typeof detail === "object" && "detail" in detail
        ? detailToMessage((detail as { detail: unknown }).detail, response.statusText)
        : response.statusText;
    throw new ApiError(response.status, message || `Ошибка ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Build an absolute WebSocket URL, upgrading `http(s)` to `ws(s)`. */
export function websocketUrl(path: string, query: Record<string, QueryValue>): string {
  const base = BACKEND_URL || window.location.origin;
  const url = new URL(withQuery(path, query), base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
