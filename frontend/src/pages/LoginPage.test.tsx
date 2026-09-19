import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";

import { DEMO_USER, API_URL, server } from "../test/mocks";
import { renderWithProviders } from "../test/render";
import { LoginPage } from "./LoginPage";

const renderLogin = () =>
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/portals" element={<div>portals-stub</div>} />
    </Routes>,
    { initialEntries: ["/login"] },
  );

describe("LoginPage", () => {
  it("logs in and navigates to the portals page", async () => {
    const user = userEvent.setup();
    let body: unknown = null;
    server.use(
      http.post(API_URL("/auth/login"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(DEMO_USER);
      }),
    );

    renderLogin();
    await user.type(screen.getByLabelText("Имя пользователя"), "demo");
    await user.type(screen.getByLabelText("Пароль"), "demo-password-1");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(await screen.findByText("portals-stub")).toBeInTheDocument();
    expect(body).toEqual({ username: "demo", password: "demo-password-1" });
  });

  it("shows the backend rejection message on bad credentials", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(API_URL("/auth/login"), () =>
        HttpResponse.json({ detail: "Неверное имя пользователя или пароль" }, { status: 401 }),
      ),
    );

    renderLogin();
    await user.type(screen.getByLabelText("Имя пользователя"), "demo");
    await user.type(screen.getByLabelText("Пароль"), "wrong");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(await screen.findByText("Неверное имя пользователя или пароль")).toBeInTheDocument();
  });

  it("refuses to submit until fields are filled", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    server.use(
      http.post(API_URL("/auth/login"), async ({ request }) => {
        submit();
        await request.json();
        return HttpResponse.json(DEMO_USER);
      }),
    );

    renderLogin();
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(submit).not.toHaveBeenCalled();
    expect(await screen.findByText("Введите имя пользователя")).toBeInTheDocument();
    expect(await screen.findByText("Введите пароль")).toBeInTheDocument();
  });
});
