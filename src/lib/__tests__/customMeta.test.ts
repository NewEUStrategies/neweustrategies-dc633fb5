import { describe, it, expect } from "vitest";
import { buildCustomMetaItems, metaLabel, type CustomMetaDef } from "../customMeta";

const defs: CustomMetaDef[] = [
  { id: "1", tenant_id: "t", key: "prep_time", label_pl: "Czas przygotowania", label_en: "Prep time", icon: "Clock", position: 1 },
  { id: "2", tenant_id: "t", key: "difficulty", label_pl: "Trudność", label_en: "Difficulty", icon: "Award", position: 2 },
  { id: "3", tenant_id: "t", key: "servings", label_pl: "Porcje", label_en: "Servings", icon: "Users", position: 3 },
];

describe("buildCustomMetaItems", () => {
  it("returns empty when values null/undefined", () => {
    expect(buildCustomMetaItems(defs, null)).toEqual([]);
    expect(buildCustomMetaItems(defs, undefined)).toEqual([]);
  });
  it("preserves definition order and skips empty/missing", () => {
    const items = buildCustomMetaItems(defs, { difficulty: "Łatwa", prep_time: "30 min", missing: "x", servings: "  " });
    expect(items.map((i) => i.def.key)).toEqual(["prep_time", "difficulty"]);
    expect(items[0].value).toBe("30 min");
  });
  it("trims values", () => {
    const items = buildCustomMetaItems(defs, { prep_time: "  30 min  " });
    expect(items[0].value).toBe("30 min");
  });
});

describe("metaLabel", () => {
  it("returns PL label by default and falls back to EN/key", () => {
    expect(metaLabel(defs[0], "pl")).toBe("Czas przygotowania");
    expect(metaLabel({ ...defs[0], label_pl: "" }, "pl")).toBe("Prep time");
    expect(metaLabel({ ...defs[0], label_pl: "", label_en: "" }, "pl")).toBe("prep_time");
  });
  it("returns EN label when lang=en", () => {
    expect(metaLabel(defs[1], "en")).toBe("Difficulty");
  });
});
