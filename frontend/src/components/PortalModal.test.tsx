import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { PortalModal } from "./PortalModal";
import type { Portal } from "../api/types";
import { API_URL, CLOSED_PORTAL, OPEN_PORTAL, server } from "../test/mocks";
import { renderWithProviders } from "../test/render";

const renderModal = (
  portal: Portal | null = OPEN_PORTAL,
  onClose = vi.fn(),
  onPortalUpdated = vi.fn(),
) =>
  renderWithProviders(
    <PortalModal portal={portal} onClose={onClose} onPortalUpdated={onPortalUpdated} />,
  );

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

    // OPEN_PORTAL has an observer inside, so the merged observer toggle reads
    // «Отозвать наблюдателя»; RECALL_OBSERVER is folded into SEND_OBSERVER.
    const actionLabels = [
      "Оставить открытым",
      "Стабилизировать",
      "Отозвать наблюдателя",
      "Закрыть",
      "Отметить",
      "Предупредить существ",
    ];
    // Query by visible text, not role name: the modal's close (X) button picks
    // up the ru_RU aria-label «Закрыть» and would collide with the action button.
    const buttons = await Promise.all(actionLabels.map((label) => screen.findByText(label)));
    expect(buttons).toHaveLength(actionLabels.length);
    expect(screen.queryByText("Отправить наблюдателя")).not.toBeInTheDocument();
  });

  it("flips the observer toggle label when the portal has no observer", async () => {
    renderModal({ ...OPEN_PORTAL, has_observer: false });
    expect(
      await screen.findByRole("button", { name: /Отправить наблюдателя/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Отозвать наблюдателя/ })).not.toBeInTheDocument();
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
      }),
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
        HttpResponse.json({ detail: "Портал уже закрыт" }, { status: 409 }),
      ),
    );

    renderModal();
    const closeAction = (await screen.findByText("Закрыть")).closest("button");
    expect(closeAction).not.toBeNull();
    await user.click(closeAction!);

    expect(await screen.findByText("Портал уже закрыт")).toBeInTheDocument();
  });

  it("hands the fresh portal back after an action succeeds", async () => {
    const user = userEvent.setup();
    const onPortalUpdated = vi.fn();
    const fresh = { ...OPEN_PORTAL, closed: true, has_observer: false };
    server.use(http.post(API_URL("/portals/:id"), () => HttpResponse.json(fresh)));

    renderModal(OPEN_PORTAL, vi.fn(), onPortalUpdated);
    const closeAction = (await screen.findByText("Закрыть")).closest("button");
    expect(closeAction).not.toBeNull();
    await user.click(closeAction!);

    expect(onPortalUpdated).toHaveBeenCalledTimes(1);
    expect(onPortalUpdated).toHaveBeenCalledWith(fresh);
  });

  it("renders nothing when closed", () => {
    renderModal(null);
    expect(document.body).not.toHaveTextContent("Портал Альфа");
  });

  it("disables every action on a closed portal except mark/unmark", async () => {
    renderModal(CLOSED_PORTAL);

    // CLOSED_PORTAL is marked, so the toggle reads «Снять отметку» and stays enabled.
    expect(await screen.findByRole("button", { name: /Снять отметку/ })).toBeEnabled();
    // The rest are unavailable client-side on a closed portal. Query by visible
    // text, not role: the modal close (X) button picks up the ru_RU aria-label
    // «Закрыть» and would collide with the action button.
    const labels = [
      "Оставить открытым",
      "Стабилизировать",
      "Отправить наблюдателя",
      "Закрыть",
      "Предупредить существ",
    ];
    const found = await Promise.all(labels.map((label) => screen.findByText(label)));
    for (const el of found) {
      const button = el.closest("button");
      expect(button).not.toBeNull();
      expect(button!).toBeDisabled();
    }
  });

  it("highlights the backend-recommended action in purple", async () => {
    // OPEN_PORTAL recommends STABILIZE.
    renderModal();
    const stabilize = (await screen.findByText("Стабилизировать")).closest("button");
    expect(stabilize).not.toBeNull();
    expect(stabilize!.classList.contains("portal-action-recommended")).toBe(true);
    const close = (await screen.findByText("Закрыть")).closest("button");
    expect(close!.classList.contains("portal-action-recommended")).toBe(false);
    expect(await screen.findByText(/Фиолетовая подсветка — рекомендованное/)).toBeInTheDocument();
  });

  it("shows the last portal actions and collapses the history panel", async () => {
    const user = userEvent.setup();
    const entry = {
      id: 9,
      portal_id: OPEN_PORTAL.id,
      action: "MARK" as const,
      timestamp: "2026-09-19T11:50:00Z",
      user: { id: 1, username: "demo", is_superuser: false },
    };
    let captured: string | null = null;
    server.use(
      http.get(API_URL("/portals/log"), ({ request }) => {
        captured = request.url;
        return HttpResponse.json({ items: [entry], page: 1, items_per_page: 5, total: 1 });
      }),
    );

    renderModal();
    expect(await screen.findByText("История портала")).toBeInTheDocument();
    expect(await screen.findByText("Отметить")).toBeInTheDocument();
    const fullHistory = (await screen.findByText("Полная история портала")).closest("a");
    expect(fullHistory).not.toBeNull();
    expect(fullHistory!.getAttribute("href")).toBe(`/log?portal_id=${OPEN_PORTAL.id}`);
    await waitFor(() => {
      expect(new URL(captured!).searchParams.get("portal_id")).toBe(String(OPEN_PORTAL.id));
    });

    await user.click(screen.getByRole("button", { name: /Скрыть историю/ }));
    // jsdom performs no layout, so visibility cannot be asserted — the open
    // state is pinned on the panel's modifier class and the toggle label.
    const panel = () => document.querySelector(".portal-history");
    await waitFor(() => expect(panel()).toHaveClass("portal-history--closed"));
    expect(screen.queryByRole("button", { name: /Скрыть историю/ })).not.toBeInTheDocument();
    // The toggle carries the icon's accessible name too ("history История"),
    // so match by substring rather than by exact name.
    await user.click(screen.getByRole("button", { name: /История/ }));
    await waitFor(() => expect(panel()).toHaveClass("portal-history--open"));
    expect(screen.getByRole("button", { name: /Скрыть историю/ })).toBeInTheDocument();
  });

  it("asks for confirmation before force-closing a critical portal with creatures", async () => {
    const user = userEvent.setup();
    let requestedUrl: string | null = null;
    server.use(
      http.post(API_URL("/portals/:id"), ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(OPEN_PORTAL);
      }),
    );

    renderModal({ ...OPEN_PORTAL, danger_level: "CRITICAL", creatures_count: 5 });
    const closeAction = (await screen.findByText("Закрыть")).closest("button");
    expect(closeAction).not.toBeNull();
    await user.click(closeAction!);

    // The confirm title is rendered twice by antd (dialog + confirm title
    // nodes share the text), so assert on the unique body copy instead.
    expect(await screen.findByText(/Внутри портала есть существа/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Закрыть принудительно" }));

    await waitFor(() => {
      const params = new URL(requestedUrl!).searchParams;
      expect(params.get("action")).toBe("CLOSE");
      expect(params.get("force")).toBe("true");
    });
  });

  it("sends a plain close without confirmation on a non-critical portal", async () => {
    const user = userEvent.setup();
    let requestedUrl: string | null = null;
    server.use(
      http.post(API_URL("/portals/:id"), ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(OPEN_PORTAL);
      }),
    );

    renderModal();
    const closeAction = (await screen.findByText("Закрыть")).closest("button");
    expect(closeAction).not.toBeNull();
    await user.click(closeAction!);

    await waitFor(() => {
      const params = new URL(requestedUrl!).searchParams;
      expect(params.get("action")).toBe("CLOSE");
      expect(params.has("force")).toBe(false);
    });
    expect(screen.queryByText("Принудительно закрыть портал?")).not.toBeInTheDocument();
  });
});
