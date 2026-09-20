import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { FirePanels, getFireDebug } from "./FirePanels";

describe("FirePanels debug probe", () => {
  it("exposes a live snapshot on window for console diagnosis", () => {
    renderWithProviders(<FirePanels />);
    const snapshot = getFireDebug();
    expect(snapshot).not.toBeNull();
    expect(["static", "webgpu", "ember"]).toContain(snapshot?.requested);
    expect(typeof snapshot?.frames).toBe("number");
    const exposed = (window as unknown as { fireDebug?: typeof getFireDebug }).fireDebug;
    expect(exposed).toBe(getFireDebug);
    expect(exposed?.()).toEqual(snapshot);
  });
});
