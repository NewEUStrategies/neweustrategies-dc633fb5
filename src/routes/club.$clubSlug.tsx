// Układ JEDNEGO klubu (/club/$clubSlug/*) - miejsce, w którym karta klubu
// jest czytana RAZ na dokument.
//
// PROBLEM, KTÓRY TO ROZWIĄZUJE (audyt CWV 2026-09-20, F09). Czternaście tras
// liściowych modułu robiło w loaderze dokładnie to samo:
//
//   ensureQueryData({ queryKey: clubKeys.bySlug(slug), queryFn: fetchClubBySlug })
//
// czyli pełny round-trip do `club_view` PRZED PIERWSZYM BAJTEM - a jego wynik
// zasilał wyłącznie `head()`. Komponent czyta INNY klucz
// (`clubKeys.bySlugViewer(slug, viewer)`, useClubCatalog.ts), więc ten sam RPC
// leciał DRUGI raz po hydratacji, a SSR oddawał szkielet ładowania. Dokument
// kosztował dwa odczyty tej samej karty i nie niósł ani jednego jej pola.
//
// Układ grzeje DOKŁADNIE TEN klucz, który czyta komponent dla widza
// ANONIMOWEGO - a dokument SSR jest z konstrukcji anonimowy (sesja mieszka
// w localStorage, patrz doktryna cache'u w lib/http/cachePolicy.ts). Skutki:
//   * jeden odczyt `club_view` na dokument zamiast dwóch;
//   * `useClubBySlug` widzi dane W PIERWSZYM RENDERZE (dla anonima klucz jest
//     ten sam), więc SSR oddaje KARTĘ KLUBU, a nie szkielet;
//   * zalogowany czytelnik dostaje po hydratacji własny klucz z widzem -
//     to jest zamierzone i opisane przy `clubKeys.bySlugViewer`.
//
// BEZ 404 Z TEGO LOADERA. `club_view` oddaje ANONIMOWI wyłącznie kluby
// `public` + `active` (migracja A19), a dokument SSR jest z konstrukcji
// anonimowy - zero wierszy nie znaczy więc „klubu nie ma”, tylko „nie dla
// anonima”. Twarde 404 wypisywałoby z indeksu (i z zakładek członków) każdy
// klub `members`/`private`/`secret`. Rozstrzygnięcie „klub nie istnieje” należy
// do komponentu, który po hydratacji czyta klucz Z WIDZEM (`ClubHubRoute` ma
// już miękką gałąź `club === null`, HTTP 200).
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { fetchClubBySlug } from "@/lib/clubs/publicClub";
import { toClubHeadSource } from "@/lib/clubs/clubHead";
import { clubCoverPreload } from "@/lib/clubs/clubCoverPreload";
import type { ClubViewRow } from "@/lib/clubs/types";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { appendLinkHeader, setCacheControlHeader } from "@/lib/http/responseHeaders";
import { imagePreloadLink, imagePreloadLinkHeaderValue } from "@/lib/seo/meta";

/**
 * Budżet karty klubu przed pierwszym bajtem. Świadomie KRÓTKI: karta jest
 * jedynym round-tripem tego dokumentu, a jej brak nie blokuje renderu -
 * `useClubBySlug` dociągnie ją po hydratacji. Lepiej oddać dokument w 800 ms
 * z pustą kartą niż trzymać czytelnika 4 s na domyślnym budżecie loadera.
 */
const CLUB_CARD_BUDGET_MS = 800;

export const Route = createFileRoute("/club/$clubSlug")({
  loader: async ({ context, location, params }) => {
    const card = await loadResilient<ClubViewRow | null>(
      context.queryClient,
      {
        // TEN SAM klucz, który czyta komponent dla widza anonimowego - inaczej
        // rozgrzewka zasila wyłącznie nagłówek, a ciało strony i tak pyta bazę.
        queryKey: clubKeys.bySlugViewer(params.clubSlug, null),
        queryFn: () => fetchClubBySlug(params.clubSlug),
      },
      null,
      { deadlineAt: Date.now() + CLUB_CARD_BUDGET_MS, label: `club:${params.clubSlug}` },
    );
    // `no-store` należy się DWÓM sytuacjom przejściowym: renderowi zdegradowanemu
    // i brakowi wiersza (klub niepubliczny albo opublikowany minutę po wizycie
    // crawlera - wzór: category.$slug.tsx). Czysta karta publiczna zostaje przy
    // polityce treści.
    setCacheControlHeader(resilientCacheControl(card.degraded || card.data === null));
    // ZDEGRADOWANY ODCZYT MUSI ZOSTAWIĆ CACHE PUSTY. `loadResilient` zasiewa
    // fallback (`null`, `updatedAt: 0`), bo jego typowy konsument to
    // `useSuspenseQuery` - tu konsumentem jest zwykłe `useQuery`
    // (`useClubBySlug`), dla którego `data === null` znaczy „klubu nie ma"
    // i rysuje kartę „klub nie istnieje". Każda czkawka bazy wyglądałaby więc
    // jak usunięty klub. Po usunięciu wpisu komponent wraca do stanu `pending`
    // (szkielet) i sam pobiera kartę po hydratacji - dokument i tak leci
    // `private, no-store`, więc nikt inny tej pustki nie zobaczy.
    if (card.degraded) {
      context.queryClient.removeQueries({
        queryKey: clubKeys.bySlugViewer(params.clubSlug, null),
        exact: true,
      });
    }
    // Brak wiersza (czysty albo zdegradowany) oddaje `null` i renderuje się
    // dalej - patrz nagłówek pliku; nagłówek dokumentu dostał już `no-store`.
    const club = card.data;

    // HINT LCP wyłącznie tam, gdzie okładka NAPRAWDĘ jest elementem LCP -
    // regułę i jej dowód trzyma `clubCoverPreload` (hub klubu za bramką
    // dostępu). Bezwarunkowy preload byłby na klubie otwartym pobraniem pliku,
    // którego nikt nie maluje.
    const preload = clubCoverPreload(club, location.pathname);
    if (preload) appendLinkHeader(imagePreloadLinkHeaderValue(preload));

    return { club: toClubHeadSource(club), coverPreload: preload };
  },
  // Nagłówek `Link` wyprzedza parsowanie dokumentu (i bywa odtworzony jako 103
  // Early Hint), a `<link>` w dokumencie działa też przy nawigacji po stronie
  // klienta i w podglądzie zapisanego HTML-a. Obie drogi niosą TĘ SAMĄ wartość,
  // więc przeglądarka rozstrzyga jedno pobranie, nie dwa. Meta tras liściowych
  // scalają się z tym nagłówkiem - `links` zbierane są ze WSZYSTKICH dopasowań.
  head: ({ loaderData }) => ({
    links: loaderData?.coverPreload ? [imagePreloadLink(loaderData.coverPreload)] : [],
  }),
  component: ClubSlugLayout,
});

/** Sam `<Outlet/>`: układ istnieje dla LOADERA, a nie dla własnej powłoki -
 *  ramę strony rysuje każda powierzchnia z osobna (hub albo
 *  `ClubWorkspaceLayout`). */
function ClubSlugLayout() {
  return <Outlet />;
}
