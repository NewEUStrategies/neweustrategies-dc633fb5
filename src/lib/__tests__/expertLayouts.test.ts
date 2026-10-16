// Nadpisania layoutu per-ekspert: parser (jsonb + kolumna presetu), aliasy
// legacy presetów, sanityzacja kolorów CSS (wektor injection przez scoped
// <style>), normalizacja kolejności sekcji oraz merge z ustawieniami tenanta.
import { describe, it, expect } from "vitest";
import {
  countExpertLayoutOverrides,
  DEFAULT_EXPERT_SECTION_ORDER,
  defaultExpertLayoutSettings,
  EXPERT_SECTIONS,
  findExpertPreset,
  isSectionVisible,
  mergeExpertLayout,
  normalizeExpertSectionOrder,
  parseExpertLayoutOverrides,
  resolveExpertPresetId,
  sanitizeCssColor,
} from "@/lib/expertLayouts";

describe("resolveExpertPresetId / findExpertPreset", () => {
  it("accepts current preset ids verbatim", () => {
    expect(resolveExpertPresetId("classic")).toBe("classic");
    expect(resolveExpertPresetId("sidebar-right")).toBe("sidebar-right");
  });

  it("maps legacy ids (original DB CHECK) onto the current set", () => {
    expect(resolveExpertPresetId("portrait-left")).toBe("classic");
    expect(resolveExpertPresetId("full-bleed-cover")).toBe("magazine");
    expect(resolveExpertPresetId("centered-minimal")).toBe("centered");
    expect(resolveExpertPresetId("split-columns")).toBe("sidebar-left");
    expect(resolveExpertPresetId("sidebar-rail")).toBe("sidebar-right");
  });

  it("rejects unknown values and non-strings", () => {
    expect(resolveExpertPresetId("nope")).toBeNull();
    expect(resolveExpertPresetId(42)).toBeNull();
    expect(resolveExpertPresetId(null)).toBeNull();
  });

  it("findExpertPreset resolves legacy ids and falls back to the first preset", () => {
    expect(findExpertPreset("sidebar-rail").id).toBe("sidebar-right");
    expect(findExpertPreset("unknown").id).toBe("classic");
    expect(findExpertPreset(null).id).toBe("classic");
  });
});

describe("sanitizeCssColor", () => {
  it("accepts hex, functional notations and theme-ish tokens", () => {
    expect(sanitizeCssColor("#3366cc")).toBe("#3366cc");
    expect(sanitizeCssColor("  #ABCDEF ")).toBe("#ABCDEF");
    expect(sanitizeCssColor("rgb(10, 20, 30)")).toBe("rgb(10, 20, 30)");
    expect(sanitizeCssColor("oklch(0.63 0.11 226)")).toBe("oklch(0.63 0.11 226)");
    expect(sanitizeCssColor("color-mix(in oklab, red 40%, blue)")).toBe(
      "color-mix(in oklab, red 40%, blue)",
    );
  });

  it("rejects values able to escape a CSS declaration or smuggle a URL", () => {
    // `;`/`}` domykają deklarację/blok w scoped <style> (dangerouslySetInnerHTML).
    expect(sanitizeCssColor("red; background-image: none")).toBeNull();
    expect(sanitizeCssColor("red} body{display:none")).toBeNull();
    expect(sanitizeCssColor('red"><script>')).toBeNull();
    // Dwukropek poza białą listą blokuje url(...) i data:.
    expect(sanitizeCssColor("url(https://evil.example/x.png)")).toBeNull();
    expect(sanitizeCssColor("")).toBeNull();
    expect(sanitizeCssColor("   ")).toBeNull();
    expect(sanitizeCssColor(123)).toBeNull();
    expect(sanitizeCssColor("a".repeat(65))).toBeNull();
  });
});

describe("normalizeExpertSectionOrder", () => {
  it("drops unknown keys and duplicates, then appends missing sections", () => {
    const order = normalizeExpertSectionOrder(["cv", "cv", "bogus", "details"]);
    expect(order?.slice(0, 2)).toEqual(["cv", "details"]);
    expect(order).toHaveLength(EXPERT_SECTIONS.length);
    expect(new Set(order)).toEqual(new Set(EXPERT_SECTIONS));
  });

  it("returns null for non-arrays and arrays without a single valid key", () => {
    expect(normalizeExpertSectionOrder(null)).toBeNull();
    expect(normalizeExpertSectionOrder("cv")).toBeNull();
    expect(normalizeExpertSectionOrder(["nope", 7])).toBeNull();
  });
});

describe("parseExpertLayoutOverrides", () => {
  it("returns null when nothing is overridden", () => {
    expect(parseExpertLayoutOverrides(null, null)).toBeNull();
    expect(parseExpertLayoutOverrides({}, null)).toBeNull();
    expect(parseExpertLayoutOverrides({ junk: true }, "not-a-preset")).toBeNull();
  });

  it("prefers the layout_preset column over the jsonb preset key", () => {
    const parsed = parseExpertLayoutOverrides({ preset: "minimal" }, "editorial");
    expect(parsed?.preset).toBe("editorial");
  });

  it("falls back to the jsonb preset key and resolves legacy column values", () => {
    expect(parseExpertLayoutOverrides({ preset: "minimal" }, null)?.preset).toBe("minimal");
    expect(parseExpertLayoutOverrides({}, "portrait-left")?.preset).toBe("classic");
  });

  it("keeps only well-typed fields and sanitizes colors", () => {
    const parsed = parseExpertLayoutOverrides(
      {
        center_hero: true,
        center_details: "yes",
        accent_color: "#112233",
        accent_color_dark: "red} body{display:none",
        section_order: ["materials", "junk"],
        visibility: { cv: false, junk: true, materials: "no" },
      },
      null,
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.center_hero).toBe(true);
    expect(parsed?.center_details).toBeUndefined();
    expect(parsed?.accent_color).toBe("#112233");
    expect(parsed?.accent_color_dark).toBeUndefined();
    expect(parsed?.section_order?.[0]).toBe("materials");
    expect(parsed?.visibility).toEqual({ cv: false });
  });

  it("ignores non-object jsonb payloads", () => {
    expect(parseExpertLayoutOverrides("[]", null)).toBeNull();
    expect(parseExpertLayoutOverrides([1, 2], "minimal")?.preset).toBe("minimal");
  });
});

describe("mergeExpertLayout + countExpertLayoutOverrides", () => {
  it("expert overrides win, everything else inherits from the tenant", () => {
    const tenant = {
      ...defaultExpertLayoutSettings("t1"),
      default_preset: "classic" as const,
      show_cv: true,
      accent_color: "#000000",
    };
    const overrides = parseExpertLayoutOverrides(
      { visibility: { cv: false }, accent_color: "#ff0000", center_hero: true },
      "minimal",
    );
    const { preset, settings } = mergeExpertLayout(tenant, overrides);
    expect(preset.id).toBe("minimal");
    expect(settings.default_preset).toBe("minimal");
    expect(isSectionVisible(settings, "cv")).toBe(false);
    expect(settings.accent_color).toBe("#ff0000");
    expect(settings.center_hero).toBe(true);
    // Dziedziczone bez zmian:
    expect(settings.accent_color_dark).toBe(tenant.accent_color_dark);
    expect(settings.max_width).toBe(tenant.max_width);
    expect(settings.section_order).toEqual(DEFAULT_EXPERT_SECTION_ORDER);
  });

  it("null overrides are a clean pass-through of tenant settings", () => {
    const tenant = defaultExpertLayoutSettings("t1");
    const { preset, settings } = mergeExpertLayout(tenant, null);
    expect(preset.id).toBe(tenant.default_preset);
    expect(settings).toMatchObject({ ...tenant, default_preset: preset.id });
  });

  it("counts active overrides for the editor badge", () => {
    expect(countExpertLayoutOverrides(null)).toBe(0);
    expect(
      countExpertLayoutOverrides({
        preset: "minimal",
        center_hero: false,
        accent_color: "#123456",
        visibility: { cv: false, materials: true },
      }),
    ).toBe(5);
  });
});

describe("defaultExpertLayoutSettings - stan tenanta bez wiersza", () => {
  it("bez argumentu: pusty tenant, pełna kolejność i wszystkie sekcje widoczne", () => {
    const settings = defaultExpertLayoutSettings();
    expect(settings.tenant_id).toBe("");
    expect(settings.default_preset).toBe("classic");
    expect(new Set(settings.section_order)).toEqual(new Set(EXPERT_SECTIONS));
    expect(settings.section_order).toHaveLength(EXPERT_SECTIONS.length);
    for (const key of EXPERT_SECTIONS) expect(isSectionVisible(settings, key)).toBe(true);
  });
});

describe("parseExpertLayoutOverrides - pozostałe pola", () => {
  it("`false` jest świadomym nadpisaniem (nie znika), sam ciemny akcent też wystarcza", () => {
    expect(
      parseExpertLayoutOverrides({ center_details: false, accent_color_dark: " #0a0b0c " }, null),
    ).toEqual({ center_details: false, accent_color_dark: "#0a0b0c" });
  });

  it("widoczność bez ani jednego poprawnego wpisu nie tworzy klucza - całość składa się do null", () => {
    expect(parseExpertLayoutOverrides({ visibility: { junk: true, cv: "no" } }, null)).toBeNull();
    expect(parseExpertLayoutOverrides({ visibility: [true, false] }, null)).toBeNull();
    expect(parseExpertLayoutOverrides({ visibility: null }, null)).toBeNull();
  });
});

describe("countExpertLayoutOverrides - badge inline-edytora", () => {
  it("pusty obiekt nadpisań to 0, nie błąd", () => {
    expect(countExpertLayoutOverrides({})).toBe(0);
    expect(countExpertLayoutOverrides(undefined)).toBe(0);
  });

  it("liczy kolejność, oba wycentrowania i oba akcenty po jednym", () => {
    expect(
      countExpertLayoutOverrides({
        section_order: ["cv"],
        center_hero: true,
        center_details: false,
        accent_color: "#111111",
        accent_color_dark: "#eeeeee",
      }),
    ).toBe(5);
  });
});

describe("mergeExpertLayout - każde pole nadpisania trafia w swoją kolumnę", () => {
  it("widoczność per sekcja, kolejność, wycentrowanie treści i ciemny akcent", () => {
    const tenant = defaultExpertLayoutSettings("t1");
    const hideAll = Object.fromEntries(EXPERT_SECTIONS.map((key) => [key, false]));
    const order = normalizeExpertSectionOrder(["programs", "cv"]) ?? [];

    const { settings } = mergeExpertLayout(tenant, {
      visibility: hideAll,
      section_order: order,
      center_details: true,
      accent_color_dark: "#fafafa",
    });

    for (const key of EXPERT_SECTIONS) expect(isSectionVisible(settings, key)).toBe(false);
    expect(settings.section_order.slice(0, 2)).toEqual(["programs", "cv"]);
    expect(settings.center_details).toBe(true);
    expect(settings.accent_color_dark).toBe("#fafafa");
    // Nienadpisane pola dziedziczą po tenancie.
    expect(settings.center_hero).toBe(tenant.center_hero);
    expect(settings.accent_color).toBe(tenant.accent_color);
  });

  it("legacy preset tenanta (DEFAULT kolumny 'portrait-left') renderuje się jako obecne id", () => {
    const tenant = {
      ...defaultExpertLayoutSettings("t1"),
      default_preset: "portrait-left" as never,
    };
    const { preset, settings } = mergeExpertLayout(tenant, null);
    expect(preset.id).toBe("classic");
    expect(settings.default_preset).toBe("classic");
  });
});
