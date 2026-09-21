// Zbiorcze rozwiązanie wzmianek dla CAŁEJ powierzchni (wątek, sekcja
// komentarzy, ściana klubu) - jednym zapytaniem, nie jednym na wzmiankę.
//
// PO CO ZBIORCZO. Etykieta wzmianki to imię i nazwisko, a nie nick, więc
// profil musi być znany PRZY RENDERZE, a nie dopiero po najechaniu. Gdyby
// każda wzmianka pytała osobno, wątek z trzydziestoma wzmiankami zrobiłby
// trzydzieści wyjść do bazy przy pierwszym malowaniu.
//
// LENIWOŚĆ DYMKA ZOSTAJE NIETKNIĘTA. To zapytanie zwraca wyłącznie to, co
// widać w linii tekstu (nazwa, awatar, firma). Pełna karta - z biogramem -
// dalej dociąga się dopiero po otwarciu dymka (`useMentionProfile`).
//
// DWA KROKI, NIE DWA ZAPYTANIA RÓWNOLEGLE. Najpierw pytamy o osoby; o
// organizacje pytamy TYLKO o te slugi, które osobą nie są. Przy typowym wątku
// (same osoby) drugie zapytanie w ogóle nie leci.
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildDirectory, EMPTY_DIRECTORY, type MentionDirectory } from "./directory";

const PERSON_COLS =
  "slug, display_name, first_name, last_name, avatar_url, job_title, current_company, specialization, bio_pl, bio_en, verified_at";

const ORG_COLS = "id, slug, name_pl, name_en, description_pl, description_en, logo_url";

/**
 * Górna granica slugów w jednym zapytaniu. Chroni URL zapytania PostgREST
 * przed rozsadzeniem przy patologicznie długim wątku; nadmiar degraduje się do
 * etykiety zastępczej, a nie do błędu.
 */
export const MENTION_DIRECTORY_LIMIT = 60;

// Poza drzewem QueryClientProvider (izolowany render w testach/podglądzie)
// degradujemy do pustego katalogu zamiast rzucać - tekst ma się wyrenderować.
let fallbackClient: QueryClient | null = null;

/** Klucz zapytania: slugi posortowane, żeby ta sama treść w innej kolejności
 *  trafiała w ten sam wpis cache'u. */
export function directoryKey(slugs: readonly string[]): string {
  return [...slugs].sort().join(",");
}

export function useMentionDirectory(
  slugs: readonly string[],
  lang: "pl" | "en",
): { directory: MentionDirectory; isPending: boolean } {
  const ctxClient = useContext(QueryClientContext);
  const client = ctxClient ?? (fallbackClient ??= new QueryClient());
  const wanted = slugs.slice(0, MENTION_DIRECTORY_LIMIT);
  const key = directoryKey(wanted);
  const query = useQuery(
    {
      queryKey: ["mention-directory", key, lang] as const,
      enabled: ctxClient != null && wanted.length > 0,
      staleTime: 5 * 60_000,
      retry: false,
      queryFn: async (): Promise<MentionDirectory> => {
        const people = await supabase
          .from("profiles_public")
          .select(PERSON_COLS)
          .in("slug", wanted);
        if (people.error) throw people.error;
        const personRows = (people.data ?? []) as unknown as Record<string, unknown>[];
        const found = new Set(
          personRows
            .map((row) => (typeof row.slug === "string" ? row.slug.toLowerCase() : null))
            .filter((slug): slug is string => slug !== null),
        );
        const missing = wanted.filter((slug) => !found.has(slug));
        if (missing.length === 0) return buildDirectory(personRows, [], lang);
        const orgs = await supabase
          .from("categories")
          .select(ORG_COLS)
          .eq("kind", "organization")
          .in("slug", missing);
        if (orgs.error) throw orgs.error;
        return buildDirectory(
          personRows,
          (orgs.data ?? []) as unknown as Record<string, unknown>[],
          lang,
        );
      },
    },
    client,
  );
  return {
    directory: query.data ?? EMPTY_DIRECTORY,
    isPending: query.isPending && query.isFetching,
  };
}
