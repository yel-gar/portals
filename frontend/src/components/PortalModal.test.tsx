import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { PortalModal } from "./PortalModal";
import type { Portal } from "../api/types";
import { API_URL, OPEN_PORTAL, server } from "../test/mocks";
import { renderWithProviders } from "../test/render";

const renderModal = (portal: Portal | null = OPEN_PORTAL, onClose = vi.fn()) =>
  renderWithProviders(<PortalModal portal={portal} onClose={onClose} />);

/**
 * antd Modal mounts its body through an appear animation, so everything inside
 * must be awaited with `findBy*` rather than queried synchronously.
 */
describe("PortalModal", () => {
  it("shows portal data and every action button", async () => {
    renderModal();
    expect(await screen.findByText("Портал Альфа")).toBeInTheDocument();
    expect(screen.getByText("Зеркальная пустошь")).toBeInTheDocument();
    // Danger tag renders in the title and in the descriptions row.
    expect(screen.getAllByText("Средний").length).toBeGreaterThanOrEqual(1);

    for (const label of [
      "Оставить открытым",
      "Стабилизировать",
      "Отправить наблюдателя",
      "Отозвать наблюдателя",
      "Закрыть",
      "Отметить",
      "Предупредить существ"
    ]) {
      // antd prepends the icon's aria-label to the button's accessible name.
      expect(await screen.findByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("flips the mark button label for an already-marked portal", async () => {
    renderModal({ ...OPEN_PORTAL, is_marked: true });
    expect(await screen.findByRole("button", { name: /Снять отметку/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Отметить/ })).not.toBeInTheDocument();
  });

  it("runs an action and reports success", async () => {
    const user = userEvent.setup();
    let requestedAction: string | null = null;
    server.use(
      http.post(API_URL("/portals/:id"), ({ request }) => {
        requestedAction = new URL(request.url).searchParams.get("action");
        return HttpResponse.json(OPEN_PORTAL);
      })
    );

    renderModal();
    await user.click(await screen.findByRole("button", { name: /Стабилизировать/ }));

    expect(requestedAction).toBe("STABILIZE");
    expect(await screen.findByText("Действие «Стабилизировать» выполнено")).toBeInTheDocument();
  });

  it("surfaces the backend's rejection reason verbatim (409)", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(API_URL("/portals/:id"), () =>
        HttpResponse.json({ detail: "Портал уже закрыт" }, { status: 409 })
      )
    );

    renderModal();
    await user.click(await screen.findByRole("button", { name: /Закрыть/ }));

    expect(await screen.findByText("Портал уже закрыт")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    renderModal(null);
    expect(document.body).not.toHaveTextContent("Портал Альфа");
  });
});
