// „Powiązane kategorie / tagi" archiwum - JEDNA fabryka zapytania dla sekcji
// pod listą (`ArchiveBody`) i widżetu sidebara (`ArchiveSidebar`).
//
// CO TU NAPRAWIAMY. Obie powierzchnie miały własną kopię zapytania
// `.from("categories" | "tags").select(...).neq("id", taxonomyId).limit(12 | 10)`
// - bez `ORDER BY` i bez związku z bieżącym archiwum, czyli pierwsze wiersze
// sterty podpisane jako „powiązane". Do tego dwa różne limity i dwa różne klucze
// cache, więc archiwum z włączoną sekcją I widżetem pytało bazę dwa razy
// o dwie różne wersje tego samego szumu.
//
// SYGNAŁ. Ranking liczy baza (`related_taxonomies`, migracja 20261003100200):
// współwystępowanie na opublikowanych wpisach, znormalizowane kosinusem
// shared / sqrt(n_bieżący * n_kandydat), żeby największy termin serwisu nie
// wygrywał pod każdym archiwum. Kolejność wiersza = kolejność wyświetlania;
// tu niczego nie przestawiamy.
//
// JEDEN KLUCZ, JEDEN LIMIT. Obie powierzchnie biorą `RELATED_TAXONOMIES_LIMIT`,
// więc trafiają w ten sam wpis cache - sekcja i widżet na jednej stronie to
// jedno żądanie.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TaxonomyKind } from "@/lib/queries/taxonomyPivot";

export interface RelatedTaxonomy {
  readonly id: string;
  readonly slug: string;
  readonly name_pl: string;
  readonly name_en: string;
}

/** Liczba terminów dla OBU powierzchni - wspólna, bo wchodzi do klucza cache. */
export const RELATED_TAXONOMIES_LIMIT = 12;

const RELATED_TAXONOMIES_TTL = 5 * 60_000;

export const relatedTaxonomiesQueryOptions = (
  kind: TaxonomyKind,
  taxonomyId: string,
  limit: number = RELATED_TAXONOMIES_LIMIT,
) =>
  queryOptions({
    queryKey: ["public", "related-taxonomies", kind, taxonomyId, limit] as const,
    queryFn: async (): Promise<readonly RelatedTaxonomy[]> => {
      const { data, error } = await supabase.rpc("related_taxonomies", {
        _kind: kind,
        _taxonomy_id: taxonomyId,
        _limit: limit,
      });
      // ŚWIADOMY WYJĄTEK od zasady „błąd leci w górę". To sekcja dekoracyjna
      // archiwum: dla czytelnika awaria i brak sygnału mają ten sam skutek
      // (sekcji nie ma, widżet mówi „Brak."), a rzucony błąd kupiłby tylko
      // trzy ponowienia z backoffem przy każdym wejściu na archiwum. Pusta
      // lista trafia do cache na `staleTime`, więc padnięta funkcja nie jest
      // też odpytywana w kółko. Bez logowania: wynik nie zależy od czytelnika,
      // więc ten sam błąd wróciłby w konsoli każdego odwiedzającego.
      if (error) return [];
      return (data ?? []).map((row) => ({
        id: row.id,
        slug: row.slug,
        name_pl: row.name_pl,
        name_en: row.name_en,
      }));
    },
    staleTime: RELATED_TAXONOMIES_TTL,
  });
