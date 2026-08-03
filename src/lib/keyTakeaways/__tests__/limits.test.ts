import { describe, expect, it } from "vitest";
import {
  KEY_TAKEAWAYS_MAX_ITEMS,
  KEY_TAKEAWAYS_MAX_ITEM_LENGTH,
  KEY_TAKEAWAYS_RECOMMENDED_MAX_LENGTH,
  KEY_TAKEAWAYS_RECOMMENDED_MIN_LENGTH,
  normalizeTakeaways,
} from "@/lib/keyTakeaways/limits";

describe("limity takeaways - kontrakt z bazą", () => {
  // Te dwie asercje są celowo trywialne: przypinają wartości do limitów
  // triggerów `posts_validate_takeaways` / `pages_validate_takeaways`
  // (migracja 20260709100809). Zmiana stałej bez migracji zapala ten test,
  // a zmiana migracji bez stałej - kontrakt pgTAP
  // (supabase/tests/takeaways_limits_contract_test.sql).
  it("dopuszcza 7 punktów - tyle, ile trigger w bazie", () => {
    expect(KEY_TAKEAWAYS_MAX_ITEMS).toBe(7);
  });

  it("dopuszcza 500 znaków na punkt - tyle, ile trigger w bazie", () => {
    expect(KEY_TAKEAWAYS_MAX_ITEM_LENGTH).toBe(500);
  });

  it("rekomendacja redakcyjna mieści się w limicie twardym", () => {
    expect(KEY_TAKEAWAYS_RECOMMENDED_MIN_LENGTH).toBeLessThan(KEY_TAKEAWAYS_RECOMMENDED_MAX_LENGTH);
    expect(KEY_TAKEAWAYS_RECOMMENDED_MAX_LENGTH).toBeLessThanOrEqual(KEY_TAKEAWAYS_MAX_ITEM_LENGTH);
  });
});

describe("normalizeTakeaways", () => {
  it("zwraca pustą listę dla braku wejścia", () => {
    expect(normalizeTakeaways(null)).toEqual([]);
    expect(normalizeTakeaways(undefined)).toEqual([]);
    expect(normalizeTakeaways([])).toEqual([]);
  });

  it("przycina białe znaki i usuwa puste punkty", () => {
    expect(normalizeTakeaways(["  pierwszy  ", "", "   ", "\n\t", "drugi"])).toEqual([
      "pierwszy",
      "drugi",
    ]);
  });

  it("pomija wartości nie-tekstowe bez wyjątku", () => {
    // Wiersz z bazy może przyjść z null-em w tablicy (kolumna text[] bez NOT NULL
    // na elementach) - render publiczny nie może się na tym wywalić.
    expect(normalizeTakeaways(["ok", null, undefined, "też ok"])).toEqual(["ok", "też ok"]);
  });

  it("obcina punkt do limitu długości zamiast go odrzucać", () => {
    const long = "x".repeat(KEY_TAKEAWAYS_MAX_ITEM_LENGTH + 25);
    const [only] = normalizeTakeaways([long]);
    expect(only).toHaveLength(KEY_TAKEAWAYS_MAX_ITEM_LENGTH);
  });

  it("obcina listę do limitu liczby punktów", () => {
    const many = Array.from({ length: KEY_TAKEAWAYS_MAX_ITEMS + 4 }, (_, i) => `punkt ${i}`);
    const out = normalizeTakeaways(many);
    expect(out).toHaveLength(KEY_TAKEAWAYS_MAX_ITEMS);
    expect(out.at(-1)).toBe(`punkt ${KEY_TAKEAWAYS_MAX_ITEMS - 1}`);
  });

  it("puste punkty nie zjadają limitu", () => {
    // Wejście ma 7 realnych punktów rozdzielonych pustymi - wszystkie 7 muszą
    // przejść (naiwna implementacja licząca przed filtrem ucięłaby po czwartym).
    const mixed = ["a", "", "b", "   ", "c", "", "d", "", "e", "", "f", "", "g"];
    expect(normalizeTakeaways(mixed)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });
});
