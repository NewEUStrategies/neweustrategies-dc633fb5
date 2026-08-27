// BRAMKA CI: podglad studia NIE MOZE ZNOWU ZOSTAC DRUGIM RENDEREREM STRONY.
//
// CO SIE PSULO. `EventPreviewCanvas` rysowal wlasny uklad strony wydarzenia:
// jedna kolumne `max-w-3xl`, wlasny `<h1>`, wlasna karte `<dl>` przez lokalny
// `PreviewMetaRow`, wlasna kopie kafli podstron - i ZERO paska zakladek.
// W repozytorium staly wiec dwa niezalezne rysunki tej samej strony i nic nie
// pilnowalo, zeby mowily to samo. Wlasciciel zobaczyl w studiu „stary layout”,
// mimo ze nowy byl na `main`.
//
// DLACZEGO POPRZEDNIA WERSJA TEJ BRAMKI SWIECILA NA ZIELONO PRZY ZEPSUTEJ
// RZECZY - to jest najwazniejsze zdanie w tym pliku. Porownywala LISTE NAZW:
// co importuje trasa publiczna kontra co importuje podglad. `EventPreviewCanvas`
// importowal `EventPageSections` i `EventVideoHeader`, wiec lista sie zgadzala,
// a uklad byl zupelnie inny. Bramka przechodzaca przy zepsutej rzeczy jest
// GORSZA niz brak bramki, bo produkuje falszywa pewnosc. Dlatego ta wersja mierzy
// STRUKTURE, a nie liste nazw:
//
//   1. RENDERUJE OBA MIEJSCA - prawdziwa trasa powloki, prawdziwa trasa przegladu
//      i kanwa podgladu - i asertuje, ze w kazdym z nich stoi TA SAMA powloka
//      (`EventPortalShell`) i TA SAMA siatka (`EventOverviewLayout`),
//      rozpoznawane po `data-testid`. Nazwa w imporcie tego nie dowodzi.
//   2. CZYTA ZRODLO PODGLADU i czerwieni sie, gdy wroci do niego WLASNY uklad:
//      `max-w-*`, `grid-cols-`, `<h1`, `<dl>/<dt>/<dd>`, wlasny `<nav>`,
//      wlasny `<article>` albo wlasny zakres brandingu. To jest asercja
//      NEGATYWNA - ma padac w chwili, w ktorej ktos wraca do rysowania po swojemu,
//      a nie dopiero po publikacji.
//   3. Utrzymuje stary dowod o LISCIE POWIERZCHNI (import + sekcje) jako
//      UZUPELNIENIE, nie jako caly pomiar: on wciaz lapie inny defekt - nowa
//      powierzchnia dopisana na stronie i pominieta w podgladzie.
//
// WYJATKI SA JAWNE I MAJA POWOD. Powierzchnie, ktore same wolaja baze albo
// tozsamosc wolajacego, w szkicu niezapisanego wydarzenia nie maja z czego sie
// wyrenderowac. Kazda stoi nizej z nazwa i powodem - i bramka pilnuje TAKZE tego,
// zeby wyjatek nie przezyl powierzchni, ktorej dotyczyl (nieuzywany wpis
// czerwieni test tak samo jak brakujacy komponent).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

// Powierzchnie publiczne wciagaja przez `usePublicEvent` klienta bazy, ktory
// przy imporcie wymaga zmiennych srodowiska. Atrapa modulu zapytan odcina ten
// lancuch - w tym tescie nie leci ani jedno zapytanie, bo podglad rysuje szkic,
// a trasy dostaja migawke z atrapy `publicQueries`.
vi.mock("@/lib/events/publicEventApi", () => ({
  fetchEventAgenda: vi.fn(async () => []),
  fetchEventMenu: vi.fn(async () => []),
  fetchEventSections: vi.fn(async () => []),
  fetchEventSponsors: vi.fn(async () => []),
  fetchEventSponsorMaterials: vi.fn(async () => []),
  fetchMyBookmarks: vi.fn(async () => []),
  fetchSessionAccess: vi.fn(async () => null),
  submitSessionSignup: vi.fn(),
  toggleEventBookmark: vi.fn(),
}));

// ── ATRAPY WARSTWY DANYCH TRASY PRZEGLADU ──────────────────────────────────
// Przedmiotem dowodu jest UKLAD, a nie zapytania: trasa ma sie zamontowac i
// oddac powloke oraz siatke. Dlatego atrapy oddaja NAJUBOZSZA prawdziwa
// odpowiedz (brak naglowka, zero sekcji, zero pozycji menu) - siatka, ktora
// stoi tylko przy pelnych danych, nie jest siatka.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
// Atrapa CZASTKOWA: `@tanstack/react-start` niesie takze `createIsomorphicFn`,
// z ktorego zyje runtime jezyka (`lib/i18n/localeRuntime.ts`). Podmieniamy sam
// `useServerFn`, bo poza runtime'em Start prawdziwy hook nie ma czego zawinac.
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
vi.mock("@/lib/community/publicQueries", async () => {
  const { publicEventRow } = await import("@/test/events/publicEventRow");
  return {
    fetchPublicEventBySlug: vi.fn(async () => publicEventRow()),
    fetchEventPageHeader: vi.fn(async () => null),
    fetchEventAccess: vi.fn(async () => null),
    fetchEventRsvpCounts: vi.fn(async () => new Map()),
    fetchEventWaitlistPosition: vi.fn(async () => null),
    rsvpEvent: vi.fn(),
  };
});

// Powierzchnie POZA `components/events/public/` (spolecznosc, siec kontaktow,
// prelegenci) maja wlasne testy i wlasne zapytania; tutaj sa atrapami, bo do
// dowodu o UKLADZIE nie wnosza nic, a wnosza pol tuzina zapytan.
vi.mock("@/components/network/EventGroupButton", () => ({
  EventGroupButton: () => null,
}));
vi.mock("@/components/events/EventSpeakersSection", () => ({
  EventSpeakersSection: () => null,
}));
vi.mock("@/components/community/AddToCalendar", () => ({ AddToCalendar: () => null }));
vi.mock("@/components/community/EventTicketCard", () => ({ EventTicketCard: () => null }));
vi.mock("@/components/community/EventTicketPurchase", () => ({ EventTicketPurchase: () => null }));

import { EVENT_SECTION_KEYS } from "@/lib/events/eventSections";
import { renderRoute } from "@/test/routeHarness";
import { Route as EventShellRoute } from "@/routes/events.$slug";
import { Route as EventOverviewRoute } from "@/routes/events.$slug.index";
import {
  EventPreviewCanvas,
  PREVIEW_SECTION_KEYS,
} from "@/components/admin/events/studio/EventPreviewCanvas";
import {
  EMPTY_EVENT_PREVIEW,
  type EventPreviewModel,
} from "@/components/admin/events/studio/EventStudioPreviewContext";

const ROUTES_DIR = "src/routes";
const PREVIEW_CANVAS = "src/components/admin/events/studio/EventPreviewCanvas.tsx";

/** Znacznik powloki portalu - `EventPortalShell`. */
const SHELL = "[data-testid='event-portal-shell']";
/** Znacznik siatki przegladu - `EventOverviewLayout`. */
const GRID = "[data-testid='event-overview-layout']";

const EVENT_SLUG = "kongres-strategii";

afterEach(() => {
  cleanup();
});

/**
 * CALA RODZINA TRAS PUBLICZNEJ STRONY WYDARZENIA, nie jeden plik.
 *
 * Strona wydarzenia przestala byc lisciem: `events.$slug.tsx` jest powloka
 * z `<Outlet />`, przeglad zjechal do `events.$slug.index.tsx`, a piec zakladek
 * modulowych (uczestnicy, prelegenci, partnerzy, agenda, dyskusje) to osobne
 * trasy-dzieci. Gdyby bramka czytala dalej sam plik powloki, wystarczyloby
 * zamontowac nowa powierzchnie w KTOREJKOLWIEK zakladce, zeby przestala byc
 * przez nia widziana - czyli dokladnie ten defekt, przed ktorym ta bramka stoi.
 *
 * Rodzina jest LICZONA Z KATALOGU, a nie wypisana: szosta zakladka dopisana
 * jutro wchodzi do bramki sama, bez pamietania o tej liscie. `$slug_` z
 * podkreslnikiem (zapis, samoobsluga) NIE nalezy do rodziny - te trasy sa
 * dziecmi `/events`, a nie zakladkami wydarzenia, i maja wlasne powierzchnie.
 */
function publicRouteFamily(): string[] {
  const files = readdirSync(ROUTES_DIR)
    .filter((name) => /^events\.\$slug(\.[a-z0-9-]+)?\.tsx$/.test(name))
    .map((name) => `${ROUTES_DIR}/${name}`)
    .sort();
  return files;
}

/**
 * Powierzchnie publiczne, ktorych podglad SWIADOMIE nie montuje, z powodem.
 *
 * DWA POWODY SA PRAWDZIWE I OBA SA MECHANICZNE - reszta to wymowki.
 *
 *  (1) PUBLICZNE RPC SA BRAMKOWANE STATUSEM WYDARZENIA, nie brakiem
 *      identyfikatora. `event_menu`, `event_agenda`, `event_sponsors_public`,
 *      `event_attendees`, `event_discussions` i `get_public_speakers` maja
 *      w ciele `AND e.status = 'published'`. Studio otwiera sie na ISTNIEJACYM
 *      wierszu, wiec podglad ma PRAWDZIWY slug i prawdziwe id
 *      (`EventStudioShell`: `slug: row.slug ?? ""`) - a mimo to wydarzenie
 *      w statusie `draft` oddaje tym powierzchniom pustke. Harness tego
 *      repozytorium wykonuje oba dowody:
 *      `40_speakers.sql` - 'front: SZKIC oddaje zero kart, mimo wpisanego
 *      prelegenta'; `95_attendees_and_discussions.sql` - 'szkic wydarzenia nie
 *      ma listy uczestnikow'.
 *
 *  (2) DLA WYDARZENIA OPUBLIKOWANEGO PODGLAD POKAZUJE STAN NIEZAPISANY
 *      (nakladka szkicu ekranu na `base` ze stanu zapisanego), a te komponenty
 *      czytaja WYLACZNIE baze. Zamontowane, zmieszalyby niezapisana edycje
 *      z zapisanymi danymi i pokazalyby redaktorowi uklad, ktorego po zapisie
 *      nie zobaczy.
 *
 * WCZESNIEJSZA WERSJA TEJ LISTY MOWILA 'szkic nie ma jeszcze sciezki / slugu /
 * identyfikatora'. To bylo NIEPRAWDA i warto wiedziec, dlaczego: opisywalo
 * kreator nieutworzonego wydarzenia (`EMPTY_EVENT_PREVIEW`), a bramka stoi nad
 * studiem, ktore zawsze ma wiersz.
 *
 * UWAGA NA ROZNICE MIEDZY „NIE MONTUJEMY KOMPONENTU” I „NIE POKAZUJEMY
 * POWIERZCHNI”. Pasek zakladek i spis podstron SA w podgladzie - rysuja je
 * `EventTabsBar` i `EventMenuTiles`, czyli TE SAME komponenty prezentacyjne,
 * ktorych uzywaja `EventTabsNav` i `EventMenuNav`. Wyjatek dotyczy wylacznie
 * organizmow, ktore doklejaja do tego rysunku ZAPYTANIE i ODNOSNIKI ROUTERA.
 */
const COMPONENT_EXCEPTIONS: Record<string, string> = {
  EventMenuNav:
    "ZAPYTANIE + NAWIGACJA, nie rysunek: kazda pozycja to <Link> do `/$` albo do `/events/<slug>/<module>`, wiec klikniecie w podgladzie wyprowadziloby redaktora ze studia, a `event_menu` ma `AND e.status = 'published'` i na szkicu jest puste. SAM RYSUNEK kafli podglad ma - z `EventMenuTiles`, tego samego, ktorego uzywa ten organizm",
  EventBookmarkButton: "akcja konta - useAuth i mutacja zakladki, a nie tresc strony",
  SectionLockCard: "zamki liczy baza dla wolajacego; redaktor widzi wlasne wydarzenie w calosci",
  EventTabsNav:
    "ZAPYTANIE + NAWIGACJA: pozycje ida z `event_menu` (`AND e.status = 'published'`, na szkicu pusto), a kazda prowadzi na `/events/<slug>/...`, czyli poza panel. LISTWE paska podglad rysuje `EventTabsBar` - tym samym komponentem, co ten organizm",
  EventHomeSectionLinks:
    "ten sam `event_menu` i ta sama rola: spis jest zestawem odnosnikow wyprowadzajacych ze studia, a na szkicu wraca pusty",
  EventSponsorTiers:
    "`event_sponsors_public` odmawia szkicowi (`AND e.status = 'published'`), a wydarzeniu opublikowanemu oddaje ZAPISANE przypiecia - podglad pokazuje stan niezapisany, wiec pas logotypow klamalby o tym, co redaktor wlasnie zmienia",
  EventModulePage:
    "powierzchnia ZAKLADKI z wlasnym zapytaniem: sklada dokument strony CMS przez publiczny rezolwer sciezek, ktory wymaga strony i lancucha rodzicow w statusie `published`. MIARE kolumny tresci podglad ma wspolna - `EventPortalContent`, ten sam, ktorego uzywa ta molekula",
  EventAttendeesList:
    "`event_attendees` wymaga, zeby WOLAJACY byl zapisany na to wydarzenie - organizator ogladajacy wlasne studio zwykle nie jest uczestnikiem, wiec podglad pokazalby karte 'zapisz sie', a nie liste. Na szkicu RPC odmawia wprost (harness: `not_found`)",
  EventSpeakersGrid:
    "`get_public_speakers` ma `AND e.status = 'published'` - harness dowodzi, ze SZKIC oddaje zero kart mimo wpisanego prelegenta, wiec podglad szkicu pokazalby pusta siatke zamiast osob, ktore redaktor widzi w Tresci wydarzenia",
  EventSponsorsSection:
    "ten sam `event_sponsors_public`, co pas poziomow: pustka na szkicu, zapisane przypiecia na wydarzeniu opublikowanym - w obu wypadkach co innego niz stan, ktory redaktor ma przed soba",
  EventAgendaSection:
    "poza bramka statusu (`event_agenda`) niesie ZAPIS NA SESJE (`event_session_signup`) - zywy przycisk zapisu w podgladzie panelu pozwolilby organizatorowi zapisac sie na sesje z ekranu, ktory mial tylko pokazywac",
  EventDiscussionsList:
    "`event_discussions` liczy dostep przez `club_capabilities` grupy klubu PRZYPIETEJ do wydarzenia, a ekran studia do wyboru klubu jest odlozony - dzis ten komponent nie ma w podgladzie zadnego stanu poza `not_configured`",
};

/**
 * Sekcje strony, ktorych podglad nie dostaje, z powodem. Klucze pochodza
 * z `EVENT_SECTION_KEYS`, wiec dodanie DZIEWIATEJ sekcji do dziedziny czerwieni
 * ten test, dopoki ktos nie rozstrzygnie, czy trafia ona do podgladu.
 */
const SECTION_EXCEPTIONS: Record<string, string> = {
  description: "trasa rysuje opis wlasnym blokiem `prose`, poza `EventPageSections`",
  registration: "trasa rysuje zapisy wlasna powierzchnia, poza `EventPageSections`",
  speakers:
    "wlasny naglowek na trasie oraz `get_public_speakers` z `AND e.status = 'published'` - szkic oddaje zero kart (harness `40_speakers.sql`)",
  agenda:
    "`event_agenda` odmawia szkicowi (`AND e.status = 'published'`), a na wydarzeniu opublikowanym sekcja nioslaby zywy zapis na sesje z ekranu panelu",
  sponsors:
    "`event_sponsors_public` odmawia szkicowi (`AND e.status = 'published'`), a opublikowanemu oddaje ZAPISANE przypiecia - podglad pokazuje stan niezapisany",
  materials:
    "`event_sponsor_materials_public` stoi na tej samej bramce statusu, co partnerzy - materialy przypina sie do przypiec partnerow, ktorych szkic nie ma",
};

/**
 * WLASNY UKLAD W ZRODLE PODGLADU - wzorce, ktore MAJA czerwienic bramke.
 *
 * Kazdy wpis jest sladem konkretnej rzeczy, ktora tam kiedys stala i ktora
 * wlasciciel zobaczyl na zrzucie: kolumna `max-w-3xl`, wlasna siatka, wlasny
 * `h1`, wlasna karta `<dl>` z lokalnym wierszem, wlasny `<nav>` z kaflami,
 * wlasny `<article>` i wlasny zakres brandingu.
 */
const FORBIDDEN_OWN_LAYOUT: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /max-w-[\w[\]]+/,
    why: "miara kolumny tresci nalezy do `EVENT_PORTAL_CONTENT_CLASS` - tu stalo `max-w-3xl` przy `max-w-5xl` na stronie",
  },
  {
    pattern: /grid-cols-/,
    why: "siatke rysuje `EventOverviewLayout` (1 : 2 : 1) albo `EventMenuTiles` (kafle) - wlasna siatka w podgladzie to drugi silnik ukladu",
  },
  {
    pattern: /<h1[\s>]/,
    why: "tytul przegladu nalezy do `EventOverviewTitle` - tu stalo `text-4xl` przy `text-3xl` na stronie, a na podstronie `h1` niesie dokument CMS",
  },
  {
    pattern: /<d[ltd][\s>]/,
    why: "karta informacji nalezy do `EventMetaCard` / `EventMetaRow` - lokalny `PreviewMetaRow` byl kopia funkcji z trasy",
  },
  {
    pattern: /<nav[\s>]/,
    why: "pasek zakladek rysuje `EventTabsBar`, a spis podstron `EventMenuTiles` - wlasny `<nav>` to znowu przepisane znaczniki",
  },
  {
    pattern: /<article[\s>]/,
    why: "opakowanie strony nalezy do `EventOverviewLayout` / `EventPortalContent`",
  },
  {
    pattern: /eventBrandingScopeProps|data-event-branding/,
    why: "zakres brandingu zamyka `EventPortalShell` - drugi zakres w podgladzie znaczy dwa miejsca do poprawienia przy zmianie atrybutu",
  },
  {
    pattern: /function\s+\w*MetaRow\b/,
    why: "lokalny wiersz karty meta - dokladnie ta funkcja, ktora byla przepisana z trasy",
  },
];

/**
 * Zrodlo BEZ KOMENTARZY - asercje negatywne dotycza kodu, nie opisu.
 *
 * Ten plik i podglad OPISUJA w komentarzach, co tam kiedys stalo (`max-w-3xl`,
 * `<h1`), i tak ma zostac: bez tego opisu nikt nie wie, czego bramka pilnuje.
 * Komentarz `//` w adresie (`https://`) zostaje - stad warunek na znak przed.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
}

/** Nazwy importowane z `components/events/public/` w podanych plikach zrodlowych. */
function publicImports(...paths: string[]): Set<string> {
  const source = paths.map((path) => readFileSync(path, "utf8")).join("\n");
  const pattern = /import\s*\{([^}]*)\}\s*from\s*"(@\/components\/events\/public\/[^"]+)"/g;
  const names = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    for (const raw of match[1].split(",")) {
      // `type X` i `X as Y` sprowadzamy do nazwy zrodlowej - bramka porownuje
      // powierzchnie, a nie sposob jej zaimportowania.
      const name = raw
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (name !== "") names.add(name);
    }
  }
  return names;
}

/** Szkic wypelniony tak, zeby kazda montowana powierzchnia miala co narysowac. */
function filledModel(): EventPreviewModel {
  return {
    ...EMPTY_EVENT_PREVIEW,
    titlePl: "Kongres Strategii Europejskich",
    slug: EVENT_SLUG,
    startsAt: "2026-09-15T08:00:00.000Z",
    timezone: "Europe/Warsaw",
    coverUrl: "https://cdn.example.test/cover.jpg",
    locationName: "Hotel Bristol",
    addressLine: "Krakowskie Przedmiescie 42/44, 00-325 Warszawa",
    descriptionPl: "Dwa dni rozmow o bezpieczenstwie gospodarczym.",
    hashtag: "kongresNES",
    languages: ["pl", "en"],
    supportEmail: "kontakt@example.test",
    branding: {
      ...EMPTY_EVENT_PREVIEW.branding,
      colors: { ...EMPTY_EVENT_PREVIEW.branding.colors, main_action: "#FA9346" },
    },
    pagesDisplayMode: "grid",
    menu: [{ key: "m1", label: "Prelegenci", icon: "users", color: "" }],
  };
}

/** Pasek zakladek - `EventTabsBar` nadaje `nav` te etykiete w obu miejscach. */
const TABS_NAV = 'nav[aria-label="eventFront.header.tabsLabel"]';

// ── 1. STRUKTURA: OBA MIEJSCA RYSUJA TE SAME KOMPONENTY UKLADU ─────────────

describe("uklad strony wydarzenia ma JEDNO zrodlo rysunku", () => {
  it("powloka publiczna i podglad studia rysuja TE SAMA powloke", async () => {
    const route = await renderRoute({
      route: EventShellRoute,
      path: "/events/$slug",
      initialEntry: `/events/${EVENT_SLUG}`,
    });
    // `waitFor`, bo ta trasa NIE MA loadera: migawka wydarzenia jedzie zwyklym
    // `useQuery`, wiec pierwszy render to jeszcze ekran wczytywania. Asercja bez
    // oczekiwania mierzyla ten ekran, a nie powloke.
    await waitFor(() => expect(route.container.querySelectorAll(SHELL)).toHaveLength(1));
    cleanup();

    const preview = render(<EventPreviewCanvas model={filledModel()} device="desktop" />);
    expect(preview.container.querySelectorAll(SHELL)).toHaveLength(1);
  });

  it("przeglad publiczny i podglad studia rysuja TE SAMA siatke", async () => {
    const route = await renderRoute({
      route: EventOverviewRoute,
      path: "/events/$slug/",
      initialEntry: `/events/${EVENT_SLUG}`,
    });
    await waitFor(() => expect(route.container.querySelectorAll(GRID)).toHaveLength(1));
    cleanup();

    const preview = render(<EventPreviewCanvas model={filledModel()} device="desktop" />);
    expect(preview.container.querySelectorAll(GRID)).toHaveLength(1);
  });

  it("podglad podstrony zostaje pod powloka, ale BEZ siatki przegladu", () => {
    // Podstrona wygrywa ze strona glowna (redaktor kliknal wiersz strony), wiec
    // siatki trzech kolumn tam nie ma - jest kolumna tresci, jak na
    // `/events/<slug>/<module>`.
    const { container } = render(
      <EventPreviewCanvas
        model={{
          ...filledModel(),
          selectedPage: { key: null, label: "Program", path: "kongres/program", document: null },
        }}
        device="desktop"
      />,
    );
    expect(container.querySelectorAll(SHELL)).toHaveLength(1);
    expect(container.querySelectorAll(GRID)).toHaveLength(0);
    expect(screen.getByTestId("event-preview-page")).toBeInTheDocument();
  });

  it("podglad pokazuje PASEK ZAKLADEK - jego brak byl cala trescia zgloszenia", () => {
    render(<EventPreviewCanvas model={filledModel()} device="desktop" />);
    const tabs = screen.getByRole("navigation", { name: "eventFront.header.tabsLabel" });
    expect(tabs).toBeInTheDocument();
    // „Strona glowna” + pozycje ze szkicu.
    expect(tabs.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("eventFront.header.tabs.overview")).toBeInTheDocument();
  });

  // ── PARYTET WARUNKU, NIE TYLKO STRUKTURY ─────────────────────────────────
  //
  // PO CO OSOBNA ASERCJA. Reszta tego pliku pilnuje, ze oba miejsca rysuja TE
  // SAME komponenty. To NIE WYSTARCZA: komponent moze byc ten sam, a warunek
  // jego pokazania inny - i wtedy podglad obiecuje chrome, ktorego po publikacji
  // nie bedzie. Dokladnie to przepuscila pierwsza wersja tej bramki: kanwa
  // montowala `EventTabsBar` BEZWARUNKOWO, a `EventTabsNav:60` zwraca `null`
  // przy pustym menu. Znalazl to bot recenzyjny, nie ta bramka.
  it("puste menu: ANI strona, ANI podglad nie rysuja paska zakladek", async () => {
    // Po stronie publicznej menu jedzie przez zaatrapowany `fetchEventMenu`,
    // ktory w tym pliku nie zwraca nic - czyli `useEventMenu` daje `[]`, a
    // `EventTabsNav:60` zwraca `null`. To jest stan odniesienia i asercja
    // pilnuje, ze taki POZOSTANIE, gdyby ktos usunal tamta furtke.
    const route = await renderRoute({
      route: EventShellRoute,
      path: "/events/$slug",
      initialEntry: `/events/${EVENT_SLUG}`,
    });
    await waitFor(() => expect(route.container.querySelectorAll(SHELL)).toHaveLength(1));
    expect(route.container.querySelector(TABS_NAV)).toBeNull();
    cleanup();

    // A tu sedno: kanwa z pustym menu tez nie moze pokazac paska.
    const preview = render(
      <EventPreviewCanvas model={{ ...filledModel(), menu: [] }} device="desktop" />,
    );
    expect(preview.container.querySelectorAll(SHELL)).toHaveLength(1);
    expect(preview.container.querySelector(TABS_NAV)).toBeNull();
  });
});

// ── 2. ZRODLO PODGLADU NIE MA WLASNEGO UKLADU ──────────────────────────────

describe("zrodlo podgladu nie odzyskuje wlasnego ukladu", () => {
  const source = withoutComments(readFileSync(PREVIEW_CANVAS, "utf8"));

  for (const { pattern, why } of FORBIDDEN_OWN_LAYOUT) {
    it(`nie rysuje po swojemu: ${pattern.source}`, () => {
      const hit = source.match(pattern);
      // Komunikat niesie POWOD, bo autor zmiany czyta go zamiast tego pliku.
      expect(hit === null ? null : `${hit[0]} - ${why}`).toBeNull();
    });
  }

  it("montuje powloke i siatke, a nie same liscie", () => {
    // Bez tego zestaw asercji negatywnych przechodzilby na pustym pliku.
    expect(source).toContain("<EventPortalShell");
    expect(source).toContain("<EventOverviewLayout");
  });
});

// ── 3. UZUPELNIENIE: LISTA POWIERZCHNI I SEKCJI ────────────────────────────

describe("podglad studia kontra strona publiczna - lista powierzchni", () => {
  it("montuje komponenty publiczne, a nie ich kopie", () => {
    const preview = publicImports(PREVIEW_CANVAS);
    // Zero importow znaczy, ze podglad znowu rysuje strone od zera.
    expect([...preview].sort()).not.toEqual([]);
  });

  it("czyta CALA rodzine tras wydarzenia, a nie jeden plik", () => {
    const family = publicRouteFamily();
    // Powloka + przeglad + piec zakladek modulowych. Mniej znaczy, ze regexp
    // rodziny przestal je lapac i bramka mierzy pustke.
    expect(family).toContain("src/routes/events.$slug.tsx");
    expect(family).toContain("src/routes/events.$slug.index.tsx");
    expect(family.length).toBeGreaterThanOrEqual(7);
    // Trasy z podkreslnikiem nie sa zakladkami wydarzenia - nie moga tu wejsc.
    expect(family.some((file) => file.includes("$slug_"))).toBe(false);
  });

  it("nie omija zadnej powierzchni strony publicznej bez jawnego wyjatku", () => {
    const route = publicImports(...publicRouteFamily());
    const preview = publicImports(PREVIEW_CANVAS);
    expect(route.size).toBeGreaterThan(0);

    const missing = [...route].filter(
      (name) => !preview.has(name) && COMPONENT_EXCEPTIONS[name] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("nie trzyma wyjatku na powierzchnie, ktorej strona publiczna juz nie rysuje", () => {
    const route = publicImports(...publicRouteFamily());
    const stale = Object.keys(COMPONENT_EXCEPTIONS).filter((name) => !route.has(name));
    expect(stale).toEqual([]);
  });

  it("dostaje kazda sekcje strony albo jawny powod, dlaczego nie", () => {
    const covered = new Set<string>(PREVIEW_SECTION_KEYS);
    const missing = EVENT_SECTION_KEYS.filter(
      (key) => !covered.has(key) && SECTION_EXCEPTIONS[key] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("nie trzyma wyjatku na sekcje, ktorej dziedzina juz nie ma", () => {
    const known = new Set<string>(EVENT_SECTION_KEYS);
    const covered = new Set<string>(PREVIEW_SECTION_KEYS);
    const stale = Object.keys(SECTION_EXCEPTIONS).filter(
      (key) => !known.has(key) || covered.has(key),
    );
    expect(stale).toEqual([]);
  });
});

// ── 4. PODGLAD NADAL RYSUJE SZKIC PRAWDZIWYMI KOMPONENTAMI ─────────────────

describe("podglad studia rysuje szkic prawdziwymi komponentami", () => {
  it("oddaje branding tym samym mechanizmem, co strona publiczna", () => {
    const { container } = render(<EventPreviewCanvas model={filledModel()} device="desktop" />);
    const shell = container.querySelector(SHELL);
    // Zakres brandingu to atrybut ze wspolnego zrodla, nie literal w podgladzie.
    expect(shell?.hasAttribute("data-event-branding")).toBe(true);
    const style = container.querySelector("style[data-event-branding-tokens]");
    expect(style?.textContent).toContain("--primary:#FA9346");
  });

  it("oddaje naglowek okladki i dojazd z powierzchni publicznych", () => {
    const { container } = render(<EventPreviewCanvas model={filledModel()} device="desktop" />);
    // `EventVideoHeader`: bez identyfikatora wideo rysuje okladke.
    expect(container.querySelector("img[src='https://cdn.example.test/cover.jpg']")).not.toBeNull();
    // `EventPageSections` -> `EventPracticalSection`: naglowek sekcji i adres.
    expect(screen.getByText("eventFront.sections.map.heading")).toBeInTheDocument();
    expect(screen.getByText("Krakowskie Przedmiescie 42/44, 00-325 Warszawa")).toBeInTheDocument();
    expect(screen.getByText("eventFront.sections.contact.heading")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "kontakt@example.test" })).toHaveAttribute(
      "href",
      "mailto:kontakt@example.test",
    );
  });

  it("nie rysuje sekcji, ktorej szkic nie wypelnil", () => {
    // Pustke odsiewa regula strony publicznej (`hasPracticalContent`), nie warunek
    // przepisany w podgladzie - dlatego pusty szkic nie zostawia samego naglowka.
    render(<EventPreviewCanvas model={EMPTY_EVENT_PREVIEW} device="mobile" />);
    expect(screen.queryByText("eventFront.sections.map.heading")).toBeNull();
    expect(screen.queryByText("eventFront.sections.contact.heading")).toBeNull();
    // Zastepczy tytul stoi DWA RAZY i tak ma byc: raz w chrome'ie powloki
    // (`titleSlot` - nazwa wydarzenia widoczna na kazdej zakladce) i raz jako
    // `h1` przegladu. Dokladnie tak jest na stronie publicznej.
    expect(screen.getAllByText("adminEvents.studio.preview.untitled")).toHaveLength(2);
  });
});
