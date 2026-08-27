// BRAMKA CI: REDAKCYJNE NADPISANIE NAGŁÓWKA SEKCJI DZIAŁA W KAŻDYM MIEJSCU,
// KTÓRE TEN NAGŁÓWEK RYSUJE.
//
// ── CO BYŁO MARTWE (POLICZONE, NIE ZGADYWANE) ──────────────────────────────
// `event_page_sections.heading_pl` / `heading_en` to przełącznik w panelu
// organizatora: „nazwij tę sekcję po swojemu". RPC `event_sections` oddaje go
// wprost, a `EventSection.headingPl/En` go niesie. Nagłówek sekcji wydarzenia
// ma na froncie PIĘĆ MIEJSC RYSOWANIA w TRZECH plikach - i nadpisanie czytało
// JEDNO z nich (`EventPageSections`, czyli pięć sekcji bez własnego kodu).
// Cztery pozostałe brały napis WPROST ze słownika (`t(sectionHeadingKey(...))`):
//   * `description` - nadpisanie widzieli WYŁĄCZNIE goście bez dostępu, bo
//     nagłówek nad kartą zamka rysuje trasa, a opis otwarty nagłówka nie ma,
//   * `speakers` - nadpisanie było niewidoczne w OBU gałęziach: trasa rysowała
//     nagłówek ze słownika nad zamkiem, a `EventSpeakersSection` dostawał tylko
//     `eventId` i `lang`, więc wiersza sekcji nie widział w ogóle,
//   * `registration` - nazwę tej sekcji niesie DOSTĘPNA NAZWA GRUPY bloku
//     zapisów (`EventRegistrationSurface`, `role="group"` + `aria-label`), i ona
//     też szła ze słownika: organizator zmieniał „Zapisy" na „Rejestracja
//     delegatów", a czytnik ekranu ogłaszał starą nazwę.
// TRZY SEKCJE, CZTERY MARTWE MIEJSCA - i to jest cały rachunek: `description`
// (jedno miejsce), `speakers` (dwa: trasa dla zamku, komponent dla sekcji
// otwartej) i `registration` (jedno). Pozostałe pięć sekcji z
// `EVENT_SECTION_KEYS` (`agenda`, `sponsors`, `materials`, `map`, `contact`)
// rysuje `EventPageSections`, czyli ten jeden renderer, który nadpisanie czytał
// od początku i z którego mechanizm został wyjęty do wspólnego selektora.
//
// ── SPRAWDZONE: SPISY NA PRZEGLĄDZIE NIE NAZYWAJĄ SEKCJI ───────────────────
// Pułapka, którą trzeba było rozstrzygnąć dowodem, a nie domysłem: gdyby spis
// treści na stronie pokazywał NAZWY SEKCJI, redakcja po zmianie nagłówka
// dostałaby dwie różne nazwy tej samej sekcji na jednej stronie. Nie pokazuje.
// Trzy spisy przeglądu - `EventHomeSectionLinks` (treść strony głównej),
// `EventMenuNav` (`pages_display_mode`) i `EventTabsNav` (pasek powłoki) -
// czytają `event_menu`, czyli PODSTRONY (`event_pages.menu_label_*`), i już
// jadą przez `pickLocalized` na własnej parze kolumn. To inna tabela, inny
// słownik nazw i inne nadpisanie; `eventFront.header.tabs.*` jest tam
// wartością zapasową dla pozycji modułowej, a nie nagłówkiem sekcji. Dlatego
// żaden z nich nie wchodzi do rodziny liczonej niżej - i gdyby wszedł, zrobiłby
// to sam, bo rodzina jest liczona z wołań selektora, nie z listy nazw.
//
// ── DLACZEGO BRAMKA, A NIE TRZY TESTY PUNKTOWE ─────────────────────────────
// Klasa defektu jest tu ważniejsza od trzech wystąpień: „powierzchnia rysuje
// nagłówek sekcji sama, ze słownika, obok modelu sekcji". Test punktowy na
// `description` nie zapala się przy piątej powierzchni dopisanej w przyszłym
// kwartale - a to ona będzie następnym martwym przełącznikiem w panelu.
// Dlatego mierzymy DWIE rzeczy naraz:
//   (1) ZACHOWANIE - każda pokryta powierzchnia dostaje wiersz sekcji
//       z nadpisaniem i MUSI je pokazać; ta sama powierzchnia bez nadpisania
//       MUSI pokazać napis ze słownika (inaczej „nadpisanie działa" spełniałby
//       też renderer, który pokazuje nadpisanie ZAWSZE, także puste);
//   (2) STRUKTURĘ - obejście selektora jest niemożliwe, bo fallback ze słownika
//       istnieje w jednym miejscu.
//
// ── DOWÓD UPADKU (nie sama zieleń) ─────────────────────────────────────────
// Zmierzone, nie obiecane - każdy z trzech starych kodów wrócił na chwilę do
// drzewa i bramka powiedziała, KTÓRY plik zawinił:
//   * `<h2>{t(sectionHeadingKey("speakers"))}</h2>` z powrotem
//     w `EventSpeakersSection` -> CZTERY czerwienie naraz: „słownikowy klucz
//     nagłówka woła WYŁĄCZNIE wspólny selektor" z
//     `["src/components/events/EventSpeakersSection.tsx"]`, „każda POKRYTA
//     powierzchnia nadal woła selektor z tej ścieżki" z tą samą nazwą oraz oba
//     dowody zachowania (`["eventFront.sections.speakers.heading"]` w miejscu
//     nadpisania - i to samo z trasy, która wiersz sekcji przekazuje);
//   * `groupLabel={t("eventFront.sections.registration.heading")}` z powrotem
//     w trasie -> „żaden plik nie składa klucza nagłówka RĘCZNIE" z
//     `["src/routes/events.$slug.index.tsx"]` (regexp łapie LITERAŁ klucza,
//     a nie wołanie funkcji, więc ta druga furtka też jest zamknięta) plus
//     dowód zachowania trasy: trzeci napis został kluczem, dwa pierwsze nie;
//   * czwarte wołanie selektora dopisane poza `COVERED_SURFACES`
//     (w `EventMaterialsSection`) -> „każde miejsce rysowania jest albo
//     POKRYTE, albo ma jawny powód" z nazwą tego pliku.
//
// ── RODZINA POWIERZCHNI JEST LICZONA, NIE WYPISANA ─────────────────────────
// Ta sama lekcja, co w `eventSpeakerFactParity.gate.test.tsx` i w EB-912
// (`timezoneAdoption`): ręcznie wypisana lista plików przepuściła dług
// przeniesiony podziałem trasy. Zbiór miejsc rysujących nagłówek jest tu
// LICZONY z drzewa `src` (kto woła `eventSectionHeading`), a wpisane ręcznie
// są wyłącznie POKRYTE powierzchnie i jawne wyjątki - sprawdzane względem
// zbioru policzonego w OBIE strony. Wpis w `COVERED_SURFACES` bez renderera się
// nie skompiluje, więc nowa ścieżka wchodzi do dowodu ZACHOWANIA razem
// ze ścieżką.
//
// ── ŹRÓDŁO CZYTAMY BEZ KOMENTARZY ──────────────────────────────────────────
// Asercje na treści źródła zapaliłyby się na własnym opisie: ten plik MUSI
// cytować `t(sectionHeadingKey(...))` i literał klucza, bo inaczej nikt nie wie,
// czego bramka pilnuje. `withoutComments()` odcina komentarze ze SKANOWANYCH
// plików produkcyjnych - `EventSpeakersSection.tsx` i `eventSections.ts` opisują
// w nagłówkach dokładnie ten dług, więc bez odcięcia liczyłyby się przez opis.
// Ten plik do skanu nie wchodzi (katalog `__tests__`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  /** Wiersze `event_sections` dla trasy - podmieniane per pomiar. */
  sections: [] as unknown[],
  /** Wiersze prelegentów dla zapowiedzi na przeglądzie. */
  speakers: [] as unknown[],
  /** Nadpisania migawki wydarzenia - potrzebne, żeby postawić wydarzenie
   *  PŁATNE, bo o tym, którą kontrolkę zapisu rysuje trasa, decyduje cena. */
  event: {} as Record<string, unknown>,
  /**
   * Zalogowany uczestnik albo `null`. Do gałęzi PŁATNEJ nie da się dojść bez
   * zalogowania i to nie jest szczegół atrapy: `resolveRegistrationSurface`
   * dostaje `isSignedIn` i dla gościa oddaje wariant „zaloguj się", który
   * `isLegacyRsvpDecision` odrzuca - czyli trasa rysuje wtedy kontrolkę
   * BEZPŁATNĄ. Pierwsza wersja tego testu tego nie uwzględniała i przechodziła
   * także z odłożoną naprawą, bo mierzyła nie tę gałąź.
   */
  user: null as { id: string } | null,
}));

// `t` oddaje KLUCZ, nie tłumaczenie: „napis ze słownika" rozpoznajemy po
// kształcie klucza, więc zmiana brzmienia nagłówka w słowniku nie oblewa bramki
// o NADPISANIU. Że klucze naprawdę istnieją w obu słownikach, dowodzi kanarek.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/integrations/supabase/client", () => {
  // Łańcuch PostgREST dokładnie na głębokość zapytania o WŁASNY RSVP
  // (`from().select().eq().eq().maybeSingle()`). Dla gościa to zapytanie nie
  // startuje (`enabled: !!user`), więc do gałęzi płatnej - która wymaga
  // zalogowania - pusty obiekt już nie wystarcza.
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null }),
  };
  return { supabase: { from: () => chain } };
});

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakersQueryOptions: (input: unknown, lang: unknown) => ({
    queryKey: ["speakers", JSON.stringify(input), lang],
    queryFn: () => h.speakers,
  }),
}));

// Dialog profilu to powierzchnia JEDNEJ OSOBY i ma własne testy - tutaj jest
// atrapą, bo do dowodu o NAGŁÓWKU nie wnosi nic, a wnosi Radix i zapytanie.
vi.mock("@/components/events/SpeakerProfileDialog", () => ({
  SpeakerProfileDialog: () => null,
}));

// ── ATRAPY WARSTWY DANYCH TRASY PRZEGLĄDU ──────────────────────────────────
// Atrapa CZĄSTKOWA (`importOriginal`), a nie własny obiekt: `usePublicEvent`
// importuje z tego modułu czternaście nazw, a lista przepisana ręcznie gnije
// przy pierwszej nowej powierzchni. Podmieniamy wyłącznie pobrania.
vi.mock("@/lib/events/publicEventApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/publicEventApi")>()),
  fetchEventSections: vi.fn(async () => h.sections),
  fetchEventMenu: vi.fn(async () => []),
  fetchEventAgenda: vi.fn(async () => []),
  fetchEventSponsors: vi.fn(async () => []),
  fetchEventSponsorMaterials: vi.fn(async () => []),
  fetchMyBookmarks: vi.fn(async () => []),
}));

vi.mock("@/lib/community/publicQueries", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/community/publicQueries")>();
  const { publicEventRow } = await import("@/test/events/publicEventRow");
  const { eventPageHeaderRow } = await import("@/test/events/eventPageHeaderRow");
  return {
    ...original,
    fetchPublicEventBySlug: vi.fn(async () => publicEventRow(h.event)),
    fetchEventPageHeader: vi.fn(async () => eventPageHeaderRow()),
    fetchEventAccess: vi.fn(async () => null),
    fetchEventRsvpCounts: vi.fn(async () => new Map()),
    fetchEventWaitlistPosition: vi.fn(async () => null),
    rsvpEvent: vi.fn(),
  };
});

// Atrapa CZĄSTKOWA: `@tanstack/react-start` niesie też `createIsomorphicFn`,
// z którego żyje runtime języka. Podmieniamy sam `useServerFn`.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(),
}));
vi.mock("@/lib/events/rsvp-email.functions", () => ({ confirmFreeRsvpEmail: vi.fn() }));
vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => ({ events_enabled: true }),
}));
vi.mock("@/hooks/useEventSeatsRealtime", () => ({
  useEventSeatsRealtime: () => ({ seats: null }),
}));
vi.mock("@/lib/billing/tiers", () => ({
  useMembershipTiers: () => ({ data: [] }),
  useCurrentTier: () => ({ data: null }),
  tierName: () => "",
  tierHasFeature: () => false,
}));

// Powierzchnie prawej kolumny (grupa czatu, kalendarz, wejściówki) mają własne
// zapytania i własne testy; do dowodu o nagłówku sekcji nie wnoszą nic.
vi.mock("@/components/network/EventGroupButton", () => ({ EventGroupButton: () => null }));
vi.mock("@/components/community/AddToCalendar", () => ({ AddToCalendar: () => null }));
vi.mock("@/components/community/EventTicketCard", () => ({ EventTicketCard: () => null }));
vi.mock("@/components/community/EventTicketPurchase", () => ({ EventTicketPurchase: () => null }));

import {
  EVENT_SECTION_KEYS,
  sectionHeadingKey,
  type EventSection,
  type EventSectionKey,
} from "@/lib/events/eventSections";
import { eventFrontEn, eventFrontPl } from "@/lib/i18n-event-front";
import { renderRoute } from "@/test/routeHarness";
import { EventPageSections } from "@/components/events/public/organisms/EventPageSections";
import { EventSpeakersSection } from "@/components/events/EventSpeakersSection";
import { Route as EventOverviewRoute } from "@/routes/events.$slug.index";

const SCAN_ROOT = "src";

/** JEDYNY plik, któremu wolno sięgnąć po słownikowy klucz nagłówka. */
const SELECTOR_FILE = "src/lib/events/eventSections.ts";

/** Napis, którego w żadnym słowniku nie ma - więc jego obecność w drzewie
 *  dowodzi ODCZYTU KOLUMNY, a nie trafienia w klucz. */
const OVERRIDE = "Nazwa wpisana przez organizatora";

const EVENT_SLUG = "kongres-strategii";

/** Wiersz modelu sekcji; `heading` = nadpisanie redakcji albo jego brak. */
function sectionRow(
  key: EventSectionKey,
  heading: string | null,
  over: Partial<EventSection> = {},
): EventSection {
  return {
    key,
    sortOrder: (EVENT_SECTION_KEYS as readonly string[]).indexOf(key),
    headingPl: heading,
    headingEn: heading,
    visibility: "public",
    minTierRank: 0,
    isLocked: false,
    lockReason: "none",
    hasContent: null,
    ...over,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * NAZWY SEKCJI, KTÓRE POWIERZCHNIA NAPRAWDĘ PRZEDSTAWIŁA CZYTELNIKOWI.
 *
 * Nie sam `textContent`: nazwa sekcji zapisów nie jest tekstem, a DOSTĘPNĄ
 * NAZWĄ grupy (`role="group"` + `aria-label`). Bramka, która czytałaby tylko
 * tekst, uznałaby tamto miejsce za nieistniejące - czyli dokładnie przegapiłaby
 * jedną z trzech sekcji.
 */
function presentedHeadings(root: ParentNode): string[] {
  const fromText = [...root.querySelectorAll("h2")].map((node) => node.textContent ?? "");
  const fromGroups = [...root.querySelectorAll("[role='group'][aria-label]")].map(
    (node) => node.getAttribute("aria-label") ?? "",
  );
  return [...fromText, ...fromGroups];
}

interface HeadingSurface {
  /** Nazwa w komunikacie czerwieni. */
  readonly label: string;
  /** Plik, który tę powierzchnię rysuje - wiąże dowód zachowania ze zbiorem
   *  policzonym z drzewa. */
  readonly file: string;
  /** Ile nagłówków sekcji ta powierzchnia rysuje w JEDNYM renderze. */
  readonly places: number;
  /** Rysuje powierzchnię z podanym nadpisaniem i oddaje przedstawione nazwy. */
  readonly draw: (heading: string | null) => Promise<string[]>;
}

const COVERED_SURFACES: readonly HeadingSurface[] = [
  {
    label: "sekcje z bazy (EventPageSections)",
    file: "src/components/events/public/organisms/EventPageSections.tsx",
    places: 1,
    // Sekcja `map` z adresem: jedyna, która rysuje się bez zapytania i bez
    // routera, więc dowód dotyczy NAGŁÓWKA, a nie atrap wokół niego.
    draw: async (heading) => {
      const { container } = render(
        <EventPageSections
          slug={EVENT_SLUG}
          sections={[sectionRow("map", heading)]}
          practical={{
            streetAddress: "Krakowskie Przedmieście 42",
            city: "Warszawa",
            languages: [],
          }}
        />,
        { wrapper },
      );
      return presentedHeadings(container);
    },
  },
  {
    label: "zapowiedź prelegentów na przeglądzie (EventSpeakersSection)",
    file: "src/components/events/EventSpeakersSection.tsx",
    places: 1,
    draw: async (heading) => {
      h.speakers = [speakerRow()];
      const { container } = render(
        <EventSpeakersSection eventId="e1" lang="pl" section={sectionRow("speakers", heading)} />,
        { wrapper },
      );
      // Czekamy na POZYCJĘ LISTY: sekcja bez prelegentów znika razem
      // z nagłówkiem, więc bez tego mierzylibyśmy pusty render.
      await waitFor(() => expect(container.querySelectorAll("li")).toHaveLength(1));
      return presentedHeadings(container);
    },
  },
  {
    label: "przegląd wydarzenia (trasa events.$slug.index)",
    file: "src/routes/events.$slug.index.tsx",
    places: 3,
    // TRZY MIEJSCA W JEDNYM RENDERZE: nagłówek nad kartą zamka opisu, nagłówek
    // nad kartą zamka prelegentów i dostępna nazwa grupy bloku zapisów. Zamki
    // są tu WŁĄCZONE celowo - to jedyny stan, w którym trasa rysuje oba
    // nagłówki sama (przy sekcji otwartej prelegentów rysunek należy do
    // komponentu, co dowodzi osobny test o przekazaniu wiersza sekcji).
    draw: async (heading) => {
      h.sections = [
        sectionRow("description", heading, {
          isLocked: true,
          lockReason: "registration_required",
        }),
        sectionRow("speakers", heading, { isLocked: true, lockReason: "registration_required" }),
        sectionRow("registration", heading),
      ];
      const route = await renderRoute({
        route: EventOverviewRoute,
        path: "/events/$slug/",
        initialEntry: `/events/${EVENT_SLUG}`,
      });
      // Ta trasa nie ma loadera - migawka wydarzenia i sekcje jadą zwykłym
      // `useQuery`, więc pierwszy render to jeszcze ekran wczytywania.
      await waitFor(() => expect(presentedHeadings(route.container)).toHaveLength(3));
      return presentedHeadings(route.container);
    },
  },
];

/**
 * Pliki, które wołają selektor nagłówka, a POWIERZCHNIĄ nie są. Powód każdego
 * musi być mechaniczny - lista bez uzasadnień zamienia się w listę wymówek,
 * a wpis nieaktualny czerwieni test tak samo jak brakujący.
 *
 * Dziś pusta: wszystkie trzy miejsca są pokryte dowodem zachowania. Zostaje
 * jako miejsce na wyjątek, bo asercja o nieaktualnym wpisie i tak go pilnuje.
 */
const SURFACE_EXCEPTIONS: Record<string, string> = {};

/** Wiersz prelegenta - tylko tyle, ile zapowiedź potrzebuje, żeby narysować
 *  pozycję listy (bez niej sekcja znika razem z nagłówkiem). */
function speakerRow(): Record<string, unknown> {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: null,
    job_title: "Dyrektorka",
    company: "Szkoła Główna Handlowa",
    headline_pl: "Prezes zarządu",
    headline_en: "Chair of the board",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: true,
    sort_order: 0,
  };
}

/**
 * Źródło BEZ KOMENTARZY - skan liczy KOD, nie opis. Warunek na znak przed `//`
 * zostawia adresy (`https://`) w spokoju.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry).replaceAll("\\", "/");
    if (statSync(full).isDirectory()) {
      // `src/test` to harness testowy, nie kod produkcyjny.
      if (full !== "src/test") walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function codeOf(file: string): string {
  return withoutComments(readFileSync(file, "utf8"));
}

/** Pliki produkcyjne, które WOŁAJĄ wspólny selektor - liczone z drzewa. */
function headingSurfaces(): string[] {
  return walk(SCAN_ROOT, [])
    .filter((file) => file !== SELECTOR_FILE)
    .filter((file) => /\beventSectionHeading\s*\(/.test(codeOf(file)))
    .sort();
}

afterEach(() => {
  cleanup();
  h.sections = [];
  h.speakers = [];
  h.event = {};
  h.user = null;
});

describe("nadpisanie nagłówka sekcji: nie ma miejsca, które je ignoruje", () => {
  for (const surface of COVERED_SURFACES) {
    it(`${surface.label} pokazuje NADPISANIE z bazy`, async () => {
      const presented = await surface.draw(OVERRIDE);
      // Komunikat niesie napisy, bo autor zmiany czyta go zamiast tego pliku.
      expect(presented).toEqual(Array.from({ length: surface.places }, () => OVERRIDE));
    });

    it(`${surface.label} BEZ nadpisania spada na słownik sekcji`, async () => {
      // Bez tej asercji „nadpisanie działa" spełniałby też renderer, który
      // pokazuje kolumnę ZAWSZE - również puste nadpisanie, czyli pusty <h2>.
      const presented = await surface.draw(null);
      expect(presented).toHaveLength(surface.places);
      const notFromDictionary = presented.filter(
        (name) => !/^eventFront\.sections\.[a-z]+\.heading$/.test(name),
      );
      expect(notFromDictionary).toEqual([]);
    });
  }

  it("nadpisanie z samych BIAŁYCH ZNAKÓW to brak nadpisania, nie pusty nagłówek", async () => {
    // Polityka pustki należy do `pickLocalized` i musi być ta sama tutaj:
    // organizator, który wyczyścił pole do jednej spacji, ma dostać nazwę
    // domyślną, a nie nagłówek bez treści.
    const presented = await COVERED_SURFACES[0].draw("   ");
    expect(presented).toEqual(["eventFront.sections.map.heading"]);
  });

  it("trasa PRZEKAZUJE wiersz sekcji do zapowiedzi prelegentów", async () => {
    // Sekcja prelegentów OTWARTA: nagłówek rysuje komponent, nie trasa. Gdyby
    // trasa nie podała mu wiersza sekcji, nadpisanie widzieliby wyłącznie
    // goście bez dostępu - czyli dokładnie defekt, od którego się zaczęło.
    h.sections = [sectionRow("speakers", OVERRIDE)];
    h.speakers = [speakerRow()];
    const route = await renderRoute({
      route: EventOverviewRoute,
      path: "/events/$slug/",
      initialEntry: `/events/${EVENT_SLUG}`,
    });
    await waitFor(() => expect(route.container.querySelectorAll("h2")).toHaveLength(1));
    expect(route.container.querySelector("h2")?.textContent).toBe(OVERRIDE);
  });

  // ── GAŁĄŹ PŁATNA: DRUGA KONTROLKA TEJ SAMEJ SEKCJI ────────────────────────
  // Znalezione w recenzji PR #297, nie przez tę bramkę - i dlatego bramka
  // dostaje ten przypadek na stałe. Sekcja `registration` ma na przeglądzie DWIE
  // kontrolki: przy wydarzeniu bezpłatnym `EventRegistrationSurface` (nazywa się
  // sama), przy PŁATNYM `EventTicketPurchase` (nie nazywał się wcale). Nazwa
  // należy do SEKCJI, więc nadpisanie musi obowiązywać niezależnie od tego,
  // którą kontrolkę wybrała reguła - inaczej organizator zmienia nazwę sekcji
  // i dostaje ją tylko na wydarzeniach darmowych.
  //
  // `EventTicketPurchase` jest tu atrapą (`() => null`), więc mierzymy DOKŁADNIE
  // to, co rysuje trasa: dostępną nazwę grupy wokół kontrolki zakupu.
  it("na wydarzeniu PŁATNYM nadpisanie nazywa grupę zakupu biletu", async () => {
    h.sections = [sectionRow("registration", OVERRIDE)];
    h.event = { ticket_price_cents: 12000 };
    h.user = { id: "u-1" };
    const route = await renderRoute({
      route: EventOverviewRoute,
      path: "/events/$slug/",
      initialEntry: `/events/${EVENT_SLUG}`,
    });
    await waitFor(() => expect(presentedHeadings(route.container)).toEqual([OVERRIDE]));
  });

  it("na wydarzeniu PŁATNYM bez nadpisania grupa spada na słownik sekcji", async () => {
    // Druga połowa dowodu: bez niej „nadpisanie działa" spełniałaby też grupa,
    // która pokazuje nadpisanie ZAWSZE - także puste.
    h.sections = [sectionRow("registration", null)];
    h.event = { ticket_price_cents: 12000 };
    h.user = { id: "u-1" };
    const route = await renderRoute({
      route: EventOverviewRoute,
      path: "/events/$slug/",
      initialEntry: `/events/${EVENT_SLUG}`,
    });
    await waitFor(() =>
      expect(presentedHeadings(route.container)).toEqual([sectionHeadingKey("registration")]),
    );
  });
});

describe("nagłówek sekcji ma JEDNO dojście do słownika", () => {
  it("słownikowy klucz nagłówka woła WYŁĄCZNIE wspólny selektor", () => {
    // Dopóki `sectionHeadingKey` żyje w jednym pliku, powierzchnia nie ma jak
    // po cichu wrócić do rysowania nagłówka obok modelu sekcji: fallback ze
    // słownika istnieje tylko wewnątrz selektora.
    const rogue = walk(SCAN_ROOT, [])
      .filter((file) => file !== SELECTOR_FILE && /\bsectionHeadingKey\s*\(/.test(codeOf(file)))
      .sort();
    expect(rogue).toEqual([]);
  });

  it("selektor nadal woła ten klucz tam, gdzie bramka go szuka", () => {
    // Bez tego poprzednia asercja przechodziłaby po USUNIĘCIU mechanizmu: zero
    // plików z kluczem to też „żaden poza selektorem".
    expect(/\bsectionHeadingKey\s*\(/.test(codeOf(SELECTOR_FILE))).toBe(true);
  });

  it("żaden plik nie składa klucza nagłówka RĘCZNIE", () => {
    // Druga furtka obok wołania funkcji: `t("eventFront.sections.X.heading")`.
    // Selektor składa ten klucz z szablonu (`${key}`), więc literał gotowego
    // klucza nie ma prawa stać nigdzie - także w nim.
    const rogue = walk(SCAN_ROOT, [])
      .filter((file) => /eventFront\.sections\.[a-z]+\.heading/.test(codeOf(file)))
      .sort();
    expect(rogue).toEqual([]);
  });
});

describe("rodzina miejsc rysowania jest LICZONA z drzewa, nie wypisana", () => {
  it("każde miejsce rysowania jest albo POKRYTE, albo ma jawny powód", () => {
    const surfaces = headingSurfaces();
    // Zero znaczy, że regexp przestał cokolwiek łapać i bramka mierzy pustkę.
    expect(surfaces.length).toBeGreaterThan(0);

    const covered = new Set(COVERED_SURFACES.map((surface) => surface.file));
    const unaccounted = surfaces.filter(
      (file) => !covered.has(file) && SURFACE_EXCEPTIONS[file] === undefined,
    );
    expect(unaccounted).toEqual([]);
  });

  it("każda POKRYTA powierzchnia nadal woła selektor z tej ścieżki", () => {
    // Przeniesienie pliku albo odcięcie go od selektora musi zaczerwienić się
    // TUTAJ, a nie zniknąć w ciszy razem z dowodem zachowania.
    const surfaces = new Set(headingSurfaces());
    const gone = COVERED_SURFACES.map((surface) => surface.file).filter(
      (file) => !surfaces.has(file),
    );
    expect(gone).toEqual([]);
  });

  it("nie trzyma wyjątku na plik, który selektora już nie woła", () => {
    const surfaces = new Set(headingSurfaces());
    const stale = Object.keys(SURFACE_EXCEPTIONS).filter((file) => !surfaces.has(file));
    expect(stale).toEqual([]);
  });

  it("KANAREK: nagłówek KAŻDEJ sekcji jest prawdziwym kluczem w obu słownikach", () => {
    // Bez tego zmiana nazwy klucza zostawiłaby bramkę dopasowującą martwy
    // wzorzec: zielona i ślepa naraz.
    const resolve = (tree: unknown, key: string): unknown =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node !== null && typeof node === "object"
              ? (node as Record<string, unknown>)[part]
              : undefined,
          tree,
        );
    const missing = EVENT_SECTION_KEYS.flatMap((key) => {
      const path = sectionHeadingKey(key);
      return [
        ...(typeof resolve(eventFrontPl, path) === "string" ? [] : [`pl:${path}`]),
        ...(typeof resolve(eventFrontEn, path) === "string" ? [] : [`en:${path}`]),
      ];
    });
    expect(missing).toEqual([]);
  });
});
