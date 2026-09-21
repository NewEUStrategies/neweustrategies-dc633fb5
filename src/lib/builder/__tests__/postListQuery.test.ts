import { describe, it, expect } from "vitest";
import type { WidgetContent } from "@/lib/builder/types";
import {
  postListAuthorDisplay,
  postListDisplayLimit,
  postListInput,
  postListVariantHasByline,
  rankAndSlicePopular,
} from "@/lib/builder/postListQuery";

const row = (id: string) => ({ id });

describe("rankAndSlicePopular", () => {
  it("orders rows by the popularity ranking (most-popular first)", () => {
    const rows = [row("a"), row("b"), row("c")];
    const ranked = ["c", "a", "b"];
    expect(rankAndSlicePopular(rows, ranked, 0, 10).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("places rows absent from the ranking last", () => {
    const rows = [row("x"), row("a"), row("b")];
    const ranked = ["a", "b"];
    expect(rankAndSlicePopular(rows, ranked, 0, 10).map((r) => r.id)).toEqual(["a", "b", "x"]);
  });

  it("applies the offset/limit window after ranking", () => {
    const rows = [row("a"), row("b"), row("c"), row("d")];
    const ranked = ["d", "c", "b", "a"];
    expect(rankAndSlicePopular(rows, ranked, 1, 2).map((r) => r.id)).toEqual(["c", "b"]);
  });

  it("does not mutate the input rows", () => {
    const rows = [row("a"), row("b")];
    const snapshot = rows.map((r) => r.id);
    rankAndSlicePopular(rows, ["b", "a"], 0, 10);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });

  it("clamps a negative offset and a zero limit", () => {
    const rows = [row("a"), row("b")];
    expect(rankAndSlicePopular(rows, ["a", "b"], -5, 1).map((r) => r.id)).toEqual(["a"]);
    expect(rankAndSlicePopular(rows, ["a", "b"], 0, 0)).toEqual([]);
  });

  it("zachowuje wzajemna kolejnosc wierszy, ktorych ranking NIE ZNA W OGOLE", () => {
    // Oba porownywane wiersze wpadaja w wartosc domyslna rankingu, wiec sortowanie
    // musi byc stabilne - inaczej lista "popularnych" tasowalaby ogon przy kazdym
    // renderze, choc dane sie nie zmienily.
    const rows = [row("a"), row("x"), row("y")];
    expect(rankAndSlicePopular(rows, ["a"], 0, 10).map((r) => r.id)).toEqual(["a", "x", "y"]);
  });
});

describe("normalizacja wejscia post-listy", () => {
  it("ZACISKA limit, offset, liczbe kolumn i okno popularnosci do bezpiecznych zakresow", () => {
    const wide = postListInput(
      { limit: 999, offset: -5, columns: 99, popularDays: 900 } as WidgetContent,
      "pl",
    );
    expect(wide.limit).toBe(100);
    expect(wide.offset).toBe(0);
    expect(wide.cols).toBe(6);
    expect(wide.popularDays).toBe(365);

    const narrow = postListInput({ limit: 0, columns: 0, popularDays: 0 } as WidgetContent, "pl");
    expect(narrow.limit).toBe(1);
    expect(narrow.cols).toBe(1);
    expect(narrow.popularDays).toBe(1);
  });

  it("nadmiarowe pobranie uniqueOnPage NIE PRZEKRACZA setki", () => {
    expect(postListInput({ limit: 100, uniqueOnPage: true } as WidgetContent, "pl").limit).toBe(
      100,
    );
    expect(postListInput({ limit: 50, uniqueOnPage: true } as WidgetContent, "pl").limit).toBe(68);
    expect(postListDisplayLimit({ limit: 999 } as WidgetContent)).toBe(100);
    expect(postListDisplayLimit({ limit: 0 } as WidgetContent)).toBe(1);
  });

  it("brak wariantu znaczy 'card', a kierunek inny niz 'asc' znaczy 'desc'", () => {
    expect(postListInput({}, "pl").variant).toBe("card");
    expect(postListInput({ orderDir: "asc" } as WidgetContent, "pl").orderDir).toBe("asc");
    expect(postListInput({ orderDir: "byle co" } as WidgetContent, "pl").orderDir).toBe("desc");
    expect(postListInput({}, "pl").orderDir).toBe("desc");
  });

  it("csv taksonomii jest TRYMOWANE, a puste pozycje wypadaja", () => {
    const input = postListInput(
      { categoriesCsv: " polityka , , gospodarka ", excludeIdsCsv: "," } as WidgetContent,
      "pl",
    );
    expect(input.includeCats).toEqual(["polityka", "gospodarka"]);
    expect(input.excludeCats).toEqual([]);
    expect(input.excludeIds).toEqual([]);
  });

  it("autorow dociagamy TYLKO dla wariantu z bylinem i wlaczonej prezentacji autora", () => {
    expect(postListVariantHasByline("numbered")).toBe(false);
    expect(postListAuthorDisplay({ authorDisplay: "none" } as WidgetContent)).toBe("none");
    expect(postListInput({ variant: "card" } as WidgetContent, "pl").withAuthors).toBe(true);
    expect(postListInput({ variant: "numbered" } as WidgetContent, "pl").withAuthors).toBe(false);
    expect(
      postListInput({ variant: "card", authorDisplay: "none" } as WidgetContent, "pl").withAuthors,
    ).toBe(false);
  });
});
