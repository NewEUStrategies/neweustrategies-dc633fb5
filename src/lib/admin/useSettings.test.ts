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
});