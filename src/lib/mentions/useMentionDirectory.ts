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
// DWA ŹRÓDŁA, ROZSTRZYGNIĘTE ZE SLUGA. Firma nosi prefiks `org-` i stabilny
// identyfikator rekordu, więc nie trzeba zgadywać ani pytać „na próbę": osoby
// idą jednym zapytaniem do publicznej projekcji profili, firmy - publicznym
// RPC po jednym na firmę (kartoteka nie ma wejścia wsadowego, a firm w wątku
// jest garść, nie setki). Przy wątku bez firm drugie zapytanie w ogóle nie leci.
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildDirectory, EMPTY_DIRECTORY, type MentionDirectory } from "./directory";
import { decodeOrganizationMentionSlug } from "./mentionTargets";

const PERSON_COLS =
  "slug, display_name, first_name, last_name, avatar_url, job_title, current_company, specialization, bio_pl, bio_en, verified_at";

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
/** Osoby jednym zapytaniem wsadowym. Pusty wejściowy zbiór nie pyta o nic. */
async function fetchPersonRows(slugs: readonly string[]): Promise<Record<string, unknown>[]> {
  if (slugs.length === 0) return [];
  const { data, error } = await supabase
    .from("profiles_public")
    .select(PERSON_COLS)
    .in("slug", slugs);
  if (error) throw error;
  return data ?? [];
}

/**
 * Firmy - po jednym zapytaniu na firmę, bo kartoteka nie ma wejścia wsadowego.
 * Firma, której kartoteka nie zna, wypada z wyniku i NIE wywraca pozostałych:
 * jedna nierozwiązana wzmianka nie może zabrać etykiet całemu wątkowi.
 */
async function fetchOrgRows(slugs: readonly string[]): Promise<Record<string, unknown>[]> {
  if (slugs.length === 0) return [];
  const settled = await Promise.all(
    slugs.map(async (slug): Promise<Record<string, unknown> | null> => {
      const { data, error } = await supabase.rpc("get_mention_target", { _slug: slug });
      if (error) return null;
      const row = (data ?? [])[0];
      return row === undefined ? null : { ...row, slug };
    }),
  );
  return settled.filter((row): row is Record<string, unknown> => row !== null);
}

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
        const orgSlugs = wanted.filter((slug) => decodeOrganizationMentionSlug(slug) !== null);
        const personSlugs = wanted.filter((slug) => decodeOrganizationMentionSlug(slug) === null);
        const [personRows, orgRows] = await Promise.all([
          fetchPersonRows(personSlugs),
          fetchOrgRows(orgSlugs),
        ]);
        return buildDirectory(personRows, orgRows, lang);
      },
    },
    client,
  );
  return {
    directory: query.data ?? EMPTY_DIRECTORY,
    isPending: query.isPending && query.isFetching,
  };
}
