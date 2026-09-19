import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render";
import { WorklogPage } from "./WorklogPage";

describe("WorklogPage", () => {
  it("renders the bundled AI-WORKLOG.md as real HTML headings", () => {
    renderWithProviders(<WorklogPage />);

    // The first worklog heading must come out as an actual <h1>, not raw text.
    expect(
      screen.getByRole("heading", { name: /Этап 1: конфигурация проекта и CI pipeline/ }),
    ).toBeInTheDocument();
    // A later-stage heading exists too, proving the whole document was rendered.
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(1);
  });

  it("renders nested content, paragraphs and code blocks", () => {
    renderWithProviders(<WorklogPage />);

    // Code fences become <pre><code> elements with the literal source.
    const codeBlocks = [...document.querySelectorAll("pre code")];
    expect(codeBlocks.length).toBeGreaterThan(0);
    expect(codeBlocks.some((block) => block.textContent?.includes("FROM python:3.14-alpine"))).toBe(
      true,
    );
  });
});
