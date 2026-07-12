import { describe, it, expect } from "vitest";
import { pickLocalized, pickPair } from "../pickLocalized";

describe("pickLocalized", () => {
  it("returns the requested language when present", () => {
    const row = { title_pl: "Tytuł", title_en: "Title" };
    expect(pickLocalized(row, "title", "en")).toBe("Title");
    expect(pickLocalized(row, "title", "pl")).toBe("Tytuł");
  });

  it("falls back to the other language when the requested one is missing", () => {
    // en requested but only pl present
    expect(pickLocalized({ title_pl: "Tytuł" }, "title", "en")).toBe("Tytuł");
    // pl requested but only en present (this is the unified policy: fall back
    // to the OTHER language rather than returning empty)
    expect(pickLocalized({ title_en: "Title" }, "title", "pl")).toBe("Title");
  });

  it("returns the fallback when neither language has content", () => {
    expect(pickLocalized({}, "title", "en", "N/A")).toBe("N/A");
    expect(pickLocalized({ title_pl: "", title_en: "" }, "title", "en", "N/A")).toBe("N/A");
  });

  it("returns '' when neither language nor a fallback is available", () => {
    expect(pickLocalized({}, "title", "en")).toBe("");
    expect(pickLocalized({ title_pl: "  " }, "title", "en")).toBe("");
  });

  it("is null/undefined safe for the row and for individual fields", () => {
    expect(pickLocalized(null, "title", "en", "fb")).toBe("fb");
    expect(pickLocalized(undefined, "title", "en")).toBe("");
    expect(pickLocalized({ title_en: null, title_pl: undefined }, "title", "en", "fb")).toBe("fb");
  });

  it("treats whitespace-only as empty and skips to the next candidate", () => {
    // requested language is blank -> other language wins
    expect(pickLocalized({ title_en: "   ", title_pl: "Tytuł" }, "title", "en")).toBe("Tytuł");
    // both blank -> fallback
    expect(pickLocalized({ title_en: "\t\n", title_pl: " " }, "title", "en", "fb")).toBe("fb");
  });

  it("returns the chosen value verbatim (does not trim content)", () => {
    expect(pickLocalized({ title_en: "  Hello  " }, "title", "en")).toBe("  Hello  ");
  });

  it("treats non-string values as empty", () => {
    // number in the requested slot is ignored; string in the other slot wins
    const row = { count_en: 42, count_pl: "czterdzieści dwa" } as Record<string, unknown>;
    expect(pickLocalized(row, "count", "en", "fb")).toBe("czterdzieści dwa");
    // both non-string -> fallback
    expect(pickLocalized({ n_en: 1, n_pl: 2 } as Record<string, unknown>, "n", "en", "fb")).toBe(
      "fb",
    );
  });
});

describe("pickPair", () => {
  it("prefers the primary, then secondary, then fallback", () => {
    expect(pickPair("a", "b")).toBe("a");
    expect(pickPair("", "b")).toBe("b");
    expect(pickPair("", "", "fb")).toBe("fb");
    expect(pickPair("", "")).toBe("");
  });

  it("is null/undefined and non-string safe", () => {
    expect(pickPair(null, undefined, "fb")).toBe("fb");
    expect(pickPair(undefined, "b")).toBe("b");
    expect(pickPair(5, "b")).toBe("b");
  });

  it("treats whitespace-only as empty but returns content verbatim", () => {
    expect(pickPair("   ", "b")).toBe("b");
    expect(pickPair("  x  ", "b")).toBe("  x  ");
  });
});
