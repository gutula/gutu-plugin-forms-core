import { describe, expect, it } from "bun:test";
import { uiSurface } from "../../src/ui/surfaces";

describe("ui surface registration", () => {
  it("registers a single admin embedded page", () => {
    expect(uiSurface.embeddedPages).toHaveLength(1);
    expect(uiSurface.embeddedPages[0]?.route).toBe("/admin/forms-core");
  });
});