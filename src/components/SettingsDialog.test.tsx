import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";

describe("SettingsDialog themes", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
  });

  it("shows light and dark choices and reports a theme change", () => {
    const onSelectTheme = vi.fn(async () => undefined);
    render(
      <SettingsDialog
        open
        selectedModel="gemini-3.5-flash-lite"
        theme="light"
        onClose={vi.fn()}
        onSelectModel={vi.fn(async () => undefined)}
        onSelectTheme={onSelectTheme}
      />
    );

    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onSelectTheme).toHaveBeenCalledWith("dark");
  });
});
