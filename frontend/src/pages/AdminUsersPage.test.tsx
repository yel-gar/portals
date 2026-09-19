import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { DEMO_USER, API_URL, server, SUPER_USER } from "../test/mocks";
import { renderWithProviders } from "../test/render";
import { AdminUsersPage } from "./AdminUsersPage";

const renderAdmin = () => renderWithProviders(<AdminUsersPage />);

describe("AdminUsersPage", () => {
  it("lists users with their roles", async () => {
    server.use(http.get(API_URL("/admin/users"), () => HttpResponse.json([DEMO_USER, SUPER_USER])));

    renderAdmin();
    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("Суперпользователь")).toBeInTheDocument();
    expect(screen.getByText("Оператор")).toBeInTheDocument();
  });

  it("creates a user through the modal", async () => {
    const user = userEvent.setup();
    const users = [DEMO_USER];
    server.use(
      http.get(API_URL("/admin/users"), () => HttpResponse.json(users)),
      http.post(API_URL("/admin/users"), async ({ request }) => {
        const body = (await request.json()) as { username: string };
        const created = { ...DEMO_USER, id: 5, username: body.username };
        users.push(created);
        return HttpResponse.json(created, { status: 201 });
      })
    );

    renderAdmin();
    await user.click(screen.getByRole("button", { name: /Создать пользователя/ }));

    const dialog = await screen.findByRole("dialog");
    await user.type(await within(dialog).findByLabelText("Имя пользователя"), "newbie");
    await user.type(within(dialog).getByLabelText("Пароль"), "newbie-pass-1");
    await user.click(within(dialog).getByRole("button", { name: /Создать/ }));

    expect(await screen.findByText("Пользователь «newbie» создан")).toBeInTheDocument();
    expect(await screen.findByText("newbie")).toBeInTheDocument();
  });

  it("deletes a user after confirmation", async () => {
    const user = userEvent.setup();
    let deletedId: number | null = null;
    server.use(
      http.get(API_URL("/admin/users"), () => HttpResponse.json([DEMO_USER, SUPER_USER])),
      http.delete(API_URL("/admin/users/:id"), ({ params }) => {
        deletedId = Number(params.id);
        return new HttpResponse(null, { status: 204 });
      })
    );

    renderAdmin();
    await screen.findByText("demo");

    const demoRow = screen.getByText("demo").closest("tr");
    expect(demoRow).not.toBeNull();
    await user.click(within(demoRow as HTMLElement).getByRole("button", { name: /Удалить/ }));

    const confirm = await screen.findByRole("tooltip");
    await user.click(within(confirm).getByRole("button", { name: "Удалить" }));

    expect(await screen.findByText("Пользователь удалён")).toBeInTheDocument();
    expect(deletedId).toBe(1);
  });
});
