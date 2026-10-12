import type { Theme } from "./contracts";

export type ResolvedTheme = Exclude<Theme, "auto">;

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

export function normalizeTheme(value: unknown): Theme {
  return value === "light" || value === "dark" || value === "auto" ? value : "auto";
}

export function getStoredTheme(): Theme {
  try {
    return normalizeTheme(localStorage.getItem("iworld-theme"));
  } catch {
    return "auto";
  }
}

export function resolveTheme(theme: Theme, matchesDark = window.matchMedia(DARK_MODE_QUERY).matches): ResolvedTheme {
  return theme === "auto" ? (matchesDark ? "dark" : "light") : theme;
}

export function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111111" : "#ffffff");
}

export function activateTheme(theme: Theme): () => void {
  const mediaQuery = window.matchMedia(DARK_MODE_QUERY);
  const update = () => applyTheme(resolveTheme(theme, mediaQuery.matches));

  update();
  if (theme !== "auto") return () => undefined;

  mediaQuery.addEventListener("change", update);
  return () => mediaQuery.removeEventListener("change", update);
}
