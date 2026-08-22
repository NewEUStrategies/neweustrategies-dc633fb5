// Atomy strony głównej: tryb renderu i stronicowanie.
//
// CO TO DOWODZI. Strona główna to najważniejsza trasa w repozytorium i miała
// 0% pokrycia. Te dwie decyzje rozstrzygają, CO czytelnik na niej zobaczy:
//   * `homeContent` - lista najnowszych wpisów, dokument buildera, albo stan
//     pusty. Pomyłka tutaj daje BIAŁĄ stronę główną, bez błędu w konsoli;
//   * `homeTotalPages` / `homePageSearch` - stronicowanie listy. Wartość `1`
//     musi zniknąć z adresu, inaczej `/` i `/?page=1` to dwa adresy tej samej
//     treści, czyli rozmyty ranking.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Parsowania dokumentu buildera
// (`parseBuilderDoc` ma własne testy), renderu widgetów, ani zapytań
// `homePageQueryOptions` / `homepageModeQueryOptions`.
import { describe, expect, it } from "vitest";

import { emptyDocument, type BuilderDocument, type SectionNode } from "@/lib/builder/types";

import { homeBuilderSource, homeContent } from "../homeRenderMode";
import { homePageSearch, homeTotalPages } from "../homePagination";

/**
 * Dokument buildera w REALNYM kształcie modelu (`emptyDocument()` niesie
 * `version`, sekcje mają wymagane `id` i `kind`). Decyzja o trybie renderu
 * patrzy tylko na LICZBĘ sekcji, ale atrapa o zmyślonym kształcie przestałaby
 * się kompilować przy zmianie modelu i niczego by nie chroniła.
 */
function doc(sectionCount: number): BuilderDocument {
  const base = emptyDocument();
  const section = (i: number): SectionNode => ({ id: `s${i}`, kind: "section", children: [] });
  return {
    ...base,
    sections: Array.from({ length: sectionCount }, (_, i) => section(i)),
  };
}

describe("homeBuilderSource - skąd wziąć dokument", () => {
  it("tryb `latest_posts` NIE czyta dokumentu wcale", () => {
    // Nawet gdy strona główna ma zapisany dokument buildera, tryb listy wpisów
    // musi go zignorować - inaczej operator nie może wrócić do listy.
    expect(
      homeBuilderSource("latest_posts", {
        editor: "builder",
        builder_data: { sections: [] },
      } as const),
    ).toBeNull();
  });

  it("bierze dokument, gdy strona jest zbudowana builderem", () => {
    const builder_data = { sections: [{ id: "s0" }] };
    expect(homeBuilderSource("static_page", { editor: "builder", builder_data })).toBe(
      builder_data,
    );
  });

  it("strona w innym edytorze nie daje dokumentu buildera", () => {
    expect(
      homeBuilderSource("static_page", {
        editor: "blocks",
        builder_data: { sections: [] },
      } as const),
    ).toBeNull();
  });

  it("brak strony głównej nie wywala się na dostępie do pola", () => {
    expect(homeBuilderSource("static_page", null)).toBeNull();
  });
});

describe("homeContent - co zobaczy czytelnik", () => {
  it("tryb listy wpisów wygrywa nad wszystkim", () => {
    expect(homeContent("latest_posts", doc(3))).toEqual({ kind: "latest_posts" });
  });

  it("dokument z sekcjami renderuje buildera", () => {
    const d = doc(2);
    expect(homeContent("static_page", d)).toEqual({ kind: "builder", doc: d });
  });

  it("dokument BEZ sekcji daje stan pusty, nie pustego buildera", () => {
    // To jest granica między „strona główna jest nieskonfigurowana" a białą
    // stroną: stan pusty ma własny komunikat, pusty builder nie renderuje nic.
    expect(homeContent("static_page", doc(0))).toEqual({ kind: "empty" });
  });

  it("brak dokumentu daje stan pusty", () => {
    expect(homeContent("static_page", null)).toEqual({ kind: "empty" });
  });
});

describe("homeTotalPages", () => {
  it.each([
    { total: 0, pageSize: 10, strony: 1 },
    { total: 1, pageSize: 10, strony: 1 },
    { total: 10, pageSize: 10, strony: 1 },
    { total: 11, pageSize: 10, strony: 2 },
    { total: 25, pageSize: 10, strony: 3 },
    { total: 100, pageSize: 10, strony: 10 },
  ])("$total wpisów po $pageSize -> $strony stron", ({ total, pageSize, strony }) => {
    expect(homeTotalPages(total, pageSize)).toBe(strony);
  });

  it("zero wpisów daje JEDNĄ stronę, nie zero", () => {
    // Zero stron oznaczałoby stronicowanie bez żadnej strony do pokazania -
    // pusta lista nadal jest stroną z komunikatem.
    expect(homeTotalPages(0, 12)).toBe(1);
  });
});

describe("homePageSearch - `page=1` nie może zostać w adresie", () => {
  it("pierwsza strona nie niesie parametru", () => {
    // `/` i `/?page=1` to ten sam zbiór wpisów; dwa adresy jednej treści
    // rozmywają ranking i marnują budżet crawlowania.
    expect(homePageSearch(1)).toEqual({ page: undefined });
  });

  it.each([2, 3, 17])("strona %s niesie swój numer", (nr) => {
    expect(homePageSearch(nr)).toEqual({ page: nr });
  });

  it("numer poniżej pierwszej strony też nie niesie parametru", () => {
    expect(homePageSearch(0)).toEqual({ page: undefined });
    expect(homePageSearch(-1)).toEqual({ page: undefined });
  });
});
