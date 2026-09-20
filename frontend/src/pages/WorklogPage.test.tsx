import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../test/render";
import { server } from "../test/mocks";
import { WorklogPage } from "./WorklogPage";

describe("WorklogPage", () => {
  it("fetches AI-WORKLOG.md from the frontend origin and renders real HTML headings", async () => {
    renderWithProviders(<WorklogPage />);

    // The first worklog heading must come out as an actual <h1>, not raw text.
    expect(
      await screen.findByRole("heading", { name: /Этап 1: конфигурация проекта и CI pipeline/ }),
    ).toBeInTheDocument();
    // A later-stage heading exists too, proving the whole document was rendered.
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(1);
  });

  it("renders paragraphs and syntax-highlighted code blocks", async () => {
    renderWithProviders(<WorklogPage />);

    expect(await screen.findByText("Абзац о настройке CI-пайплайна.")).toBeInTheDocument();

    // The python fence is tokenized by rehype-highlight: the <pre><code>
    // pairs carry the `.hljs` class and contain colored token spans.
    const codeBlocks = [...document.querySelectorAll("pre code.hljs")];
    expect(codeBlocks.length).toBeGreaterThan(0);
    expect(codeBlocks.some((block) => block.textContent?.includes('return "world"'))).toBe(true);
    expect(codeBlocks[0].querySelectorAll("span[class^='hljs-']").length).toBeGreaterThan(0);
  });

  it("shows a retryable error state when the file cannot be loaded", async () => {
    server.use(http.get("*/AI-WORKLOG.md", () => HttpResponse.json(null, { status: 404 })));
    renderWithProviders(<WorklogPage />);

    expect(await screen.findByText("Не удалось загрузить журнал")).toBeInTheDocument();
    // Regex: the button's icon contributes «reload» to the accessible name.
    expect(screen.getByRole("button", { name: /Повторить/ })).toBeInTheDocument();
  });
});
