import { describe, it, expect } from "vitest";
import { parseSlashQuery, searchBlockSpecs } from "@/lib/blocks/search";
import type { BlockType } from "@/lib/blocks/types";

const label = (type: BlockType): string => (type === "heading" ? "Nagłówek" : type);

describe("parseSlashQuery", () => {
  it("extracts the query after a leading slash", () => {
    expect(parseSlashQuery("/")).toBe("");
    expect(parseSlashQuery("/nag")).toBe("nag");
    expect(parseSlashQuery("/obraz")).toBe("obraz");
  });

  it("returns null when the user is writing normal content", () => {
    expect(parseSlashQuery("zwykły tekst")).toBeNull();
    expect(parseSlashQuery("/nag ówek ze spacją")).toBeNull();
    expect(parseSlashQuery("//")).toBeNull();
    expect(parseSlashQuery("")).toBeNull();
  });

  it("normalizes non-breaking spaces before matching", () => {
    expect(parseSlashQuery("/nag x")).toBeNull();
  });
});

describe("searchBlockSpecs", () => {
  it("returns all implemented blocks for an empty query", () => {
    expect(searchBlockSpecs("", label).length).toBeGreaterThan(50);
  });

  it("matches by i18n label, type and description (case-insensitive)", () => {
    const byLabel = searchBlockSpecs("nagłó", label);
    expect(byLabel.map((s) => s.type)).toContain("heading");
    const byType = searchBlockSpecs("PARAGRAPH", label);
    expect(byType.map((s) => s.type)).toContain("paragraph");
  });
});
