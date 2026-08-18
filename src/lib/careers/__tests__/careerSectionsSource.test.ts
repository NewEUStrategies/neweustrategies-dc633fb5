// Skąd strona, a skąd panel czytają sekcje /zatrudniamy - bramka pary.
//
// Migracja 20260817230000 domknęła wyciek: publiczna polityka
// `career_sections_public_read` filtruje teraz `AND is_visible`, więc roboczy
// nagłówek sekcji WYŁĄCZONEJ nie wychodzi już z tabeli do anona. Poprawka ma
// jednak DRUGĄ połowę po stronie klienta i obie muszą jechać razem:
//
//   * RLS zawęża WIERSZE, nie kolumny, więc po dociśnięciu polityki wiersz
//     sekcji ukrytej ZNIKA z odpowiedzi tabeli. `sectionState()` czyta brak
//     wiersza jako "pokaż" (świeża instalacja nie może dać pustej strony -
//     patrz catalog.test.ts), więc strona czytająca TABELĘ przywróciłaby na
//     siebie sekcję zdjętą przez redakcję. Dlatego czyta WIDOK
//     `career_page_sections_public`: komplet kluczy + flaga `is_visible`,
//     nagłówki sekcji ukrytej ucięte do NULL.
//   * Panel odwrotnie: musi widzieć brudnopis, bo to on jest przedmiotem
//     edycji. Czytanie widoku kasowałoby operatorowi treść przy odświeżeniu.
//
// Ten plik przybija oba źródła. Cofnięcie któregokolwiek do drugiej relacji
// jest cichą regresją: nic się nie wywala, tylko sekcja wraca na stronę
// (albo panel gubi treść).
import { describe, expect, it, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const db = vi.hoisted(() => ({ relations: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (relation: string) => {
    db.relations.push(relation);
    const b: Record<string, unknown> = {};
    for (const method of ["select", "order", "eq"]) b[method] = () => b;
    b.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
    return b;
  };
  return { supabase: { from: (relation: string) => builder(relation) } };
});

import { careerSectionsQueryOptions } from "../catalog";
import { careerSectionsAdminQueryOptions } from "../catalogAdmin";

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("źródło sekcji strony /zatrudniamy", () => {
  beforeEach(() => {
    db.relations = [];
  });

  it("strona publiczna czyta WIDOK - tabela nie oddaje już sekcji ukrytych", async () => {
    await freshClient().fetchQuery(careerSectionsQueryOptions());
    expect(db.relations).toEqual(["career_page_sections_public"]);
  });

  it("panel czyta TABELĘ - brudnopis sekcji wyłączonej jest tu przedmiotem edycji", async () => {
    await freshClient().fetchQuery(careerSectionsAdminQueryOptions());
    expect(db.relations).toEqual(["career_page_sections"]);
  });

  it("oba klucze siedzą pod wspólnym prefiksem, więc jedna inwalidacja bierze oba", () => {
    const publicKey = careerSectionsQueryOptions().queryKey;
    const adminKey = careerSectionsAdminQueryOptions().queryKey;

    // Zapis w panelu unieważnia `["career-page-sections"]` (admin.hiring.tsx).
    // Gdyby klucze rozjechały się prefiksem, po zapisie odświeżałaby się tylko
    // jedna z dwóch list żyjących obok siebie na tym samym ekranie.
    expect(publicKey[0]).toBe("career-page-sections");
    expect(adminKey[0]).toBe("career-page-sections");
    expect(publicKey).not.toEqual(adminKey);
  });
});
