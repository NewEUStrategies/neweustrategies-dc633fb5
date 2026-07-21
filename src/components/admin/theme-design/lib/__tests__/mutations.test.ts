// Unit tests for the pure Theme Design draft mutations.
import { describe, it, expect, vi } from "vitest";

// The fixture (THEME_DESIGN_DEFAULTS) lives in a module that transitively
// imports the Supabase client, which throws without env vars - stub it.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) },
}));

import { THEME_DESIGN_DEFAULTS, type ThemeDesign } from "@/lib/theme/themeDesign";
import { applyColor, applySectionPatch, diffChangedFields } from "../mutations";

function clone(): ThemeDesign {
  return structuredClone(THEME_DESIGN_DEFAULTS);
}

describe("applySectionPatch", () => {
  it("updates the targeted field and preserves siblings", () => {
    const draft = clone();
    const next = applySectionPatch(draft, "blockHeading", { fontSize: "22px" });
    expect(next.blockHeading.fontSize).toBe("22px");
    expect(next.blockHeading.fontWeight).toBe(draft.blockHeading.fontWeight);
  });

  it("does not mutate the input draft", () => {
    const draft = clone();
    const before = draft.blockHeading.fontSize;
    applySectionPatch(draft, "blockHeading", { fontSize: "99px" });
    expect(draft.blockHeading.fontSize).toBe(before);
  });

  it("returns a new object reference", () => {
    const draft = clone();
    expect(applySectionPatch(draft, "thumbnail", { radius: "4px" })).not.toBe(draft);
  });
});

describe("applyColor - light mode", () => {
  it("writes the value straight onto the section", () => {
    const next = applyColor(clone(), "light", "blockHeading", "color", "#ff0000");
    expect(next.blockHeading.color).toBe("#ff0000");
    expect(next.darkOverrides).toEqual({});
  });

  it("clears to an empty string (inherit) when passed null", () => {
    const next = applyColor(clone(), "light", "blockHeading", "color", null);
    expect(next.blockHeading.color).toBe("");
  });
});

describe("applyColor - dark mode", () => {
  it("writes into darkOverrides without touching the light value", () => {
    const draft = clone();
    const lightBefore = draft.blockHeading.color;
    const next = applyColor(draft, "dark", "blockHeading", "color", "#eeeeee");
    expect(next.darkOverrides.blockHeading?.color).toBe("#eeeeee");
    expect(next.blockHeading.color).toBe(lightBefore);
  });

  it("prunes the field, then the section, when cleared", () => {
    let draft = applyColor(clone(), "dark", "blockHeading", "color", "#eeeeee");
    draft = applyColor(draft, "dark", "blockHeading", "color", null);
    expect(draft.darkOverrides.blockHeading).toBeUndefined();
    expect(draft.darkOverrides).toEqual({});
  });

  it("keeps other override fields when one is cleared", () => {
    let draft = applyColor(clone(), "dark", "toolbarButton", "bgColor", "#000000");
    draft = applyColor(draft, "dark", "toolbarButton", "color", "#ffffff");
    draft = applyColor(draft, "dark", "toolbarButton", "bgColor", "");
    expect(draft.darkOverrides.toolbarButton).toEqual({ color: "#ffffff" });
  });
});

describe("diffChangedFields", () => {
  it("returns null when nothing changed", () => {
    const prev = { a: 1, b: 2, c: 3 };
    expect(diffChangedFields({ ...prev }, prev)).toBeNull();
  });

  it("returns only the fields that differ", () => {
    const prev = { a: 1, b: 2, c: 3 };
    expect(diffChangedFields({ a: 1, b: 9, c: 3 }, prev)).toEqual({ b: 9 });
    expect(diffChangedFields({ a: 0, b: 9, c: 3 }, prev)).toEqual({ a: 0, b: 9 });
  });
});
