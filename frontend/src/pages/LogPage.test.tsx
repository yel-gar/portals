import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { LogPage } from "./LogPage";
import { API_URL, server } from "../test/mocks";
import { FakeWebSocket } from "../test/fakeWs";
import { renderWithProviders } from "../test/render";

describe("LogPage", () => {
  beforeEach(() => FakeWebSocket.install());
  afterEach(() => FakeWebSocket.reset());

  it("renders the recent actions from the backend", async () => {
    const entry = {
      id: 7,
      portal_id: 3,
      action: "STABILIZE" as const,
      timestamp: "2026-09-19T11:50:00Z",
      user: { id: 1, username: "demo", is_superuser: false }
    };
    server.use(
      http.get(API_URL("/portals/log"), () =>
        HttpResponse.json({ items: [entry], page: 1, items_per_page: 20, total: 1 })
      )
    );

    renderWithProviders(<LogPage />);
    expect(await screen.findByText("Стабилизировать")).toBeInTheDocument();
  });

  it("passes the chosen action filter to the backend", async () => {
    const user = userEvent.setup();
    let captured: string | null = null;
    server.use(
      http.get(API_URL("/portals/log"), ({ request }) => {
        captured = request.url;
        return HttpResponse.json({ items: [], page: 1, items_per_page: 20, total: 0 });
      })
    );

    renderWithProviders(<LogPage />);
    await screen.findByTestId("log-filters");

    await user.click(screen.getByLabelText("Действие"));
    await user.click(await screen.findByText("Закрыть"));

    await waitFor(() => {
      expect(new URL(captured!).searchParams.get("action")).toBe("CLOSE");
    });
  });
});
