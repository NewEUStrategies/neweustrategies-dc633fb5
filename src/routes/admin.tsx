import {
  createFileRoute,
  Outlet,
  useHydrated,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell } from "@/components/admin/AdminShell";
import { isCompactSidebarRoute } from "@/lib/admin/adminNav";
import { AdminShellSkeleton } from "@/components/admin/AdminShellSkeleton";
import { readRememberedSidebarStyle } from "@/lib/admin/sidebarStylePreference";
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
    // `/admin` stoi na `PUBLIC_DOCUMENT_DENY_PREFIXES`, ale deny-lista mówi
    // „nie zapisuj" wyłącznie NASZEMU brzegowi: `planDefaultCacheControl`
    // zwraca dla tych ścieżek `null`, więc odpowiedź wychodziła BEZ ŻADNEGO
    // `Cache-Control` - a brak nagłówka to zaproszenie do heurystyki dowolnego
    // pośrednika. Póki ciało było puste, nie było o co kruszyć kopii; od tej
    // zmiany dokument NIESIE HTML, więc intencja musi być powiedziana wprost.
    setCacheControlHeader(NO_STORE);
    // Rejestruje słownik brakujących kluczy admina/CRM w chunku tras /admin
    // (patrz lib/i18n-admin-extras) - jeden punkt wejścia dla całego panelu.
    // W `beforeLoad`, nie w ciele komponentu: rejestracja jest efektem
    // ubocznym IMPORTU modułu, a to wywołanie jest tylko kotwicą, która trzyma
    // ten import przy trasie. Kotwica w ciele renderu kazała pierwszemu
    // malowaniu panelu czekać na ewaluację 18,6 KB słownika, od którego
    // szkielet (świadomie bez ani jednego napisu) nie zależy.
    ensureAdminExtrasI18n();
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
  // SZEROKOŚĆ PASKA LICZY SIĘ TU WYŁĄCZNIE ZE ŚCIEŻKI. `AdminShell` bierze ją
  // ze wzoru `(trasa edycji || wymuszenie) && brak extrasów || styl "style-4"`;
  // z tych członów serwer zna DOKŁADNIE JEDEN - trasę. Wariant zapamiętany
  // w `localStorage` (`lib/admin/sidebarStylePreference.ts`) jest wiedzą
  // wyłącznie przeglądarki, więc wejście go tutaj byłoby rozjazdem hydratacji,
  // czyli lekarstwem gorszym od choroby: React porzuciłby całe poddrzewo i
  // odmalował je od zera. Doczytuje go pierwszy render PO hydratacji
  // (`AdminSession`), gdzie jest już bezpieczny.
  if (!hydrated)
    return <AdminShellSkeleton hideSidebar={isEventStudio} compact={isCompactSidebarRoute(path)} />;

  return <AdminSession path={path} isEventStudio={isEventStudio} />;
}

/**
 * Część panelu zależna od sesji - montowana WYŁĄCZNIE na kliencie.
 *
 * Osobny komponent, a nie gałąź w `AdminLayout`, bo `useAuth` jest hakiem:
 * warunkowe wywołanie jest niemożliwe, a bezwarunkowe przeciągnęłoby całą
 * ścieżkę sesji (i `localStorage`) z powrotem do renderu serwerowego.
 */
function AdminSession({ path, isEventStudio }: { path: string; isEventStudio: boolean }) {
  const { loading, session, isStaff } = useAuth();
  const navigate = useNavigate();

  // SZEROKOŚĆ PASKA W SZKIELECIE MUSI BYĆ TĄ SAMĄ DECYZJĄ, co w powłoce.
  //
  // Tu, w przeciwieństwie do renderu przedhydratacyjnego wyżej, wolno dołożyć
  // drugi znany człon wzoru: wariant zapamiętany z poprzedniego wejścia.
  // Bez niego najemca ze `style-4` czekałby na sesję przy pasku 224 px, po
  // czym powłoka postawiłaby 48 px - czyli naprawa CLS produkowałaby dokładnie
  // to przesunięcie o 176 px, które `lib/admin/sidebarStylePreference.ts` miało
  // zdjąć. Inicjalizator `useState`, nie odczyt w renderze: wartość ma być
  // stabilna przez cały czas oczekiwania na sesję, a nie przestawiać układ pod
  // wpływem zapisu z innej karty.
  const [rememberedStyle] = useState(() => readRememberedSidebarStyle());
  const skeletonCompact = isCompactSidebarRoute(path) || rememberedStyle === "style-4";

  useEffect(() => {
    if (!loading && (!session || !isStaff)) navigate({ to: "/login" });
  }, [loading, session, isStaff, navigate]);

  // SESJA ROZSTRZYGA SIĘ PO PIERWSZYM MALOWANIU (token w `localStorage`), więc
  // ten stan jest CIĄGIEM DALSZYM ekranu, który przyszedł z serwera - ta sama
  // geometria, inna tylko o doczytany wariant paska. Do tej pory była to jedna
  // wyśrodkowana kropka, którą React zamieniał następnie na całą powłokę:
  // pasek 14 rem, nagłówek, siatka. Wymiana całego układu po ~pół sekundy to
  // najgrubszy pojedynczy wkład do CLS 0,532 zmierzonego na `/admin`.
  if (loading) return <AdminShellSkeleton hideSidebar={isEventStudio} compact={skeletonCompact} />;
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
