import { useEffect } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { RequireAuth, RequireSuperuser } from "./RequireAuth";
import { usePortalAction } from "../hooks/usePortalAction";
import { StatsPage } from "../pages/StatsPage";
import { API_URL, DEMO_USER, server, SUPER_USER } from "../test/mocks";
import { renderWithProviders } from "../test/render";

function LoginProbe({ onFrom }: { onFrom: (from: string | null) => void }) {
  const location = useLocation();
  useEffect(() => {
    onFrom((location.state as { from?: string } | null)?.from ?? null);
  }, [location.state, onFrom]);
  return <div>login page</div>;
}

/** Mounts a data query (stats) and a mutation (portal action) inside RequireAuth. */
function ActionProbe() {
  const action = usePortalAction();
  return (
    <div>
      <button onClick={() => action.mutate({ portalId: 1, action: "DISMISS" })}>run action</button>
      <StatsPage />
    </div>
  );
}

const gateRoutes = (onFrom: (from: string | null) => void) => (
  <Routes>
    <Route path="/login" element={<LoginProbe onFrom={onFrom} />} />
    <Route
      path="*"
      element={
        <RequireAuth>
          <div>protected content</div>
        </RequireAuth>
      }
    />
  </Routes>
);

describe("RequireAuth", () => {
  it("shows a spinner while the session is being checked", () => {
    server.use(http.get(API_URL("/auth/me"), () => new Promise<never>(() => {})));

    renderWithProviders(<div />, { routes: gateRoutes(() => {}) });

    expect(document.querySelector(".app-loading")).not.toBeNull();
  });

  it("redirects unauthenticated visitors to the login page with the from state", async () => {
    let from: string | null = null;

    renderWithProviders(<div />, {
      routes: gateRoutes((value) => {
        from = value;
      }),
      initialEntries: ["/secret?x=1"],
    });

    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(from).toBe("/secret?x=1");
  });

  it("shows an error result when the session check fails", async () => {
    server.use(
      http.get(API_URL("/auth/me"), () =>
        HttpResponse.json({ detail: "Сервер недоступен" }, { status: 500 }),
      ),
    );

    renderWithProviders(<div />, { routes: gateRoutes(() => {}) });

    expect(await screen.findByText("Не удалось проверить сессию")).toBeInTheDocument();
  });

  it("renders children for an authenticated user", async () => {
    server.use(http.get(API_URL("/auth/me"), () => HttpResponse.json(DEMO_USER)));

    renderWithProviders(<div />, { routes: gateRoutes(() => {}) });

    expect(await screen.findByText("protected content")).toBeInTheDocument();
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
  });

  it("retries the session check when the user clicks Повторить", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get(API_URL("/auth/me"), () => {
        calls += 1;
        // A transient blip: the second attempt succeeds.
        return calls === 1
          ? HttpResponse.json({ detail: "Сервер недоступен" }, { status: 500 })
          : HttpResponse.json(DEMO_USER);
      }),
    );

    renderWithProviders(<div />, { routes: gateRoutes(() => {}) });

    expect(await screen.findByText("Не удалось проверить сессию")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить" }));

    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });

  it("routes to login when a REST query gets a 401 after auth was established", async () => {
    // The cookie is valid at first; asking the backend for data exposes that the
    // session has expired (stats has no WebSocket channel to notice it via).
    let sessionValid = true;
    server.use(
      http.get(API_URL("/auth/me"), () =>
        sessionValid ? HttpResponse.json(DEMO_USER) : HttpResponse.json(null, { status: 401 }),
      ),
      http.get(API_URL("/portals/stats"), () => {
        sessionValid = false;
        return HttpResponse.json({ detail: "Сессия истекла" }, { status: 401 });
      }),
    );

    renderWithProviders(<div />, {
      routes: (
        <Routes>
          <Route path="/login" element={<LoginProbe onFrom={() => {}} />} />
          <Route
            path="*"
            element={
              <RequireAuth>
                <ActionProbe />
              </RequireAuth>
            }
          />
        </Routes>
      ),
    });

    // The 401 on /portals/stats invalidates the me check, which answers 401 →
    // RequireAuth redirects to the login page.
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("routes to login when a mutation gets a 401", async () => {
    const user = userEvent.setup();
    let sessionValid = true;
    server.use(
      http.get(API_URL("/auth/me"), () =>
        sessionValid ? HttpResponse.json(DEMO_USER) : HttpResponse.json(null, { status: 401 }),
      ),
      http.post(`${API_URL("/portals")}/:id`, () => {
        sessionValid = false;
        return HttpResponse.json({ detail: "Сессия истекла" }, { status: 401 });
      }),
    );

    renderWithProviders(<div />, {
      routes: (
        <Routes>
          <Route path="/login" element={<LoginProbe onFrom={() => {}} />} />
          <Route
            path="*"
            element={
              <RequireAuth>
                <ActionProbe />
              </RequireAuth>
            }
          />
        </Routes>
      ),
    });

    const button = await screen.findByRole("button", { name: "run action" });
    await user.click(button);

    // The 401 from the action mutation invalidates the me check → login page.
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });
});

describe("RequireSuperuser", () => {
  it("blocks regular operators with a 403 result", async () => {
    server.use(http.get(API_URL("/auth/me"), () => HttpResponse.json(DEMO_USER)));

    renderWithProviders(
      <RequireSuperuser>
        <div>admin content</div>
      </RequireSuperuser>,
    );

    expect(
      await screen.findByText("Раздел доступен только суперпользователю."),
    ).toBeInTheDocument();
    expect(screen.queryByText("admin content")).not.toBeInTheDocument();
  });

  it("renders children for superusers", async () => {
    server.use(http.get(API_URL("/auth/me"), () => HttpResponse.json(SUPER_USER)));

    renderWithProviders(
      <RequireSuperuser>
        <div>admin content</div>
      </RequireSuperuser>,
    );

    expect(await screen.findByText("admin content")).toBeInTheDocument();
  });
});
