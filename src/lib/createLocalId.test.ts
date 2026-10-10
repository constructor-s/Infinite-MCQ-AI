import { describe, expect, it, vi } from "vitest";
import { createLocalId } from "./createLocalId";

describe("createLocalId", () => {
  it("uses randomUUID when the browser exposes it", () => {
    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    expect(createLocalId({ randomUUID })).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("creates a valid UUID when randomUUID is unavailable on LAN HTTP", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(17);
      return bytes;
    });
    const id = createLocalId({ getRandomValues });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
});
