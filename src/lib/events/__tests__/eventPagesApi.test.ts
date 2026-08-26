// Test podzialu podstron wydarzenia na „Strony w menu" i „Pozostale strony".
//
// TYLKO CZESC CZYSTA: odczyt z `pages` ma wlasne pokrycie po stronie zapytan,
// a tutaj chodzi o jedyna regule, ktora ekran „Strony i menu" stanowi sam -
// mapowanie TYMCZASOWE `menu_order > 0` na obecnosc w menu. Regula znika
// dopiero razem z tabela `event_pages`, wiec do tego czasu musi byc pilnowana:
// strona wypchnieta z menu przez pomylke to strona, ktorej uczestnik nie
// znajdzie.
import { describe, expect, it } from "vitest";
import { splitEventPages, type EventPageRow } from "@/lib/events/eventPagesApi";

function page(slug: string, menuOrder: number): EventPageRow {
  return {
    id: `id-${slug}`,
    slug,
    title_pl: slug,
    title_en: slug,
    status: "published",
    menu_order: menuOrder,
    template_type: "default",
    updated_at: "2026-08-01T10:00:00.000Z",
  };
}

describe("podzial podstron wydarzenia na menu i reszte", () => {
  it("do menu idzie tylko strona z dodatnia kolejnoscia", () => {
    const { menu, other } = splitEventPages([page("agenda", 1), page("archiwum", 0)]);
    expect(menu.map((row) => row.slug)).toEqual(["agenda"]);
    expect(other.map((row) => row.slug)).toEqual(["archiwum"]);
  });

  it("zero i wartosc ujemna znacza tyle samo co brak menu", () => {
    const { menu, other } = splitEventPages([page("a", 0), page("b", -1), page("c", -100)]);
    expect(menu).toEqual([]);
    expect(other.map((row) => row.slug)).toEqual(["a", "b", "c"]);
  });

  it("suma obu list jest rowna wejsciu - zadna strona nie ginie i nie dubluje sie", () => {
    const rows = [
      page("agenda", 1),
      page("archiwum", 0),
      page("prelegenci", 2),
      page("robocza", -3),
      page("kontakt", 10),
    ];
    const { menu, other } = splitEventPages(rows);
    expect(menu.length + other.length).toBe(rows.length);
    expect([...menu, ...other].map((row) => row.id).sort()).toEqual(
      rows.map((row) => row.id).sort(),
    );
  });

  it("zachowuje kolejnosc wejscia wewnatrz obu list", () => {
    // Wejscie jest juz posortowane zapytaniem (`menu_order`, potem `title_pl`),
    // wiec podzial nie ma prawa go przestawic - inaczej menu ekranu rozjezdza
    // sie z menu serwisu.
    const rows = [page("c", 3), page("z", 0), page("a", 1), page("b", 0), page("m", 2)];
    const { menu, other } = splitEventPages(rows);
    expect(menu.map((row) => row.slug)).toEqual(["c", "a", "m"]);
    expect(other.map((row) => row.slug)).toEqual(["z", "b"]);
  });

  it("pusta lista daje dwie puste listy, a nie undefined", () => {
    expect(splitEventPages([])).toEqual({ menu: [], other: [] });
  });

  it("zwraca nowe tablice, a nie widok na wejscie", () => {
    const rows = [page("agenda", 1)];
    const { menu } = splitEventPages(rows);
    menu.pop();
    expect(rows).toHaveLength(1);
  });
});
