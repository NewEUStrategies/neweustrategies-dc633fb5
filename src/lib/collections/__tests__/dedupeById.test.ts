// Deduplikacja rekordów po `id`.
//
// CO TO DOWODZI. Paginacja OFFSETOWA nie jest stabilna: publikacja nowego
// wiersza między żądaniami przesuwa okno, więc ten sam rekord wraca na
// kolejnej stronie. Bez deduplikacji trafia do listy Reacta pod zduplikowanym
// `key` - ostrzeżenie w konsoli i, przy zmianie kolejności, gubiony stan
// komponentu. Ten idiom stał wpisany DWA razy (feed obserwowanych i katalog
// osób), a jego nieoczywisty kontrakt nie był nigdzie zapisany.
//
// KONTRAKT, KTÓREGO ŁATWO NIE ZAUWAŻYĆ: pozycję wyznacza PIERWSZE wystąpienie,
// ale wartością jest OSTATNIE (`Map.set` nadpisuje). Dla feedów to zachowanie
// pożądane - świeższa strona niesie świeższą wersję wiersza - i właśnie
// dlatego jest tu objęte testem, a nie zostawione jako przypadkowy efekt.
import { describe, expect, it } from "vitest";

import { dedupeById } from "../dedupeById";

describe("dedupeById", () => {
  it("usuwa duplikaty, zachowując kolejność pierwszego wystąpienia", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }];
    expect(dedupeById(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("POZYCJĘ bierze z pierwszego wystąpienia, a WARTOŚĆ z ostatniego", () => {
    // To jest cały nieoczywisty kontrakt tej funkcji w jednym przypadku.
    const rows = [
      { id: "a", tytul: "stary" },
      { id: "b", tytul: "b" },
      { id: "a", tytul: "świeższy" },
    ];
    expect(dedupeById(rows)).toEqual([
      { id: "a", tytul: "świeższy" },
      { id: "b", tytul: "b" },
    ]);
  });

  it("lista bez duplikatów przechodzi bez zmian", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    expect(dedupeById(rows)).toEqual(rows);
  });

  it("pusta lista daje pustą listę", () => {
    expect(dedupeById([])).toEqual([]);
  });

  it("wszystkie wiersze o tym samym id zwijają się do jednego", () => {
    const rows = [
      { id: "a", n: 1 },
      { id: "a", n: 2 },
      { id: "a", n: 3 },
    ];
    expect(dedupeById(rows)).toEqual([{ id: "a", n: 3 }]);
  });

  it("nie mutuje wejścia", () => {
    const rows = [{ id: "a" }, { id: "a" }];
    dedupeById(rows);
    expect(rows).toHaveLength(2);
  });
});
