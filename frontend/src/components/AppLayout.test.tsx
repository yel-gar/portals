import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { AppLayout } from "./AppLayout";
import { API_URL, DEMO_USER, server, SUPER_USER } from "../test/mocks";
import { renderWithProviders } from "../test/render";

const layoutRoutes = (
  <Routes>
    <Route path="/login" element={<div>login page</div>} />
    <Route path="*" element={<AppLayout />} />
  </Routes>
);

const renderLayout = () => renderWithProviders(<AppLayout />, { routes: layoutRoutes });

describe("AppLayout", () => {
  it("renders navigation, the current page title and an empty userbox without a session", async () => {
    renderLayout();

    expect((await screen.findAllByText("Порталы")).length).toBeGreaterThan(0);
    expect(screen.getByText("Журнал действий")).toBeInTheDocument();
    expect(screen.getByText("Статистика")).toBeInTheDocument();
    expect(screen.getByText("Журнал разработки")).toBeInTheDocument();
    expect(screen.queryByText("Администрирование")).not.toBeInTheDocument();
    expect(
      screen.getByText("Живая таблица лаборатории — обновляется по WebSocket"),
    ).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Оператор")).toBeInTheDocument();
  });

  it("renders the decorative fire panels behind the content", () => {
    const { container } = renderLayout();

    expect(container.querySelector(".fire-panels")).not.toBeNull();
    const panels = container.querySelectorAll(".fire-panel");
    expect(panels).toHaveLength(2);
    for (const panel of panels) {
      expect(panel.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("shows the admin section and the superuser role for admins", async () => {
    server.use(http.get(API_URL("/auth/me"), () => HttpResponse.json(SUPER_USER)));

    renderLayout();

    expect(await screen.findByText("Администрирование")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("Суперпользователь")).toBeInTheDocument();
  });

  it("shows the operator role for regular users", async () => {
    server.use(http.get(API_URL("/auth/me"), () => HttpResponse.json(DEMO_USER)));

    renderLayout();

    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(screen.getByText("Оператор")).toBeInTheDocument();
    expect(screen.queryByText("Администрирование")).not.toBeInTheDocument();
  });

  it("logs out and navigates back to the login page", async () => {
    const user = userEvent.setup();
    server.use(http.get(API_URL("/auth/me"), () => HttpResponse.json(DEMO_USER)));

    renderLayout();
    await user.click(await screen.findByRole("button", { name: /Выйти/ }));

    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(screen.getByText("Вы вышли из системы")).toBeInTheDocument();
  });

  it("shows an error message when logout fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(API_URL("/auth/me"), () => HttpResponse.json(DEMO_USER)),
      http.post(API_URL("/auth/logout"), () =>
        HttpResponse.json({ detail: "Сессия уже завершена" }, { status: 400 }),
      ),
    );

    renderLayout();
    await user.click(await screen.findByRole("button", { name: /Выйти/ }));

    expect(await screen.findByText("Не удалось завершить сессию")).toBeInTheDocument();
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
  });

  it("runs the refresh handler from the header", async () => {
    const user = userEvent.setup();
    server.use(http.get(API_URL("/auth/me"), () => HttpResponse.json(DEMO_USER)));

    renderLayout();
    await user.click(await screen.findByRole("button", { name: /Обновить/ }));

    // The handler fires without error; the header stays put.
    expect(
      screen.getByText("Живая таблица лаборатории — обновляется по WebSocket"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Обновить/ })).toBeInTheDocument();
  });
});
