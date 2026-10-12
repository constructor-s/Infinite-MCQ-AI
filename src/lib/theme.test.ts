import { afterEach, describe, expect, it, vi } from "vitest";
import { activateTheme, getStoredTheme, normalizeTheme, resolveTheme } from "./theme";

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mediaQuery = {
    get matches() { return matches; },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
  return {
    mediaQuery,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("theme", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("defaults missing and invalid preferences to auto", () => {
    expect(normalizeTheme(undefined)).toBe("auto");
    localStorage.setItem("iworld-theme", "unknown");
    expect(getStoredTheme()).toBe("auto");
  });

  it("resolves auto using the operating-system preference", () => {
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("auto", true)).toBe("dark");
  });

  it("updates auto when the operating-system preference changes", () => {
    const media = mockMatchMedia(false);
    const deactivate = activateTheme("auto");
    expect(document.documentElement.dataset.theme).toBe("light");

    media.setMatches(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    deactivate();
    expect(media.mediaQuery.removeEventListener).toHaveBeenCalledOnce();
  });

  it.each(["light", "dark"] as const)("keeps an explicit %s preference fixed", (theme) => {
    const media = mockMatchMedia(theme === "light");
    activateTheme(theme);
    expect(document.documentElement.dataset.theme).toBe(theme);

    media.setMatches(theme !== "light");
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(media.mediaQuery.addEventListener).not.toHaveBeenCalled();
  });
});
