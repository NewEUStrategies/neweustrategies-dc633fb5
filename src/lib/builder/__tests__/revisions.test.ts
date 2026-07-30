// Migawki elementów buildera: normalizacja payloadu popupu i widgetu.
import { describe, it, expect } from "vitest";
import { parseGlobalWidgetRevision, parsePopupRevision } from "@/lib/builder/revisions";

describe("parsePopupRevision", () => {
  it("normalizes a full snapshot", () => {
    const out = parsePopupRevision({
      builder_data: { version: 1, sections: [] },
      settings: { trigger: "scroll", scrollPercent: 30 },
    });
    expect(out.builder_data.sections).toEqual([]);
    expect(out.settings.trigger).toBe("scroll");
    expect(out.settings.scrollPercent).toBe(30);
  });

  it("falls back to defaults for garbage input", () => {
    const out = parsePopupRevision("nope");
    expect(out.builder_data.version).toBe(1);
    expect(out.settings.trigger).toBe("delay");
  });
});

describe("parseGlobalWidgetRevision", () => {
  it("returns null when the widget type is unknown", () => {
    expect(parseGlobalWidgetRevision({ type: "not-a-widget" })).toBeNull();
  });

  it("keeps content for a known widget type", () => {
    const out = parseGlobalWidgetRevision({ type: "heading", content: { text_pl: "A" } });
    expect(out?.type).toBe("heading");
    expect(out?.content).toEqual({ text_pl: "A" });
  });
});
