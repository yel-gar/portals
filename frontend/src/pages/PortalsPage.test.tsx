import { act, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import userEvent from "@testing-library/user-event";

import { PortalsPage } from "./PortalsPage";
import type { Portal } from "../api/types";
import { API_URL, CLOSED_PORTAL, OPEN_PORTAL, portalPage, server } from "../test/mocks";
import { FakeWebSocket } from "../test/fakeWs";
import { renderWithProviders } from "../test/render";

describe("PortalsPage", () => {
  beforeEach(() => FakeWebSocket.install());
  afterEach(() => FakeWebSocket.reset());

  it("renders stat cards and the portal table from REST data", async () => {
    renderWithProviders(<PortalsPage />);

    expect(await screen.findByText("Портал Альфа")).toBeInTheDocument();
    expect(screen.getByText("Портал Бета")).toBeInTheDocument();
    expect(screen.getByText("Всего порталов")).toBeInTheDocument();
  });

  it("replaces the whole table when a WebSocket snapshot arrives", async () => {
    renderWithProviders(<PortalsPage />);
    expect(await screen.findByText("Портал Альфа")).toBeInTheDocument();
    expect(screen.getByText("Портал Бета")).toBeInTheDocument();

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    act(() => socket.open());

    const gamma: Portal = {
      ...OPEN_PORTAL,
      id: 9,
      name: "Портал Гамма",
      risk_factor: 0.9,
      danger_level: "CRITICAL",
    };
    act(() => socket.message(JSON.stringify(portalPage([gamma], 1, 20))));

    // Atomic replacement: the new page snapshot wins, the old rows are gone.
    expect(await screen.findByText("Портал Гамма")).toBeInTheDocument();
    expect(screen.queryByText("Портал Альфа")).not.toBeInTheDocument();
    expect(screen.queryByText("Портал Бета")).not.toBeInTheDocument();
  });

  it("shows the marked badge only on marked portals", async () => {
    renderWithProviders(<PortalsPage />);
    expect(await screen.findByText("Портал Альфа")).toBeInTheDocument();

    // CLOSED_PORTAL (is_marked: true) carries the badge; OPEN_PORTAL does not.
    const alphaRow = screen.getByText("Портал Альфа").closest("tr");
    const betaRow = screen.getByText("Портал Бета").closest("tr");
    expect(betaRow).not.toBeNull();
    expect(alphaRow).not.toBeNull();
    expect(within(betaRow!).getByText("Отмечено")).toBeInTheDocument();
    expect(within(alphaRow!).queryByText("Отмечено")).not.toBeInTheDocument();
  });

  it("shows an error banner when the portals request fails", async () => {
    server.use(
      http.get(API_URL("/portals"), () =>
        HttpResponse.json({ detail: "Сервер сломался" }, { status: 500 }),
      ),
    );

    renderWithProviders(<PortalsPage />);
    expect(await screen.findByText("Не удалось загрузить порталы")).toBeInTheDocument();
  });

  it("passes the chosen sort order to the backend instead of sorting client-side", async () => {
    const user = userEvent.setup();
    let captured: string | null = null;
    server.use(
      http.get(API_URL("/portals"), ({ request }) => {
        captured = request.url;
        return HttpResponse.json(portalPage());
      }),
    );

    renderWithProviders(<PortalsPage />);
    await screen.findByText("Портал Альфа");

    await user.click(screen.getByLabelText("Сортировка"));
    await user.click(await screen.findByText("По алфавиту"));

    await waitFor(() => {
      expect(new URL(captured!).searchParams.get("order_by")).toBe("name");
    });
  });

  it("sends the search text to the backend on submit", async () => {
    const user = userEvent.setup();
    let captured: string | null = null;
    server.use(
      http.get(API_URL("/portals"), ({ request }) => {
        captured = request.url;
        return HttpResponse.json(portalPage());
      }),
    );

    renderWithProviders(<PortalsPage />);
    await screen.findByText("Портал Альфа");

    await user.type(screen.getByPlaceholderText("Поиск: название или мир"), "альф{Enter}");

    await waitFor(() => {
      expect(new URL(captured!).searchParams.get("search")).toBe("альф");
    });
  });

  it("opens the portal modal when a row is clicked", async () => {
    const user = userEvent.setup();

    renderWithProviders(<PortalsPage />);
    await user.click(await screen.findByText("Портал Альфа"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Портал Альфа")).toBeInTheDocument();
  });

  it("keeps the modal open when the portal drops off the visible page", async () => {
    const user = userEvent.setup();

    renderWithProviders(<PortalsPage />);
    await user.click(await screen.findByText("Портал Альфа"));
    expect(within(await screen.findByRole("dialog")).getByText("Портал Альфа")).toBeInTheDocument();

    // The next WS frame reorders the page (risk-DESC) and the opened portal is
    // no longer among the visible items — the modal must survive, not unmount.
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    act(() => socket.open());
    act(() => socket.message(JSON.stringify(portalPage([CLOSED_PORTAL], 1, 20))));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Портал Альфа")).toBeInTheDocument();
    expect(within(dialog).getByText("Отправить наблюдателя")).toBeInTheDocument();
  });

  it("keeps the modal open when a filter change empties the page", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(API_URL("/portals"), ({ request }) => {
        const hasSearch = new URL(request.url).searchParams.has("search");
        return HttpResponse.json(
          hasSearch ? { items: [], page: 1, items_per_page: 20, total: 0 } : portalPage(),
        );
      }),
    );

    renderWithProviders(<PortalsPage />);
    await user.click(await screen.findByText("Портал Альфа"));
    expect(within(await screen.findByRole("dialog")).getByText("Портал Альфа")).toBeInTheDocument();

    // A search that matches nothing empties the whole page snapshot — the open
    // modal must stay on screen, not unmount.
    await user.type(screen.getByPlaceholderText("Поиск: название или мир"), "nope{Enter}");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Портал Альфа")).toBeInTheDocument();
    expect(screen.queryByText("Портал Бета")).not.toBeInTheDocument();
  });

  it("applies pagination changes to the backend query", async () => {
    const user = userEvent.setup();
    let captured: string | null = null;
    server.use(
      http.get(API_URL("/portals"), ({ request }) => {
        captured = request.url;
        return HttpResponse.json(portalPage());
      }),
    );

    renderWithProviders(<PortalsPage />);
    await screen.findByText("Портал Альфа");

    // Locale-agnostic: open the size-changer select in the pagination options,
    // then pick the option whose value parses to 10.
    const sizeSelect = document.querySelector(".ant-pagination-options .ant-select");
    expect(sizeSelect).not.toBeNull();
    await user.click(sizeSelect as HTMLElement);

    const option = [...document.querySelectorAll(".ant-select-item-option")].find(
      (el) => parseInt(el.getAttribute("title") ?? "", 10) === 10,
    );
    expect(option).toBeDefined();
    await user.click(option as HTMLElement);

    await waitFor(() => {
      expect(new URL(captured!).searchParams.get("items_per_page")).toBe("10");
    });
  });
});
