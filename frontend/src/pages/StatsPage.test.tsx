import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { StatsPage } from "./StatsPage";
import { API_URL, server } from "../test/mocks";
import { renderWithProviders } from "../test/render";

describe("StatsPage", () => {
  it("renders stat cards, the danger distribution and the average risk", async () => {
    renderWithProviders(<StatsPage />);

    expect(await screen.findByText("Всего порталов")).toBeInTheDocument();
    expect(screen.getByText("Открыто")).toBeInTheDocument();
    expect(screen.getByText("Средний риск")).toBeInTheDocument();
    expect(screen.getByText("Распределение по уровню опасности")).toBeInTheDocument();
    expect(screen.getByText("Средний риск по лаборатории")).toBeInTheDocument();
    // MOCK_STATS: one open portal, one MEDIUM level → 1 шт · 100%.
    expect(screen.getByText("1 шт · 100%")).toBeInTheDocument();
    // avg_risk 0.41 shows in the "Средний риск" stat card and the circle.
    expect(screen.getAllByText("0.41").length).toBeGreaterThan(0);
  });

  it("shows a skeleton while the stats are loading", () => {
    server.use(http.get(API_URL("/portals/stats"), () => new Promise<never>(() => {})));

    renderWithProviders(<StatsPage />);

    expect(document.querySelector(".ant-skeleton")).not.toBeNull();
  });

  it("shows an error alert when the stats request fails", async () => {
    server.use(
      http.get(API_URL("/portals/stats"), () =>
        HttpResponse.json({ detail: "Статистика недоступна" }, { status: 500 }),
      ),
    );

    renderWithProviders(<StatsPage />);

    expect(await screen.findByText("Не удалось загрузить статистику")).toBeInTheDocument();
  });
});
