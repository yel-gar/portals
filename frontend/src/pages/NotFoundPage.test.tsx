import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotFoundPage } from "./NotFoundPage";
import { renderWithProviders } from "../test/render";

describe("NotFoundPage", () => {
  it("renders the 404 result with a link back to the portals", () => {
    renderWithProviders(<NotFoundPage />);

    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("Страница не найдена.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "К порталам" });
    expect(link.getAttribute("href")).toBe("/portals");
  });
});
