import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Stats } from "../api/types";
import { renderWithProviders } from "../test/render";
import { StatCards } from "./StatCards";

const CURRENT: Stats = {
  total: 5,
  open: 3,
  closed: 2,
  marked: 1,
  with_observer: 2,
  danger_levels: { LOW: 1, MEDIUM: 1, HIGH: 0, CRITICAL: 1 },
  avg_risk: 0.61,
};

const PREV: Stats = {
  total: 4,
  open: 2,
  closed: 2,
  marked: 1,
  with_observer: 1,
  danger_levels: { LOW: 1, MEDIUM: 0, HIGH: 0, CRITICAL: 1 },
  avg_risk: 0.58,
};

describe("StatCards", () => {
  it("shows signed deltas against the previous stats snapshot", () => {
    renderWithProviders(<StatCards stats={CURRENT} prevStats={PREV} />);

    // closed and marked stay), so exactly three cards gain +1: total, open,
    // with-observer.
    expect(screen.getAllByText("+1")).toHaveLength(3);
    // avg risk grew by 0.03, formatted with the sign and two decimals.
    expect(screen.getByText("+0.03")).toBeInTheDocument();
  });

  it("hides the delta badge for unchanged values", () => {
    renderWithProviders(<StatCards stats={CURRENT} prevStats={CURRENT} />);
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
    expect(screen.queryByText("+0.03")).not.toBeInTheDocument();
  });

  it("renders no deltas without a previous snapshot", () => {
    renderWithProviders(<StatCards stats={CURRENT} />);
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
    expect(screen.queryByText("+0.03")).not.toBeInTheDocument();
  });

  it("hides the avg-risk delta when its magnitude is below 0.01", () => {
    // avg risk 0.61 → 0.613 is a 0.003 change: below the 0.01 threshold, and
    // the other metrics are unchanged, so no delta badge renders at all.
    renderWithProviders(
      <StatCards
        stats={{ ...CURRENT, avg_risk: 0.613 }}
        prevStats={{ ...CURRENT, avg_risk: 0.61 }}
      />,
    );
    expect(screen.queryByLabelText("delta")).not.toBeInTheDocument();
  });

  it("shows the avg-risk delta at exactly 0.01", () => {
    renderWithProviders(
      <StatCards
        stats={{ ...CURRENT, avg_risk: 0.62 }}
        prevStats={{ ...CURRENT, avg_risk: 0.61 }}
      />,
    );
    expect(screen.getByLabelText("delta")).toBeInTheDocument();
    expect(screen.getByText("+0.01")).toBeInTheDocument();
  });
});
