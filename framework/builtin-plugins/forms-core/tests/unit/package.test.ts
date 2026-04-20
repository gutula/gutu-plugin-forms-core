import { describe, expect, it } from "bun:test";
import manifest from "../../package";

describe("plugin manifest", () => {
  it("keeps a stable package id and primary capability", () => {
    expect(manifest.id).toBe("forms-core");
    expect(manifest.providesCapabilities).toContain("forms.submissions");
  });
});