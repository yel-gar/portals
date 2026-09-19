import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LiveStatusProvider, useReportLiveStatus } from "../live";
import type { LiveStatus } from "../hooks/useSnapshotWs";
import { renderWithProviders } from "../test/render";
import { LiveBadge } from "./LiveBadge";

function LiveStatusWindow({ status }: { status: LiveStatus }) {
  useReportLiveStatus(status);
  return <LiveBadge />;
}

describe("LiveBadge", () => {
  const cases: ReadonlyArray<readonly [LiveStatus, string, string]> = [
    ["open", "Live", "app-live--open"],
    ["connecting", "Подключение", "app-live--connecting"],
    ["reconnecting", "Переподключение", "app-live--reconnecting"],
    ["unauthorized", "Сессия истекла", "app-live--unauthorized"],
  ];

  it.each(cases)("shows %s as %s with class %s", (status, label, className) => {
    renderWithProviders(
      <LiveStatusProvider>
        <LiveStatusWindow status={status} />
      </LiveStatusProvider>,
    );

    expect(screen.getByText(label).className).toContain(className);
  });
});
