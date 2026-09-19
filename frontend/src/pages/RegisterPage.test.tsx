import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";

import { DEMO_USER, API_URL, server } from "../test/mocks";
import { renderWithProviders } from "../test/render";
import { RegisterPage } from "./RegisterPage";

const renderRegister = () =>
  renderWithProviders(
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/portals" element={<div>portals-stub</div>} />
    </Routes>,
    { initialEntries: ["/register"] }
  );

describe("RegisterPage", () => {
  it("registers, logs straight in and lands on the portals page", async () => {
    const user = userEvent.setup();
    let registerBody: unknown = null;
    server.use(
      http.post(API_URL("/auth/register"), async ({ request }) => {
        registerBody = await request.json();
        return HttpResponse.json(DEMO_USER, { status: 201 });
      })
    );

    renderRegister();
    await user.type(screen.getByLabelText("Имя пользователя"), "operator");
    await user.type(screen.getByLabelText("Пароль"), "operator-pass-1");
    await user.click(screen.getByRole("button", { name: "Зарегистрироваться" }));

    expect(await screen.findByText("portals-stub")).toBeInTheDocument();
    expect(registerBody).toEqual({ username: "operator", password: "operator-pass-1" });
  });

  it("shows a 409 conflict detail from the server", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(API_URL("/auth/register"), () =>
        HttpResponse.json({ detail: "Пользователь с таким именем уже существует" }, { status: 409 })
      )
    );

    renderRegister();
    await user.type(screen.getByLabelText("Имя пользователя"), "demo");
    await user.type(screen.getByLabelText("Пароль"), "some-password-1");
    await user.click(screen.getByRole("button", { name: "Зарегистрироваться" }));

    expect(await screen.findByText("Пользователь с таким именем уже существует")).toBeInTheDocument();
  });
});
