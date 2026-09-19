import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { PortalsPage } from "./PortalsPage";
import type { Portal } from "../api/types";
import { API_URL, OPEN_PORTAL, portalPage, server } from "../test/mocks";
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

    const gamma: Portal = { ...OPEN_PORTAL, id: 9, name: "Портал Гамма", risk_factor: 0.9, danger_level: "CRITICAL" };
    act(() => socket.message(JSON.stringify(portalPage([gamma], 1, 20))));

    // Atomic replacement: the new page snapshot wins, the old rows are gone.
    expect(await screen.findByText("Портал Гамма")).toBeInTheDocument();
    expect(screen.queryByText("Портал Альфа")).not.toBeInTheDocument();
    expect(screen.queryByText("Портал Бета")).not.toBeInTheDocument();
  });

  it("shows an error banner when the portals request fails", async () => {
    server.use(http.get(API_URL("/portals"), () => HttpResponse.json({ detail: "Сервер сломался" }, { status: 500 })));

    renderWithProviders(<PortalsPage />);
    expect(await screen.findByText("Не удалось загрузить порталы")).toBeInTheDocument();
  });
});
