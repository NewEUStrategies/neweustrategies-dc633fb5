// DRZEWO TRAS MODUŁU WYDARZEŃ - jeden plik zamiast pięćdziesięciu jeden.
//
// CO TU JEST DOWODZONE. Moduł wydarzeń ma sześćdziesiąt kilka plików tras
// (`src/routes/events*.tsx` + `src/routes/admin.events*.tsx`), w większości
// cienkich owijek `createFileRoute` nad jednym organizmem. Każda z nich ma
// jednak dwa zobowiązania, których sam organizm nie niesie i których `tsc` nie
// sprawdza:
//
//   1. TRASA DAJE SIĘ ZAMONTOWAĆ. `createFileRoute(...)` nie zna swojej ścieżki,
//      dopóki generator drzewa nie doklepie jej `id`/`path`/`getParentRoute` -
//      więc `Route.useParams()`, `validateSearch`, `loader` i `head()` NIE
//      ISTNIEJĄ w teście renderującym sam komponent. Błąd sklejenia (zły wzorzec
//      parametru, `useParams({ from })` wskazujące na cudzą trasę, loader
//      rzucający na kontekst, którego nie dostał) jest dla `tsc` niewidoczny
//      i wychodzi dopiero pod adresem w przeglądarce - jako biała strona.
//
//   2. TRASA NIE ROBI SIĘ BIAŁA. Publiczne trasy zapisu i pakietów mają własną
//      GRANICĘ BŁĘDU. Zdjęta granica nie wywraca budowania i nie rusza żadnego
//      testu komponentu - po prostu awaria formularza zostawia uczestnika na
//      pustym `<main>`, bez zdania i bez wyjścia.
//
// DLACZEGO JEDEN PLIK, A NIE PIĘĆDZIESIĄT JEDEN. Osobny plik na każdą owijkę to
// pięćdziesiąt jeden kompletów atrap opisujących to samo i pięćdziesiąt jeden
// miejsc do poprawienia przy każdej zmianie granicy. Dowód jest dla wszystkich
// tych tras JEDNAKOWY (montuje się / nie montuje), więc mieści się w jednej
// tabeli - a to, co je RÓŻNI, ma własne pliki (patrz „czego nie dubluję").
//
// LISTA JEST BUDOWANA PROGRAMOWO (`import.meta.glob`), NIE PRZEPISANA RĘCZNIE.
// To jest cała wartość tego pliku: tablica literałów starzeje się CICHO - nowa
// trasa dołożona do modułu po prostu do niej nie trafia i nikt się o tym nie
// dowiaduje, bo test dalej jest zielony. Glob nie ma jak przeoczyć pliku, który
// leży w katalogu. Ceną jest to, że adres trzeba WYPROWADZIĆ z nazwy pliku -
// robi to `routePathFromFile`, tą samą regułą, którą stosuje generator
// (`.` rozdziela segmenty, końcowe `index` znika, `_` na końcu segmentu jest
// znacznikiem „nie zagnieżdżaj", a nie częścią adresu). Regułę pilnuje osobny
// przypadek przeciw wartościom przepisanym z `routeTree.gen.ts`, więc rozjazd
// z generatorem nie przejdzie po cichu.
//
// DLACZEGO WSZYSTKIE ORGANIZMY STOJĄ NA ATRAPACH. Nie z wygody, tylko dlatego,
// że inaczej ten plik NIE PRZECHODZI: montaż sześćdziesięciu kilku prawdziwych
// poddrzew panelu w jednym forku zjadł 8 GB sterty i zabił proces (zmierzone
// przed tą wersją - `FATAL ERROR: Reached heap limit`). Atrapa jest przy tym
// zgodna z przedmiotem dowodu: dowodzimy SKLEJENIA trasy, a treść ekranów ma
// własne pliki testowe.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Treści ekranów - każdy organizm ma własny
// plik. (2) Nagłówków `head()` sekcji studia - `adminEventStudioSectionRoutes`
// i pokrewne. (3) Kontraktu adresu samoobsługi zgłoszenia i zaproszenia -
// `eventParticipantRoutes.test.tsx`. (4) Zawartości katalogu i przeglądu -
// `eventsIndexRoute.test.tsx` i `eventSlugIndexRoute.test.tsx` obok.
//
// WZORZEC ATRAP I NAZEWNICTWA przejęty z `eventParticipantRoutes.test.tsx`
// (montaż trasy przez `@/test/routeHarness`, atrapy WYŁĄCZNIE na granicach
// i na komponentach potomnych) oraz z `adminEventStudioSectionRoutes.test.tsx`
// (`RouterLinkStub` w miejsce `<Link>` prowadzącego poza drzewo testowe).
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => {
  /**
   * MODUŁ-ATRAPA: każdy nazwany eksport jest komponentem, który nic nie rysuje.
   *
   * Proxy zamiast wypisanej listy nazw, bo te moduły mają ich łącznie ponad
   * sześćdziesiąt (sam `EventStudioModuleSections` - dwadzieścia dwa), a lista
   * przepisana ręcznie rozjeżdża się przy pierwszym przemianowaniu sekcji
   * i daje wtedy `undefined` zamiast komponentu, czyli czerwień w miejscu,
   * które z przedmiotem dowodu nie ma nic wspólnego.
   *
   * `() => null` wystarcza: ciało komponentu trasy i tak wykonuje się w całości
   * (JSX propsy są wyliczane zanim dziecko cokolwiek narysuje), a to ono jest
   * tutaj przedmiotem dowodu.
   */
  function pustyModul(): Record<string, unknown> {
    const cache = new Map<string, () => null>();
    return new Proxy(
      {},
      {
        get(_target, prop: string | symbol) {
          if (typeof prop !== "string") return undefined;
          if (prop === "__esModule") return true;
          // `then` musi zostać nieokreślone - inaczej `await import(...)`
          // uzna moduł za obietnicę i zawiesi się na własnej atrapie.
          if (prop === "then") return undefined;
          let stub = cache.get(prop);
          if (stub === undefined) {
            stub = () => null;
            cache.set(prop, stub);
          }
          return stub;
        },
        has: () => true,
        ownKeys: () => [],
        getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
      },
    );
  }
  return {
    pustyModul,
    /** Ustawione na `true` każe atrapie ekranu rzucić przy renderze. */
    registrationThrows: false,
    packagesThrows: false,
  };
});

// ── GRANICE ────────────────────────────────────────────────────────────────
// Klient bazy: w tym pliku nie leci ani jedno prawdziwe zapytanie. Łańcuch
// PostgREST i RPC oddają odmowę „brak zaplanowanej odpowiedzi", bo przedmiotem
// dowodu jest MONTAŻ trasy, a nie treść, którą ona pokaże po danych - i trasa
// ma się zamontować także wtedy, gdy backend milczy.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub, supabaseAuthStub, realtimeStub } =
    await import("@/test/supabase");
  const from = supabaseFromStub();
  const rpc = supabaseRpcStub();
  const realtime = realtimeStub();
  return {
    supabase: {
      from: from.from,
      rpc: rpc.rpc,
      auth: supabaseAuthStub(null),
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-community", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-event-front", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Tożsamość: bramka roli ma własne testy, a tutaj każda trasa ma się zamontować
// dla GOŚCIA - to jest stan, w którym crawler i pierwszy czytelnik ją widzą.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, session: null, roles: [], isAdmin: false, isStaff: false }),
}));

// Nagłówek odpowiedzi HTTP to granica serwera - w teście tylko go pochłaniamy.
vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: () => undefined,
  appendLinkHeader: () => undefined,
  readRouteCacheDirective: () => null,
}));

// Atrapa CZĄSTKOWA: `@tanstack/react-start` niesie też `createIsomorphicFn`,
// z którego żyje runtime języka. Podmieniamy sam `useServerFn`.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(),
}));
vi.mock("@/lib/events/rsvp-email.functions", () => ({ confirmFreeRsvpEmail: vi.fn() }));

// `<Link>` w `FriendlyErrorPage` i w kaflach katalogu prowadzi do tras, których
// w drzewie zmontowanym przez harness NIE MA (harness montuje jedną trasę).
// Atrapa zostawia z niego to, co jest przedmiotem dowodu na ekranie awarii:
// dostępny odnośnik z prawdziwym `href`.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// ── KOMPONENTY POTOMNE SPOZA ZAKRESU ───────────────────────────────────────
// Każdy z nich ma własny plik testowy. `FriendlyErrorPage` jest tu JEDYNYM
// wyjątkiem i stoi PRAWDZIWY: to on jest treścią granicy błędu, a dowód brzmi
// „uczestnik dostaje zdanie", więc atrapa unieważniłaby cały ten dowód.
vi.mock("@/components/admin/events/organisms/EventAnalyticsPanel", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventBrandingPanel", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventCreateForm", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventFeaturesPanel", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventGeneralPanel", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventGroupsPermissionsPanel", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventOverviewPanel", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventPagesMenuPanel", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventRegistrationSettingsPanel", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventTypesManager", () => h.pustyModul());
vi.mock("@/components/admin/events/organisms/EventsListManager", () => h.pustyModul());
vi.mock("@/components/admin/events/studio/EventStudioCreateShell", () => h.pustyModul());
vi.mock("@/components/admin/events/studio/EventStudioExternalSection", () => h.pustyModul());
vi.mock("@/components/admin/events/studio/EventStudioModuleSections", () => h.pustyModul());
vi.mock("@/components/admin/events/studio/EventStudioShell", () => h.pustyModul());
vi.mock("@/components/atoms/OptimizedImage", () => h.pustyModul());
vi.mock("@/components/community/AddToCalendar", () => h.pustyModul());
vi.mock("@/components/community/CommunityDisabled", () => h.pustyModul());
vi.mock("@/components/community/EventTicketCard", () => h.pustyModul());
vi.mock("@/components/community/EventTicketPurchase", () => h.pustyModul());
vi.mock("@/components/community/EventsListSkeleton", () => h.pustyModul());
vi.mock("@/components/events/EventSpeakersSection", () => h.pustyModul());
vi.mock("@/components/events/SpeakerProfileDialog", () => h.pustyModul());
vi.mock("@/components/events/molecules/EventRegistrationSurface", () => h.pustyModul());
vi.mock("@/components/events/participant/organisms/EventMePanel", () => h.pustyModul());
vi.mock("@/components/events/public/molecules/EventBookmarkButton", () => h.pustyModul());
vi.mock("@/components/events/public/molecules/EventMetaCard", () => h.pustyModul());
vi.mock("@/components/events/public/molecules/EventModulePage", () => h.pustyModul());
vi.mock("@/components/events/public/molecules/EventVideoHeader", () => h.pustyModul());
vi.mock("@/components/events/public/molecules/SectionLockCard", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventAgendaSection", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventAttendeesList", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventDiscussionsList", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventHomeSectionLinks", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventMenuNav", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventOverviewLayout", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventPageSections", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventPortalShell", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventSpeakersGrid", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventSponsorTiers", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventSponsorsSection", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventTabsNav", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/EventViewerProfile", () => h.pustyModul());
vi.mock("@/components/events/public/organisms/SavedEventsList", () => h.pustyModul());
vi.mock("@/components/events/registration/PackageInviteAccept", () => h.pustyModul());
vi.mock("@/components/events/registration/RegistrationManagePanel", () => h.pustyModul());
vi.mock("@/components/molecules/DegradedDataNotice", () => h.pustyModul());
// NIE `pustyModul()`, i to jest warunek dowodu niżej: ekran błędu rysujący
// NIC jest w tabeli montażu nieodróżnialny od trasy, która wstała poprawnie.
// Atrapa zostawia ślad, bo BRAK tego śladu jest tu przedmiotem dowodu.
vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: () => <div data-testid="granica-bledu" />,
}));
vi.mock("@/components/network/EventGroupButton", () => h.pustyModul());
vi.mock("@/components/profile/AuthGate", () => h.pustyModul());

// Dwa ekrany, na których uczestnik zostawia DANE i PIENIĄDZE - jedyne atrapy
// z zachowaniem. Umieją rzucić na żądanie, bo tylko wtedy widać, czy granica
// błędu trasy naprawdę je łapie.
vi.mock("@/components/events/registration/PublicRegistrationForm", () => ({
  PublicRegistrationForm: ({ slug }: { slug: string }) => {
    if (h.registrationThrows) throw new Error("test: formularz zapisu padł");
    return <div data-testid="ekran-tresci" data-slug={slug} />;
  },
}));

vi.mock("@/components/events/packages/EventPackagesPurchase", () => ({
  EventPackagesPurchase: ({ slug }: { slug: string }) => {
    if (h.packagesThrows) throw new Error("test: ekran pakietów padł");
    return <div data-testid="ekran-tresci" data-slug={slug} />;
  },
}));

const { renderRoute } = await import("@/test/routeHarness");

const SLUG = "kongres-cee-2026";
const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";
/** 24 bajty w base64url - kształt, jaki oddaje `_event_new_qr_token()`. */
const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

/**
 * Wszystkie pliki tras modułu. Glob rozwija Vite w czasie transformacji, więc
 * lista powstaje z KATALOGU, a nie z pamięci autora testu. `__tests__` nie
 * wpada, bo `*` nie przechodzi przez `/`.
 *
 * `eager`, bo podział na trasy Z EKRANEM i trasy PRZEKIEROWUJĄCE musi być znany
 * w chwili zbierania przypadków (`it.each`), a nie dopiero w ich trakcie.
 */
const ROUTE_MODULES: Record<string, unknown> = {
  ...import.meta.glob("../events*.tsx", { eager: true }),
  ...import.meta.glob("../admin.events*.tsx", { eager: true }),
};

const ROUTE_FILES = Object.keys(ROUTE_MODULES).sort();

/**
 * Adres trasy z nazwy pliku - ta sama reguła, którą stosuje `routeTree.gen.ts`.
 * Harness montuje trasę bezpośrednio pod korzeniem zastępczym, więc potrzebuje
 * adresu PEŁNEGO, a nie względnego wobec rodzica, jak w generatorze.
 *
 * KOŃCOWE `index` ZOSTAWIA UKOŚNIK, i to nie jest kosmetyka: identyfikator
 * trasy indeksu w wygenerowanym drzewie brzmi `/events/$slug/`, a przegląd
 * wydarzenia czyta parametry przez `useParams({ from: "/events/$slug/" })`.
 * Zamontowanie go pod `/events/$slug` (bez ukośnika) wywraca render na
 * „Could not find an active match" - czyli test mierzyłby własną literówkę,
 * a nie trasę. Zmierzone przy pierwszym podejściu do tego pliku.
 */
function routePathFromFile(file: string): string {
  const base = file.replace(/^.*\//, "").replace(/\.tsx$/, "");
  const parts = base.split(".");
  const kept = parts.at(-1) === "index" ? [...parts.slice(0, -1), ""] : parts;
  return `/${kept.map((segment) => segment.replace(/_$/, "")).join("/")}`;
}

/** Adres startowy: wzorce parametrów zastąpione wartościami syntetycznymi. */
function entryFor(path: string): string {
  return (
    path
      .replace("$slug", SLUG)
      .replace("$eventId", EVENT_ID)
      .replace("$token", TOKEN)
      // Historia pamięciowa dostaje adres bez końcowego ukośnika - taki, jaki
      // wpisuje czytelnik; router i tak zestawia go z identyfikatorem trasy.
      .replace(/(.)\/$/, "$1")
  );
}

/** Parametry ścieżki, których `beforeLoad` trasy wycofanej może potrzebować. */
const PARAMY = { eventId: EVENT_ID, slug: SLUG, token: TOKEN };

/** Moduł trasy MUSI eksportować `Route` - inaczej generator go nie podniesie. */
function isRouteModule(value: unknown): value is { Route: AnyRoute } {
  return typeof value === "object" && value !== null && "Route" in value;
}

/** STRAŻNIK, nie rzutowanie: warunek sprawdza w runtime, że to komponent. */
function isComponent(value: unknown): value is (props: { error?: unknown }) => ReactNode {
  return typeof value === "function";
}

/** `beforeLoad` w kształcie, którego dotyka dowód o adresach wycofanych. */
type BeforeLoadFn = (ctx: { params: Record<string, string> }) => unknown;

/** STRAŻNIK, nie rzutowanie - bez niego wywołanie idzie po typie `Function`. */
function isBeforeLoad(value: unknown): value is BeforeLoadFn {
  return typeof value === "function";
}

/**
 * TRZY NAPISY, PO KTÓRYCH POZNAJE SIĘ, ŻE TRASA PADŁA - bo moduł ma trzy różne
 * granice błędu i żadna z nich nie wywraca renderu:
 *
 *   * `SLAD_DOMYSLNEJ_GRANICY` - ekran wbudowany w router, który dostaje 59
 *     z 65 tras modułu (te bez własnego `errorComponent`);
 *   * `granica-bledu` (testid wyżej) - `RouteErrorFallback` sześciu tras,
 *     które mają własny ekran;
 *   * `SLAD_PRZYJAZNEGO_EKRANU` - tytuł `FriendlyErrorPage` z warstwy
 *     `errorCopy`, którym kończą się obie powierzchnie płatnicze.
 */
const SLAD_DOMYSLNEJ_GRANICY = "Something went wrong!";
const SLAD_PRZYJAZNEGO_EKRANU = "Nie udało się załadować strony";

function routeOf(file: string): AnyRoute {
  const module = ROUTE_MODULES[file];
  if (!isRouteModule(module)) throw new Error(`test: ${file} nie eksportuje Route`);
  return module.Route;
}

/**
 * PODZIAŁ MODUŁU NA DWA RODZAJE ADRESÓW - i to jest rozróżnienie produktowe,
 * nie techniczne:
 *   * TRASA Z EKRANEM coś rysuje, więc dowodem jest montaż bez rzutu;
 *   * TRASA WYCOFANA nie ma `component` w ogóle i rzuca `redirect()` już
 *     w `beforeLoad` - dowodem jest to, DOKĄD odsyła. Montowanie jej
 *     w harnessie (jedna trasa w drzewie) nie miałoby czego dowieść: cel
 *     przekierowania z definicji leży poza tym drzewem.
 */
const TRASY_Z_EKRANEM = ROUTE_FILES.filter((file) => isComponent(routeOf(file).options.component));
const TRASY_WYCOFANE = ROUTE_FILES.filter((file) => !isComponent(routeOf(file).options.component));

/** Rzut z `beforeLoad` w kształcie, w jakim oddaje go `redirect()`. */
interface RzutPrzekierowania {
  status: number;
  options: { to?: unknown; params?: unknown };
}

/** STRAŻNIK, nie rzutowanie - sprawdza kształt rzutu, zanim go odczytamy. */
function isRedirectThrow(value: unknown): value is RzutPrzekierowania {
  if (value === null || typeof value !== "object") return false;
  if (!("status" in value) || !("options" in value)) return false;
  const { options } = value;
  return options !== null && typeof options === "object";
}

beforeEach(() => {
  h.registrationThrows = false;
  h.packagesThrows = false;
});

afterEach(cleanup);

describe("inwentarz tras modułu wydarzeń", () => {
  it("glob widzi CAŁY moduł, a nie jego resztkę", () => {
    // Bezpiecznik samego mechanizmu. Gdyby wzorzec przestał pasować (przeniesione
    // trasy, inne rozszerzenie), pętle niżej przeszłyby na PUSTEJ liście -
    // zielono i bez jednego dowodu.
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(60);
    expect(ROUTE_FILES).toContain("../events.$slug_.register.tsx");
    expect(ROUTE_FILES).toContain("../events.$slug_.packages.tsx");
    expect(ROUTE_FILES).toContain("../admin.events_.new.tsx");
    expect(ROUTE_FILES.some((file) => file.includes("__tests__"))).toBe(false);
  });

  it("nazwa pliku przekłada się na adres tą samą regułą, co generator drzewa", () => {
    // Cały glob stoi na tej funkcji: gdyby liczyła adres inaczej niż generator,
    // trasy montowałyby się pod adresami, których w produkcji nie ma - a test
    // byłby zielony na fikcji. Wartości oczekiwane pochodzą z `routeTree.gen.ts`
    // (kolumny `path` sklejone z rodzicami).
    expect(routePathFromFile("../events.tsx")).toBe("/events");
    // Trasa indeksu ZACHOWUJE ukośnik - to jest jej identyfikator w drzewie,
    // a przegląd wydarzenia woła po nim `useParams({ from: ... })`.
    expect(routePathFromFile("../events.index.tsx")).toBe("/events/");
    expect(routePathFromFile("../events.$slug.index.tsx")).toBe("/events/$slug/");
    expect(routePathFromFile("../events.$slug_.register.tsx")).toBe("/events/$slug/register");
    expect(routePathFromFile("../events_.invite.$token.tsx")).toBe("/events/invite/$token");
    expect(routePathFromFile("../admin.events_.new.tsx")).toBe("/admin/events/new");
    expect(routePathFromFile("../admin.events_.$eventId.onsite.badges.tsx")).toBe(
      "/admin/events/$eventId/onsite/badges",
    );
  });

  it("KAŻDY plik modułu eksportuje `Route` - inaczej generator go nie widzi", () => {
    // Plik w `src/routes`, który nie eksportuje `Route`, nie jest błędem
    // kompilacji ani lintu: po prostu NIE MA GO w drzewie, więc jego adres
    // oddaje 404. To jedyne miejsce, w którym takie przeoczenie ma prawo wyjść.
    const bezEksportu = ROUTE_FILES.filter((file) => !isRouteModule(ROUTE_MODULES[file]));

    expect(bezEksportu).toEqual([]);
  });

  it("KAŻDY adres modułu coś ROBI: rysuje ekran albo odsyła gdzie indziej", () => {
    // Trasa bez komponentu i bez przekierowania renderuje się jako NIC - to nie
    // jest pusty stan ekranu, tylko adres wyglądający na zepsuty serwis.
    // Podział musi być ROZŁĄCZNY i ZUPEŁNY, więc liczymy go wprost.
    const niema = ROUTE_FILES.filter(
      (file) =>
        !isComponent(routeOf(file).options.component) &&
        typeof routeOf(file).options.beforeLoad !== "function",
    );

    expect(niema).toEqual([]);
    expect(TRASY_Z_EKRANEM.length + TRASY_WYCOFANE.length).toBe(ROUTE_FILES.length);
    expect(TRASY_Z_EKRANEM.length).toBeGreaterThan(TRASY_WYCOFANE.length);
  });
});

describe("montaż każdej trasy modułu - render bez rzutu", () => {
  it.each(TRASY_Z_EKRANEM)("%s montuje się pod swoim adresem", async (file) => {
    // NAJTAŃSZY MOŻLIWY DOWÓD, ale nie pusty: montaż przechodzi przez loader
    // trasy, `validateSearch`, `head()` i pierwszy render komponentu - czyli
    // przez całą warstwę, której test samego organizmu nie dotyka. Trasa, która
    // rzuci w tym miejscu, w przeglądarce daje pod swoim adresem białą stronę.
    //
    // Backend MILCZY (atrapa oddaje odmowę na każde zapytanie) i to jest
    // zamierzone: to najgorszy realny stan startowy, a strona ma się w nim
    // zamontować, nie wywrócić.
    const path = routePathFromFile(file);
    // WŁASNY klient zapytań, czyszczony po montażu. Domyślny `gcTime` trzyma
    // wyniki pięć minut, a ten plik montuje kilkadziesiąt tras w jednym forku -
    // bez tego cache rośnie przez cały przebieg (zmierzone: fork ginął na
    // limicie sterty, zanim doszedł do połowy listy).
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { container, unmount, currentPath } = await renderRoute({
      route: routeOf(file),
      path,
      initialEntry: entryFor(path),
      queryClient,
    });

    // TO NIE JEST DOWÓD: `container` jest `HTMLElement`-em ZAWSZE, także gdy
    // trasa rzuciła - granica błędu łapie rzut i rysuje ekran awarii w tym
    // samym kontenerze. ZMIERZONE sondą na trasie rzucającej w komponencie:
    // `expect(container).toBeInstanceOf(HTMLElement)` przechodzi, a w kontenerze
    // stoi „Something went wrong!Hide Errortrasa padła". Dowodem jest więc
    // ADRES i BRAK ŚLADU którejkolwiek z trzech granic błędu tego modułu.
    expect(currentPath()).toBe(entryFor(path));
    const tresc = container.textContent ?? "";
    expect(tresc).not.toContain(SLAD_DOMYSLNEJ_GRANICY);
    expect(tresc).not.toContain(SLAD_PRZYJAZNEGO_EKRANU);
    expect(screen.queryByTestId("granica-bledu")).toBeNull();

    unmount();
    queryClient.clear();
  });
});

describe("adresy WYCOFANE - martwy odnośnik nie mówi, gdzie szukać", () => {
  it.each(TRASY_WYCOFANE)("%s odsyła tam, gdzie ta praca dziś mieszka", (file) => {
    // Te adresy mogły trafić do zakładek przeglądarki i do zgłoszeń do wsparcia.
    // Usunięcie pliku dałoby 404 („nie ma i nie wiadomo, gdzie szukać"),
    // a przekierowanie stawia redaktora tam, gdzie zaczyna się nowa droga do tej
    // samej funkcji. Musi ono stać w `beforeLoad`, bo w komponencie zdążyłby
    // mignąć pusty ekran z powłoką panelu.
    const beforeLoad: unknown = routeOf(file).options.beforeLoad;
    if (!isBeforeLoad(beforeLoad)) throw new Error(`test: ${file} nie ma beforeLoad`);

    let rzut: unknown = null;
    try {
      beforeLoad({ params: PARAMY });
    } catch (error) {
      rzut = error;
    }

    if (!isRedirectThrow(rzut)) throw new Error(`test: ${file} nie rzuca przekierowania`);
    // 307 zachowuje metodę i NIE jest trwałe: adres wycofany może kiedyś wrócić
    // jako własny ekran, a 301 zostawiłby go w pamięci przeglądarek na zawsze.
    expect(rzut.status).toBe(307);
    expect(typeof rzut.options.to).toBe("string");
    expect(String(rzut.options.to)).toMatch(/^\/admin\/events/);
    // Przekierowanie na SAMEGO SIEBIE to pętla, którą przeglądarka zamyka
    // dopiero komunikatem o zbyt wielu przekierowaniach.
    expect(String(rzut.options.to)).not.toBe(routePathFromFile(file));
    // IDENTYFIKATOR WYDARZENIA MUSI PRZEŻYĆ PRZEKIEROWANIE. Adres wycofany
    // wewnątrz studia prowadzi do innej sekcji TEGO SAMEGO wydarzenia; zgubiony
    // parametr wysyła redaktora pod adres z surowym `$eventId` (404) albo -
    // gorzej - do cudzego wydarzenia, jeśli kiedyś wpadnie tam wartość domyślna.
    if (String(rzut.options.to).includes("$eventId")) {
      expect(rzut.options.params).toEqual({ eventId: EVENT_ID });
    }
  });
});

/**
 * DWIE TRASY PUBLICZNE, NA KTÓRYCH UCZESTNIK ZOSTAWIA DANE I PIENIĄDZE.
 * Opisane danymi, bo różni je wyłącznie adres i komponent treści - a reguła
 * granicy błędu ma być na obu IDENTYCZNA.
 */
const POWIERZCHNIE_PLATNICZE = [
  {
    nazwa: "zapis na wydarzenie",
    plik: "../events.$slug_.register.tsx",
    sciezka: "/events/$slug/register",
    zapalnik: "registrationThrows",
    tytulDokumentu: "Zapis na wydarzenie - New European Strategies",
  },
  {
    nazwa: "pakiety grupowe",
    plik: "../events.$slug_.packages.tsx",
    sciezka: "/events/$slug/packages",
    zapalnik: "packagesThrows",
    tytulDokumentu: "Pakiety grupowe - New European Strategies",
  },
] as const;

describe.each(POWIERZCHNIE_PLATNICZE)(
  "$nazwa - trasa publiczna z granicą błędu",
  ({ plik, sciezka, zapalnik }) => {
    it("podaje ekranowi slug ZE ŚCIEŻKI, a nie z zapytania", async () => {
      // Zgubiony parametr nie wywraca strony - pokazuje CUDZĄ ofertę albo
      // pustkę, która wygląda jak awaria. Uczestnik płaci wtedy za nie to.
      // W adresie stoi CELOWO sprzeczne `?slug=` - odczyt z query zamiast
      // ze ścieżki jest błędem, który da się wywołać z zewnątrz: wystarczy
      // podesłać uczestnikowi odnośnik z doklejonym parametrem.
      const route = routeOf(plik);

      await renderRoute({
        route,
        path: sciezka,
        initialEntry: `${entryFor(sciezka)}?slug=cudze-wydarzenie`,
      });

      await waitFor(() => expect(screen.getByTestId("ekran-tresci")).toBeTruthy());
      expect(screen.getByTestId("ekran-tresci").getAttribute("data-slug")).toBe(SLUG);
    });

    it("awaria ekranu daje CZYTELNY komunikat, a nie pusty `<main>`", async () => {
      // Sedno tego bloku. Bez `errorComponent` rzut z formularza zostawia
      // uczestnika na wyrenderowanym, ale PUSTYM `<main>` - bez zdania, bez
      // przycisku ponowienia i bez wyjścia z powrotem na stronę wydarzenia.
      h[zapalnik] = true;
      const route = routeOf(plik);

      const { container } = await renderRoute({
        route,
        path: sciezka,
        initialEntry: entryFor(sciezka),
      });

      await waitFor(() => expect(screen.queryByTestId("ekran-tresci")).toBeNull());
      // Ekran awarii jest PRAWDZIWY (nie atrapa), więc dowodem jest KONKRETNE
      // zdanie z warstwy `errorCopy` i KONKRETNE wyjścia - nie próg długości
      // tekstu, który spełnia też pierwsze lepsze „coś poszło nie tak".
      expect(screen.getByRole("heading", { level: 2, name: SLAD_PRZYJAZNEGO_EKRANU })).toBeTruthy();
      // Ponowienie: awaria ekranu zapisu bywa jednorazowa (zerwane żądanie),
      // więc uczestnik ma ją móc powtórzyć BEZ przeładowania strony.
      expect(screen.getByRole("button", { name: /Spróbuj ponownie/ })).toBeTruthy();
      // Wyjście na zewnątrz - inaczej ekran awarii jest ślepym zaułkiem.
      expect(screen.getByRole("button", { name: /Strona główna/ })).toBeTruthy();
      expect(screen.getByRole("link", { name: /Skontaktuj się z nami/ }).getAttribute("href")).toBe(
        "/kontakt",
      );
      expect(container.textContent).not.toContain(SLAD_DOMYSLNEJ_GRANICY);
    });

    it("granica błędu NIE POWTARZA poświadczenia z adresu", async () => {
      // Zrzut ekranu awarii ląduje w zgłoszeniu serwisowym razem z całą treścią
      // strony. Wspólny ekran serwisu nie ma powodu echa adresu - i nie ma go.
      h[zapalnik] = true;
      const route = routeOf(plik);

      const { container } = await renderRoute({
        route,
        path: sciezka,
        initialEntry: `${entryFor(sciezka)}?token=${TOKEN}`,
      });

      await waitFor(() => expect(screen.queryByTestId("ekran-tresci")).toBeNull());
      expect(container.textContent).not.toContain(TOKEN);
    });

    it("awaria i nieznany adres kończą się TYM SAMYM ekranem - jednym, nie dwoma", () => {
      // Dwa osobne komponenty to dwa miejsca do poprawienia i dwa brzmienia
      // tego samego zdania. Uczestnik ma w obu wypadkach dokładnie jedną rzecz
      // do zrobienia, więc ekran jest jeden.
      const route = routeOf(plik);

      expect(route.options.errorComponent).toBe(route.options.notFoundComponent);
      expect(isComponent(route.options.errorComponent)).toBe(true);
    });

    it("trasa ma `ssr: false` - ekran zależy od sesji, której serwer nie widzi", () => {
      // Bez tego serwer renderuje ofertę dla GOŚCIA, a przeglądarka po
      // hydratacji podmienia ją na ofertę zalogowanego: mignięcie ceny i stanu
      // miejsc na ekranie, na którym uczestnik podejmuje decyzję zakupową.
      const route = routeOf(plik);
      const options: { ssr?: unknown } = route.options;

      expect(options.ssr).toBe(false);
    });
  },
);

describe("granica błędu jest DECYZJĄ modułu, nie przypadkiem jednej trasy", () => {
  it("obie powierzchnie płatnicze pokazują ten sam ekran awarii co do treści", async () => {
    // Jeden komponent na trasę, ale ta sama treść: rozjazd między nimi znaczy,
    // że jedna z dwóch stron, na których uczestnik zostawia pieniądze, dostała
    // przy okazji zmiany drugiej gorszy (albo żaden) ekran awarii.
    h.registrationThrows = true;
    h.packagesThrows = true;

    const zapis = routeOf("../events.$slug_.register.tsx");
    const pakiety = routeOf("../events.$slug_.packages.tsx");

    const a = await renderRoute({
      route: zapis,
      path: "/events/$slug/register",
      initialEntry: `/events/${SLUG}/register`,
    });
    const tekstZapisu = a.container.textContent ?? "";
    a.unmount();

    const b = await renderRoute({
      route: pakiety,
      path: "/events/$slug/packages",
      initialEntry: `/events/${SLUG}/packages`,
    });

    expect(tekstZapisu).toContain(SLAD_PRZYJAZNEGO_EKRANU);
    expect(b.container.textContent).toBe(tekstZapisu);
  });

  it("obie trasy trzymają formularz POZA wyszukiwarką, a wydarzenie w niej", async () => {
    // Indeksujemy stronę wydarzenia, nie ekran zakupu - inaczej w wynikach
    // wyszukiwania stoi pusty formularz zamiast opisu wydarzenia.
    const { routeMeta } = await import("@/test/routeHarness");

    for (const { plik, tytulDokumentu } of POWIERZCHNIE_PLATNICZE) {
      const wpisy = await routeMeta(routeOf(plik));
      const robots = wpisy.find((wpis) => wpis.name === "robots")?.content;
      expect(robots).toBe("noindex, nofollow");
      // Tytuł DOKŁADNY, a nie „jakiś": zakładka przeglądarki i historia to
      // jedyne miejsca, po których uczestnik odnajduje niedokończony zapis
      // wśród kilkunastu otwartych kart. Tytuł domyślny („New European
      // Strategies" na każdej karcie) czyni je nierozróżnialnymi.
      expect(wpisy.find((wpis) => "title" in wpis)?.title).toBe(tytulDokumentu);
    }
  });
});
