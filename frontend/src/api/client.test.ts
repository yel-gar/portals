import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { ApiError, detailToMessage, request, websocketUrl } from "./client";
import { API_URL, server } from "../test/mocks";

describe("detailToMessage", () => {
  it("passes through non-empty strings", () => {
    expect(detailToMessage("Портал уже закрыт", "fallback")).toBe("Портал уже закрыт");
    expect(detailToMessage("", "fallback")).toBe("fallback");
  });

  it("joins 422 validation errors with their field paths", () => {
    const detail = [
      { loc: ["body", "password"], msg: "String should have at least 8 characters", type: "string_too_short" },
      { loc: ["body"], msg: "Какое-то поле обязано быть", type: "missing" }
    ];
    expect(detailToMessage(detail, "fallback")).toBe(
      "body.password: String should have at least 8 characters; body: Какое-то поле обязано быть"
    );
  });

  it("falls back for unknown shapes", () => {
    expect(detailToMessage({ weird: true }, "fallback")).toBe("fallback");
    expect(detailToMessage(null, "fallback")).toBe("fallback");
  });
});

describe("request", () => {
  it("resolves JSON bodies and sends cookies", async () => {
    let sawCredentials: RequestCredentials | null = null;
    server.use(
      http.get(API_URL("/portals"), ({ request }) => {
        sawCredentials = request.credentials;
        return HttpResponse.json({ items: [], page: 1, items_per_page: 20, total: 0 });
      })
    );

    const body = await request<{ total: number }>("/portals");
    expect(body.total).toBe(0);
    expect(sawCredentials).toBe("include");
  });

  it("serializes query parameters and drops empty ones", async () => {
    let captured: string | null = null;
    server.use(
      http.get(API_URL("/portals"), ({ request }) => {
        captured = request.url;
        return HttpResponse.json({});
      })
    );
    await request("/portals", { query: { page: 2, items_per_page: 20, filter: undefined } });
    expect(captured).toContain("page=2");
    expect(captured).toContain("items_per_page=20");
    expect(captured).not.toContain("filter");
  });

  it("throws ApiError with the Russian detail", async () => {
    server.use(
      http.post(API_URL("/portals/7"), () => HttpResponse.json({ detail: "Действие недопустимо" }, { status: 409 }))
    );
    const error = await request("/portals/7", { method: "POST", query: { action: "CLOSE" }, body: {} }).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.status).toBe(409);
      expect(error.message).toBe("Действие недопустимо");
    }
  });

  it("renders a readable message for plain status text without a JSON body", async () => {
    server.use(
      http.get(API_URL("/portals"), () => new HttpResponse(null, { status: 500, statusText: "Internal Server Error" }))
    );
    const error = await request("/portals").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.message).toBe("Internal Server Error");
    }
  });

  it("returns undefined for 204", async () => {
    server.use(http.post(API_URL("/auth/logout"), () => new HttpResponse(null, { status: 204 })));
    const result = await request<void>("/auth/logout", { method: "POST" });
    expect(result).toBeUndefined();
  });
});

describe("websocketUrl", () => {
  it("upgrades http to ws preserving path and query", () => {
    expect(websocketUrl("/portals/ws", { page: 1, items_per_page: 20 })).toBe(
      "ws://localhost:8000/portals/ws?page=1&items_per_page=20"
    );
  });
});
