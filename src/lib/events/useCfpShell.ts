// Hooki NABORU PRELEGENTÓW dla CHROME'U strony wydarzenia: pozycja w pasku
// zakładek (powłoka `/events/<slug>`) i odnośniki paneli w zakładce „Moje".
//
// DLACZEGO OSOBNY MODUŁ, A NIE `useCfpMe`. Pasek zakładek jedzie w chunku
// powłoki, czyli na KAŻDEJ stronie wydarzenia, a `useCfpMe` statycznie
// importuje `cfpPublicApi` razem z parserami całej powierzchni naboru
// (`cfpSurface`). Ten plik nie importuje jej wcale:
//   * pasek pyta WYŁĄCZNIE o fazę (`fetchCfpTabOpen`, jedno pole z RPC),
//   * panel prelegenta dociąga fetcher `import()`-em, dopiero gdy zapytanie
//     naprawdę startuje (zalogowany widz zakładki „Moje").
// Klucze cache są TUTAJ (a `useCfpMe` je re-eksportuje), bo wpis panelu musi
// być jeden: odnośnik w „Moje" i strona panelu prelegenta czytają ten sam.
//
// DWA KORZENIE KLUCZY, BO DWIE WIDOWNIE:
//   * `["event-cfp-public", slug]` - dane jednakowe dla każdego widza strony;
//   * `["event-cfp-me", slug, ...]` - dane WOŁAJĄCEGO (zgłoszenia, panel,
//     kolejka). Ten korzeń unieważnia globalna synchronizacja zdarzeń domeny
//     (`eventInvalidationMap`) po każdej zmianie zgłoszenia i oceny.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { fetchCfpTabOpen } from "@/lib/events/cfpShellApi";
import type { SpeakerPanel } from "@/lib/events/cfpSurface";

export const cfpPublicKeys = {
  all: ["event-cfp-public"] as const,
  slug: (slug: string) => [...cfpPublicKeys.all, slug] as const,
  /**
   * Sama faza dla paska zakładek. Pod gałęzią sluga, więc unieważnienie
   * `slug(slug)` obejmuje ją razem z pełną stroną naboru.
   */
  tabOpen: (slug: string) => [...cfpPublicKeys.slug(slug), "tab-open"] as const,
};

export const cfpMeKeys = {
  all: ["event-cfp-me"] as const,
  slug: (slug: string) => [...cfpMeKeys.all, slug] as const,
  submissions: (slug: string) => [...cfpMeKeys.slug(slug), "submissions"] as const,
  panel: (slug: string) => [...cfpMeKeys.slug(slug), "panel"] as const,
  queue: (slug: string) => [...cfpMeKeys.slug(slug), "queue"] as const,
  review: (slug: string, submissionId: string) =>
    [...cfpMeKeys.slug(slug), "review", submissionId] as const,
};

/**
 * Faza naboru może przejść z `scheduled` w `open` w trakcie wizyty, a strona
 * i tak odczytuje stan z bazy - minuta to kompromis między świeżością a ruchem.
 */
export const CFP_PUBLIC_STALE_MS = 60_000;

/**
 * Czy pokazać pozycję „Nabór prelegentów". `enabled` = `false` do montażu:
 * faza jest czytana WYŁĄCZNIE po stronie klienta (SSR i pierwszy render są
 * identyczne, a HTML z cache krawędzi nie przeżywa zamknięcia naboru).
 */
export function useCfpTabOpen(slug: string, enabled: boolean): boolean {
  const query = useQuery({
    queryKey: cfpPublicKeys.tabOpen(slug),
    queryFn: () => fetchCfpTabOpen(slug),
    enabled: enabled && slug !== "",
    staleTime: CFP_PUBLIC_STALE_MS,
  });
  return query.data === true;
}

/**
 * Panel prelegenta wołającego (`event_my_speaker_panel`). Fetcher przychodzi
 * `import()`-em: gość i uczestnik bez sesji nie pobierają parserów naboru.
 */
export function useSpeakerPanel(
  slug: string,
  enabled: boolean,
): UseQueryResult<SpeakerPanel | null, Error> {
  return useQuery({
    queryKey: cfpMeKeys.panel(slug),
    queryFn: async () => (await import("@/lib/events/cfpPublicApi")).fetchSpeakerPanel(slug),
    enabled: enabled && slug !== "",
    staleTime: 30_000,
  });
}
