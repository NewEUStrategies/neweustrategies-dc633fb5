import { describe, it, expect } from "vitest";
import { collapseContext, diffLines, diffRevisionSnapshots, docToLines } from "../revisionDiff";

describe("diffLines (LCS)", () => {
  it("oznacza dodane i usunięte linie, zachowując wspólne", () => {
    const out = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    expect(out).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("czyste dodanie na końcu", () => {
    const out = diffLines(["a"], ["a", "b"]);
    expect(out).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });

  it("identyczne wejścia nie generują zmian", () => {
    expect(diffLines(["a", "b"], ["a", "b"]).every((l) => l.kind === "same")).toBe(true);
  });
});

describe("collapseContext", () => {
  it("zwija długie ciągi niezmienionych linii do przerwy", () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => ({ kind: "same", text: `s${i}` }) as const),
      { kind: "added", text: "new" } as const,
    ];
    const out = collapseContext(lines, 2);
    const gap = out.find((l) => "gap" in l) as { gap: number };
    expect(gap.gap).toBe(8);
    expect(out.filter((l) => !("gap" in l))).toHaveLength(3);
  });
});

describe("docToLines", () => {
  it("zbiera teksty z dokumentu bloków, pomijając szum (id/type/url)", () => {
    const doc = {
      version: 1,
      blocks: [
        { id: "b1", type: "heading", text_pl: "Tytuł sekcji", anchor: "x" },
        {
          id: "b2",
          type: "paragraph",
          html_pl: "<p>Pierwszy akapit.</p><p>Drugi akapit.</p>",
          settings: { url: "https://example.com" },
        },
      ],
    };
    expect(docToLines(doc)).toEqual(["Tytuł sekcji", "Pierwszy akapit.", "Drugi akapit."]);
  });
});

describe("diffRevisionSnapshots", () => {
  it("wykrywa zmiany skalarne jako przed/po", () => {
    const out = diffRevisionSnapshots(
      { title_pl: "Stary", status: "draft" },
      { title_pl: "Nowy", status: "draft" },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "title_pl",
      kind: "scalar",
      before: "Stary",
      after: "Nowy",
    });
  });

  it("diffuje treść bloków per język i pomija pola bez zmian", () => {
    const mk = (text: string) => ({
      pl: { version: 1, blocks: [{ id: "b", type: "paragraph", text_pl: text }] },
      en: { version: 1, blocks: [] },
    });
    const out = diffRevisionSnapshots(
      { title_pl: "T", blocks_data: mk("Ala ma kota") },
      { title_pl: "T", blocks_data: mk("Ala ma psa") },
    );
    expect(out).toHaveLength(1);
    expect(out[0].field).toBe("content:pl");
    expect(out[0].lines).toEqual([
      { kind: "removed", text: "Ala ma kota" },
      { kind: "added", text: "Ala ma psa" },
    ]);
  });

  it("brak różnic daje pustą listę", () => {
    const snap = { title_pl: "X", takeaways_pl: ["a"] };
    expect(diffRevisionSnapshots(snap, { ...snap })).toEqual([]);
  });
});
