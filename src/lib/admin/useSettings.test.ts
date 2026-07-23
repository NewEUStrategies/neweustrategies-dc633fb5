import { describe, expect, it } from "vitest";
import { deepMerge } from "@/lib/deepMerge";

describe("admin settings defaults", () => {
  it("preserves required nested defaults for partial stored settings", () => {
    const defaults = {
      header: {
        layout: "layout-1",
        search: { enabled: true, mode: "standalone" },
        main_menu: { sticky: true },
      },
      sidebars: { style: "style-1" },
    };

    const merged = deepMerge(defaults, {
      header: { layout: "layout-6" },
      sidebars: { style: "style-4" },
    });

    expect(merged.header).toEqual({
      layout: "layout-6",
      search: { enabled: true, mode: "standalone" },
      main_menu: { sticky: true },
    });
    expect(merged.sidebars.style).toBe("style-4");
  });

  it("save merges narrow drafts into existing row (never drops sibling branches)", () => {
    // Simulates useSettings.save: read existing full row, deep-merge partial
    // draft on top, upsert result. Panes that only know about a subset of
    // `theme_options` (e.g. { logo }, { sidebars }) must not wipe header/etc.
    const existing = {
      logo: { main: "old.png" },
      header: {
        layout: "layout-1",
        search: { enabled: true, mode: "standalone" },
      },
      buttons: { radius: 8 },
    };
    const narrowDraft = { logo: { main: "new.png" } };
    const merged = deepMerge(existing, narrowDraft);
    expect(merged).toEqual({
      logo: { main: "new.png" },
      header: {
        layout: "layout-1",
        search: { enabled: true, mode: "standalone" },
      },
      buttons: { radius: 8 },
    });
  });
});
