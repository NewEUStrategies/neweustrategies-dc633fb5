import {
  createFileRoute,
  Outlet,
  useHydrated,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminShellSkeleton } from "@/components/admin/AdminShellSkeleton";
import { sidebarStyleFromSettings } from "@/components/admin/adminShellGeometry";
import { readRememberedSidebarStyle } from "@/lib/admin/sidebarStylePreference";
import type { SidebarStyle } from "@/lib/builder/sidebarStyles";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { isEventStudioPath } from "@/lib/events/eventStudioNav";
import { ensureI18n as ensureAdminExtrasI18n } from "@/lib/i18n-admin-extras";
import { cacheControlHeader } from "@/lib/http/cachePolicy";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import adminCss from "@/admin-styles.css?url";

/** Polityka dokumentu panelu - stała modułu, żeby nie liczyć jej co żądanie. */
const NO_STORE = cacheControlHeader({ cacheable: false });

export const Route = createFileRoute("/admin")({
  // SSR SZKIELETU, NIE PANELU (audyt CWV 2026-09-20: F32, plan 3.13).
  //
  // Stało tu `ssr: false` z jednym uzasadnieniem: sesja Supabase żyje
  // w `localStorage`, więc serwerowy render czegokolwiek, co od niej zależy,
  // jest gwarantowanym rozjazdem hydratacji. Uzasadnienie było prawdziwe, ale
  // płaciliśmy za nie CAŁYM dokumentem, nie tylko powłoką panelu:
  //   * ciało przychodziło puste do końca bootu (~570 kB gzip),
  //   * `head()` trasy NIE BIEGŁ na serwerze - router ładuje chunk trasy
  //     wyłącznie dla dopasowań `ssr === true` (`router-core/load-server.js`,
  //     `loadNormalChunks`), więc `admin-styles.css` (12,6 KB, render-blocking)
  //     odkrywała przeglądarka dopiero PO zhydratowaniu bootu, szeregowo.
  // Zmierzone na produkcji: FCP p75 4,52 s i CLS 0,53-0,68, czyli najgorsze
  // wartości w całym produkcie.
  //
  // ROZCIĘCIE: SSR wraca, ale serwer renderuje WYŁĄCZNIE `AdminShellSkeleton`
  // w wariancie, który nie zna ani sesji, ani `localStorage` - jego jedynym
  // wejściem jest ścieżka z URL-a. Wszystko, co zależy od sesji (`useAuth`,
  // przekierowanie na `/login`, `AdminShell`, `<Outlet/>`), montuje się za
  // bramką `useHydrated()`, czyli dopiero PO hydratacji. SSR-owy HTML i
  // pierwszy render klienta są więc identyczne Z KONSTRUKCJI, a nie z
  // ostrożności - dowód w `src/routes/__tests__/adminRouteSsr.test.tsx`.
  //
  // `ssr: 'data-only'` (dostępne w tej wersji routera) NIE jest alternatywą:
  // ten wariant biegnie loaderami na serwerze, ale komponentu nie renderuje -
  // czyli oddaje dokładnie to puste ciało, które jest przedmiotem naprawy.
  beforeLoad: () => {
    // DOKUMENT PANELU NIE MA PRAWA UTRWALIĆ SIĘ W ŻADNYM CACHE'U.
    //
    // `/admin` stoi na `PUBLIC_DOCUMENT_DENY_PREFIXES`; od 2026-09-20 deny-lista
    // w `planDefaultCacheControl` nadaje już jawne `private, no-store` (wcześniej
    // zwracała `null`, czyli odpowiedź szła BEZ `Cache-Control`). Trasa deklaruje
    // tę samą intencję wprost, żeby nie zależeć od kolejności middleware: od tej
    // zmiany dokument NIESIE HTML szkieletu, więc zakaz musi stać na drucie
    // niezależnie od tego, która warstwa go wypowie pierwsza.
    setCacheControlHeader(NO_STORE);
    // KOTWICY SŁOWNIKA ADMINA TU NIE MA - I NIE WOLNO JEJ TU WRÓCIĆ.
    // Powód i miejsce docelowe: `AdminSession` niżej. Bramka:
    // `i18n-admin-extras` w `HEAVY_DICTIONARIES` (scripts/check-entry-purity.ts).
  },
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Admin" }],
    links: [{ rel: "stylesheet", href: adminCss }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const hydrated = useHydrated();

  // STUDIO WYDARZENIA WYMIENIA CALA RAME PANELU, nie tylko tresc.
  //
  // Na czas pracy nad jednym wydarzeniem lewy pas nalezy do TEGO wydarzenia
  // (dwupoziomowa nawigacja: pulpit, kreator wydarzenia, rejestracja, tresc,
  // spotkania, na miejscu... - blisko trzydziestu podstron), a nie do panelu.
  // Dwa sidebary obok siebie zabralyby polowe szerokosci formularzowi
  // o osiemnastu polach i nie odpowiadaly by na pytanie „ktore wydarzenie mam
  // w reku".
  //
  // TA JEDNA LINIA DECYDUJE O DWOCH SIDEBARACH. `isEventStudioPath` musi
  // rozpoznawac WSZYSTKIE adresy studia: jednosegmentowe, dwusegmentowe
  // (`.../registration/tickets`), adresy grup (`.../onsite`, przekierowywane na
  // pierwsze dziecko), goly identyfikator ORAZ KREATOR (`/admin/events/new`).
  // Adres studia, ktorego ta funkcja nie zna, dostaje powloke panelu Z JEJ
  // WLASNYM sidebarem obok sidebara wydarzenia - i dokladnie to dzialo sie
  // z kreatorem, dopoki pytalismy tu o SEKCJE zamiast o przynaleznosc do studia.
  //
  // Bramka logowania i roli ZOSTAJE w tym pliku (patrz `AdminSession` nizej) -
  // dlatego studio jest nadal dzieckiem `/admin`, a nie osobnym drzewem tras.
  // Wymieniamy tylko powloke wizualna.
  const isEventStudio = isEventStudioPath(path);

  // PIERWSZY EKRAN PANELU POWSTAJE NA SERWERZE I NIE ZNA NICZEGO POZA URL-em.
  //
  // `useHydrated()` (z routera) oddaje `false` w renderze serwerowym ORAZ
  // w pierwszym renderze klienta, a `true` dopiero w renderze po hydratacji -
  // to ten sam `useSyncExternalStore`, na którym stoi `<ClientOnly>`. Dzięki
  // temu drzewo porównywane przez React przy hydratacji jest bit w bit tym,
  // które wyszło z serwera, i React nie porzuca serwerowego poddrzewa.
  //
  // SZEROKOŚĆ PASKA MA DWA WEJŚCIA, KTÓRE SERWER ZNA: ścieżkę i USTAWIENIA.
  //
  // `AdminShell` bierze ją ze wzoru `(trasa edycji || wymuszenie) && brak
  // extrasów || styl "style-4"`. Do 2026-09-21 serwer znał z tych członów
  // DOKŁADNIE JEDEN - trasę - i to właśnie kosztowało najemcę ze `style-4`
  // przesunięcie 176 px: szkielet rezerwował 224 px, a powłoka stawiała po
  // hydratacji pasek zwinięty. Drugi człon nie jest jednak wiedzą wyłącznie
  // przeglądarki: `theme_options` siedzi w mapie `site_settings`, którą loader
  // korzenia rozgrzewa TAKŻE na `/admin` (`lib/routing/clientOnlyDocument.ts`
  // trzyma dla tej ścieżki własny, krótki termin) i która jedzie do klienta
  // zdehydratowana razem z dokumentem. Odczyt z cache'u daje więc na serwerze
  // i w pierwszym renderze klienta TĘ SAMĄ wartość - nie ma z czego zrobić
  // rozjazdu hydratacji.
  //
  // Wariantem zapamiętanym w `localStorage` (`lib/admin/sidebarStylePreference.ts`)
  // ten render nadal NIE ZARZĄDZA - to jest wiedza wyłącznie przeglądarki,
  // której serwer nie ma jak powtórzyć. Doczytuje go dopiero `AdminSession`,
  // i tylko wtedy, gdy ustawienia nie zdążyły dojechać do SSR.
  const ssrSidebarStyle = useSsrSidebarStyle();

  if (!hydrated)
    return (
      <AdminShellSkeleton path={path} hideSidebar={isEventStudio} sidebarStyle={ssrSidebarStyle} />
    );

  return (
    <AdminSession path={path} isEventStudio={isEventStudio} ssrSidebarStyle={ssrSidebarStyle} />
  );
}

/**
 * Wariant paska ROZSTRZYGNIĘTY PRZED HYDRATACJĄ - z cache'u zapytań, bez sieci.
 *
 * DLACZEGO `getQueryState`, A NIE `useQuery`. Ten odczyt ma być STABILNY przez
 * całe okno przedhydratacyjne: subskrypcja przerysowałaby szkielet w chwili,
 * gdy odpowiedź ustawień dojedzie, czyli sama wyprodukowałaby przesunięcie,
 * które ten kod zdejmuje. Bez subskrypcji render jest funkcją stanu cache'u
 * z momentu montażu - a ten jest po obu stronach hydratacji identyczny.
 *
 * DLACZEGO `dataUpdatedAt > 0`. Loader korzenia ZASIEWA pustą mapę ustawień
 * z `updatedAt: 0`, gdy fala 1 nic nie dowiozła. Taki zasiew jest
 * PRZETERMINOWANY z premedytacją; potraktowanie go jako rozstrzygnięcia
 * kazałoby szkieletowi rezerwować geometrię wyprowadzoną z wbudowanych
 * domyślnych zamiast przyznać się do niewiedzy. Ta sama doktryna, co
 * `hasSsrQueryData` w warstwie SSR i `settingsResolved` w `AdminShell`.
 */
function useSsrSidebarStyle(): SidebarStyle | null {
  const queryClient = useQueryClient();
  const state = queryClient.getQueryState(siteSettingsQueryOptions.queryKey);
  if (state?.status !== "success" || state.dataUpdatedAt === 0) return null;
  return sidebarStyleFromSettings(state.data);
}

/**
 * Część panelu zależna od sesji - montowana WYŁĄCZNIE na kliencie.
 *
 * Osobny komponent, a nie gałąź w `AdminLayout`, bo `useAuth` jest hakiem:
 * warunkowe wywołanie jest niemożliwe, a bezwarunkowe przeciągnęłoby całą
 * ścieżkę sesji (i `localStorage`) z powrotem do renderu serwerowego.
 */
function AdminSession({
  path,
  isEventStudio,
  ssrSidebarStyle,
}: {
  path: string;
  isEventStudio: boolean;
  /** Wariant znany już serwerowi; `null` = ustawienia nie zdążyły dojechać. */
  ssrSidebarStyle: SidebarStyle | null;
}) {
  // KOTWICA SŁOWNIKA ADMINA - W CZĘŚCI PO HYDRATACJI, NIGDY W `beforeLoad`.
  //
  // MECHANIZM. Rejestracja kluczy jest efektem ubocznym IMPORTU modułu
  // `lib/i18n-admin-extras`, a to wywołanie jest wyłącznie kotwicą, która ten
  // import przy czymś trzyma. O tym, DO KTÓREGO CHUNKU słownik trafi, decyduje
  // więc chunk wołającego - i tu jest cała różnica: `beforeLoad` (razem
  // z `loader`, `head`, `params`) należy do NIEDZIELONEJ części pliku trasy,
  // bo splitter TanStacka wynosi do osobnego chunku tylko `component`.
  // Niedzielona część jedzie w chunku WEJŚCIOWYM, czyli kotwica w `beforeLoad`
  // dokładała 67,8 kB źródeł (18,4 KB gzip) słownika PANELU do bundla KAŻDEJ
  // strony publicznej - kodu, którego anonimowy czytelnik nigdy nie wykona.
  //
  // POWÓD, DLA KTÓREGO TO NIE JEST COFNIĘCIE F32. Tamta zmiana nie chciała
  // „kotwicy w beforeLoad" - chciała, żeby PRZEDHYDRATACYJNY szkielet panelu
  // (świadomie bez ani jednego napisu) nie czekał na ewaluację słownika.
  // `AdminLayout` montuje `AdminSession` dopiero za bramką `useHydrated()`,
  // więc ten warunek jest spełniony tak samo jak dotąd: szkielet, który wychodzi
  // z serwera i z pierwszego renderu klienta, tej linii nie wykonuje
  // (przypina to test „nie woła rejestracji słownika w renderze").
  //
  // POMIAR (2026-09-21, pełny build obu stron na jednym hoście): chunk
  // wejściowy main 284,3 KB gzip -> gałąź 295,4 KB (próg 286, bramka czerwona)
  // -> po tej zmianie 275,4 KB; domknięcie bootu 575,0 -> 555,0 KB.
  ensureAdminExtrasI18n();
  const { loading, session, isStaff } = useAuth();
  const navigate = useNavigate();

  // WARIANT PASKA W SZKIELECIE MUSI BYĆ TĄ SAMĄ DECYZJĄ, co w powłoce.
  //
  // KOLEJNOŚĆ ŹRÓDEŁ JEST TU CAŁĄ TREŚCIĄ. Ustawienia rozstrzygnięte w SSR są
  // tym samym źródłem, z którego `AdminShell` policzy za chwilę swój pasek,
  // więc mają pierwszeństwo; pamięć przeglądarki jest tylko domysłem
  // z POPRZEDNIEGO wejścia i bywa nieaktualna (najemca zmienił styl na innym
  // urządzeniu). Sięgamy po nią WYŁĄCZNIE wtedy, gdy fala 1 loadera korzenia
  // nie dowiozła ustawień - bo wtedy jedynym wyborem jest 224 px z fallbacku
  // albo zapamiętane 48 px, a to drugie trafia częściej.
  //
  // Inicjalizator `useState`, nie odczyt w renderze: wartość ma być stabilna
  // przez cały czas oczekiwania na sesję, a nie przestawiać układ pod wpływem
  // zapisu z innej karty.
  const [rememberedStyle] = useState(() => readRememberedSidebarStyle());
  const skeletonStyle = ssrSidebarStyle ?? rememberedStyle;

  useEffect(() => {
    if (!loading && (!session || !isStaff)) navigate({ to: "/login" });
  }, [loading, session, isStaff, navigate]);

  // SESJA ROZSTRZYGA SIĘ PO PIERWSZYM MALOWANIU (token w `localStorage`), więc
  // ten stan jest CIĄGIEM DALSZYM ekranu, który przyszedł z serwera - ta sama
  // geometria, inna tylko o doczytany wariant paska. Do tej pory była to jedna
  // wyśrodkowana kropka, którą React zamieniał następnie na całą powłokę:
  // pasek 14 rem, nagłówek, siatka. Wymiana całego układu po ~pół sekundy to
  // najgrubszy pojedynczy wkład do CLS 0,532 zmierzonego na `/admin`.
  if (loading)
    return (
      <AdminShellSkeleton path={path} hideSidebar={isEventStudio} sidebarStyle={skeletonStyle} />
    );
  // Brak uprawnień: świadomie NIC - efekt wyżej nawiguje na /login, a
  // szkielet panelu pokazywany osobie spoza redakcji byłby obietnicą ekranu,
  // którego nigdy nie zobaczy.
  if (!session || !isStaff) return null;

  if (isEventStudio) return <Outlet />;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
