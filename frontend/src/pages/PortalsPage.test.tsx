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

  it("reset clears every filter instead of keeping stale ones", async () => {
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

    await user.click(screen.getByLabelText("Состояние"));
    await user.click(await screen.findByText("Закрытые"));
    await waitFor(() => {
      expect(new URL(captured!).searchParams.get("closed")).toBe("true");
    });

    await user.click(screen.getByRole("button", { name: "Сбросить" }));

    await waitFor(() => {
      const params = new URL(captured!).searchParams;
      expect(params.has("closed")).toBe(false);
      expect(params.has("danger_level")).toBe(false);
      expect(params.has("has_observer")).toBe(false);
      expect(params.has("is_marked")).toBe(false);
      expect(params.has("search")).toBe(false);
      expect(params.get("order_by")).toBe("risk");
    });
  });

  it("shows per-row deltas from the previous snapshot", async () => {
    renderWithProviders(<PortalsPage />);
    expect(await screen.findByText("Портал Альфа")).toBeInTheDocument();

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    act(() => socket.open());

    // The second frame of the same snapshot scope: energy +3, stability −20,
    // creatures +1, risk +4 points → four delta badges appear.
    const changed: Portal = {
      ...OPEN_PORTAL,
      energy_level: 85,
      stability: 44,
      creatures_count: 4,
      risk_factor: 0.45,
    };
    act(() => socket.message(JSON.stringify(portalPage([changed, CLOSED_PORTAL], 1, 20))));

    expect(await screen.findByText("+3")).toBeInTheDocument();
    expect(screen.getByText("-20")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
  });

  it("hides risk deltas below the 0.01 magnitude threshold", async () => {
    renderWithProviders(<PortalsPage />);
    expect(await screen.findByText("Портал Альфа")).toBeInTheDocument();

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    act(() => socket.open());

    // Frame 1: energy +2 (the visible «+2» proves the frame was applied) while
    // the risk moved by only +0.004 — below the 0.01 threshold, so no risk
    // badge renders («+0» would appear if the too-small delta were shown).
    const tiny: Portal = { ...OPEN_PORTAL, energy_level: 84, risk_factor: 0.414 };
    act(() => socket.message(JSON.stringify(portalPage([tiny, CLOSED_PORTAL], 1, 20))));
    expect(await screen.findByText("+2")).toBeInTheDocument();
    expect(screen.queryByText("+0")).not.toBeInTheDocument();

    // Frame 2: risk moves by +0.011 — the badge appears in percentage points.
    const notable: Portal = { ...OPEN_PORTAL, energy_level: 84, risk_factor: 0.425 };
    act(() => socket.message(JSON.stringify(portalPage([notable, CLOSED_PORTAL], 1, 20))));
    expect(await screen.findByText("+1")).toBeInTheDocument();
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
    // OPEN_PORTAL carries an observer, so the merged toggle reads «отозвать».
    expect(within(dialog).getByText("Отозвать наблюдателя")).toBeInTheDocument();
  });

  it("refreshes the observer toggle when the portal closes over the socket", async () => {
    const user = userEvent.setup();

    renderWithProviders(<PortalsPage />);
    await user.click(await screen.findByText("Портал Альфа"));
    expect(
      within(await screen.findByRole("dialog")).getByText("Отозвать наблюдателя"),
    ).toBeInTheDocument();

    // The same portal closes (server auto-recalls the observer): the snapshot
    // arrives over WS, and the merged toggle must flip to «отправить».
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    act(() => socket.open());
    const closed: Portal = { ...OPEN_PORTAL, closed: true, has_observer: false };
    act(() => socket.message(JSON.stringify(portalPage([closed, CLOSED_PORTAL], 1, 20))));

    // Cache writes are batched by TanStack Query, so the modal must be awaited
    // with `findBy*` (polling) rather than queried synchronously.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Отправить наблюдателя")).toBeInTheDocument();
    expect(within(dialog).queryByText("Отозвать наблюдателя")).not.toBeInTheDocument();
  });

  it("greys out remaining actions immediately after a successful close", async () => {
    const user = userEvent.setup();
    const closed: Portal = { ...OPEN_PORTAL, closed: true, has_observer: false };
    let listCalls = 0;
    let closedByAction = false;
    server.use(
      // The initial page load sees the open portal; any refetch after the
      // action reflects the server truth (closed).
      http.get(API_URL("/portals"), () => {
        listCalls += 1;
        return HttpResponse.json(
          listCalls === 1 ? portalPage() : portalPage([closed, CLOSED_PORTAL], 1, 20),
        );
      }),
      http.post(API_URL("/portals/:id"), () => {
        closedByAction = true;
        return HttpResponse.json(closed);
      }),
      // The open modal also polls the detail endpoint: open until the action
      // commits, closed from the server truth afterwards.
      http.get(API_URL("/portals/1"), () =>
        HttpResponse.json(closedByAction ? closed : OPEN_PORTAL),
      ),
    );

    renderWithProviders(<PortalsPage />);
    await user.click(await screen.findByText("Портал Альфа"));
    const dialog = await screen.findByRole("dialog");

    const stabilize = within(dialog).getByRole("button", { name: /Стабилизировать/ });
    expect(stabilize).toBeEnabled();

    // Query by visible text, not role — the modal close (X) button picks up
    // the ru_RU aria-label «Закрыть» and would collide with the action button.
    const closeButton = (await within(dialog).findByText("Закрыть")).closest("button");
    expect(closeButton).not.toBeNull();
    await user.click(closeButton!);

    // No snapshot needed: the action response updates the modal's portal copy
    // instantly, so every action except (un)mark greys out right away.
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: /Стабилизировать/ })).toBeDisabled();
    });
    expect(within(dialog).getByRole("button", { name: /Отметить/ })).toBeEnabled();
  });

  it("greys out actions when the portal closes in the background", async () => {
    const user = userEvent.setup();
    const closed: Portal = { ...OPEN_PORTAL, closed: true, has_observer: false };
    // The page snapshot still shows the portal open, but the polled detail
    // endpoint already reports it closed (e.g. it expired in the background).
    // Exact path: a `:id` pattern would also match `/portals/stats`.
    server.use(http.get(API_URL("/portals/1"), () => HttpResponse.json(closed)));

    renderWithProviders(<PortalsPage />);
    await user.click(await screen.findByText("Портал Альфа"));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: /Стабилизировать/ })).toBeDisabled();
    });
    expect(within(dialog).getByRole("button", { name: /Отметить/ })).toBeEnabled();
  });

  it("never flips a closed card back to open on a stale page snapshot", async () => {
    const user = userEvent.setup();
    const closed: Portal = { ...OPEN_PORTAL, closed: true, has_observer: false };
    // Detail already reports the portal closed; the page snapshot below is
    // stale (still open) and must not revive the card.
    server.use(http.get(API_URL("/portals/1"), () => HttpResponse.json(closed)));

    renderWithProviders(<PortalsPage />);
    await user.click(await screen.findByText("Портал Альфа"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: /Стабилизировать/ })).toBeDisabled();
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    act(() => socket.open());
    act(() => socket.message(JSON.stringify(portalPage([OPEN_PORTAL, CLOSED_PORTAL], 1, 20))));

    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: /Стабилизировать/ })).toBeDisabled();
    });
    // The latched closed copy (no observer inside) stays on screen.
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
