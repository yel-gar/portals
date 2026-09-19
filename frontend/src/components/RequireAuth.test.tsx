import { useEffect } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { RequireAuth, RequireSuperuser } from "./RequireAuth";
import { API_URL, DEMO_USER, server, SUPER_USER } from "../test/mocks";
import { renderWithProviders } from "../test/render";

function LoginProbe({ onFrom }: { onFrom: (from: string | null) => void }) {
  const location = useLocation();
  useEffect(() => {
    onFrom((location.state as { from?: string } | null)?.from ?? null);
  }, [location.state, onFrom]);
  return <div>login page</div>;
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
