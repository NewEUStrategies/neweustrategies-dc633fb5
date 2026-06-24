// Pattern library i18n walker + override application.
import { describe, it, expect } from "vitest";
import { applyI18nOverrides, collectI18nFields } from "../i18n";
import { PAGE_PATTERNS } from "../library";

describe("patterns/i18n", () => {
  it("collects PL/EN string pairs from a builder document", () => {
    const pattern = PAGE_PATTERNS[0];
    expect(pattern).toBeDefined();
    if (!pattern) return;
    const fields = collectI18nFields(pattern.builder);
    expect(fields.length).toBeGreaterThan(0);
    // Every collected field must have both PL and EN strings present.
    for (const f of fields) {
      expect(typeof f.pl).toBe("string");
      expect(typeof f.en).toBe("string");
      expect(f.baseKey.length).toBeGreaterThan(0);
    }
  });

  it("applies overrides without mutating the source doc", () => {
    const pattern = PAGE_PATTERNS[0];
    if (!pattern) return;
    const fields = collectI18nFields(pattern.builder);
    const overrides = fields.map(() => ({ pl: "PL!", en: "EN!" }));
    const original = JSON.stringify(pattern.builder);
    const next = applyI18nOverrides(pattern.builder, fields, overrides);
    // Source unchanged.
    expect(JSON.stringify(pattern.builder)).toBe(original);
    // Every collected field now reads back as the override.
    const updated = collectI18nFields(next);
    expect(updated.length).toBe(fields.length);
    for (const f of updated) {
      expect(f.pl).toBe("PL!");
      expect(f.en).toBe("EN!");
    }
  });
});
