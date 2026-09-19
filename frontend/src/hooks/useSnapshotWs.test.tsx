import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PortalPage } from "../api/types";
import { useSnapshotWs, type LiveStatus } from "./useSnapshotWs";
import { FakeWebSocket } from "../test/fakeWs";

function renderProbe(onUnauthorized?: () => void) {
  let captured: PortalPage | null = null;
  const statuses: LiveStatus[] = [];

  function Probe() {
    const status = useSnapshotWs<PortalPage>(
      "ws://localhost:8000/portals/ws?page=1&items_per_page=20",
      (snapshot) => {
        captured = snapshot;
      },
      onUnauthorized,
    );
    statuses.push(status);
    return (
      <div>
        <span data-testid="status">{status}</span>
        <span data-testid="snap">{captured ? captured.total : "none"}</span>
      </div>
    );
  }

  const rendered = render(<Probe />);
  return {
    ...rendered,
    socket: () => fakeSocket(0),
    sockets: () => FakeWebSocket.instances,
    captured: () => captured,
    statuses: () => statuses,
  };
}

function fakeSocket(index: number): FakeWebSocket {
  const socket = FakeWebSocket.instances[index];
  if (!socket) {
    throw new Error(`FakeWebSocket #${index} does not exist`);
  }
  return socket;
}

/**
 * Mount the probe and let the deferred initial connect (a `setTimeout(0)`,
 * scheduled so StrictMode's dev remount cannot abort a handshake) create the
 * socket before the test asserts on `FakeWebSocket.instances`.
 */
function mountProbe(onUnauthorized?: () => void) {
  const probe = renderProbe(onUnauthorized);
  act(() => vi.advanceTimersByTime(0));
  return probe;
}

describe("useSnapshotWs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.install();
  });

  afterEach(() => {
    vi.useRealTimers();
    FakeWebSocket.reset();
  });

  it("connects, reports «open» and applies snapshot frames", () => {
    const probe = mountProbe();
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => fakeSocket(0).open());
    expect(screen.getByTestId("status")).toHaveTextContent("open");

    act(() =>
      fakeSocket(0).message(JSON.stringify({ items: [], page: 1, items_per_page: 20, total: 5 })),
    );
    expect(probe.captured()?.total).toBe(5);
  });

  it("ignores malformed frames", () => {
    mountProbe();
    act(() => fakeSocket(0).open());
    expect(() => act(() => fakeSocket(0).message("not-json"))).not.toThrow();
  });

  it("schedules a reconnect with backoff after an unexpected close", () => {
    mountProbe();
    act(() => fakeSocket(0).open());
    act(() => fakeSocket(0).serverClose(1006));

    expect(screen.getByTestId("status")).toHaveTextContent("reconnecting");
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("stops and reports a 4401 close as unauthorized", () => {
    const onUnauthorized = vi.fn();
    mountProbe(onUnauthorized);
    act(() => fakeSocket(0).serverClose(4401));

    expect(screen.getByTestId("status")).toHaveTextContent("unauthorized");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("treats a close before the handshake completed as an auth failure and keeps retrying", () => {
    // The backend rejects an expired-session handshake with HTTP 403, which
    // browsers surface as close 1006 while the socket never opened.
    const onUnauthorized = vi.fn();
    const probe = mountProbe(onUnauthorized);

    act(() => fakeSocket(0).serverClose(1006));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status")).toHaveTextContent("reconnecting");

    // ...and reconnect continues so a transient backend blip recovers.
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(probe.statuses().at(-1)).toBe("reconnecting");
  });

  it("does not treat a close after a successful open as an auth failure", () => {
    const onUnauthorized = vi.fn();
    mountProbe(onUnauthorized);
    act(() => fakeSocket(0).open());
    act(() => fakeSocket(0).serverClose(1006));

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("closes the socket and clears the retry timer on unmount", () => {
    const { unmount } = mountProbe();
    act(() => fakeSocket(0).open());
    act(() => fakeSocket(0).serverClose(1006));

    unmount();
    expect(fakeSocket(0).closed).toBe(true);

    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
