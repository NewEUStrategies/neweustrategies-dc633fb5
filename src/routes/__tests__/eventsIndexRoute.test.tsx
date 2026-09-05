// PUBLICZNY KATALOG WYDARZEŃ: `/events` (`src/routes/events.index.tsx`).
//
// TO NIE JEST OWIJKA. Trasa niesie trzy warstwy, z których każda psuje się
// inaczej i żadna nie ma innego pliku testowego:
//
//   1. LOADER decyduje, co zobaczy CRAWLER. Rozgrzewa listę pod SSR, wycina
//      z projekcji `head()` wydarzenia, które już się skończyły, sortuje resztę
//      rosnąco i przycina do trzydziestu. Ta projekcja jest jedynym wejściem do
//      węzła `CollectionPage`, więc jej błąd nie jest widoczny na ekranie -
//      widać go dopiero w wynikach wyszukiwania, tygodnie później.
//
//   2. DEGRADACJA MA WYGLĄDAĆ JAK DEGRADACJA, nie jak pusty katalog. Loader jest
//      fail-soft (rzut dawał HTTP 500, czyli wypadnięcie z cache'a CDN i alarm
//      monitoringu), ale NIE WOLNO mu udawać, że wydarzeń nie ma: strona
//      z komunikatem „nie udało się wczytać" i strona z napisem „brak wydarzeń"
//      to dla czytelnika dwa różne fakty, a dla organizatora - różnica między
//      awarią a zarzutem, że jego wydarzenia zniknęły z serwisu.
//
//   3. PUSTY KATALOG JEST STANEM NORMALNYM. Serwis bez nadchodzących wydarzeń
//      ma pokazać dwa nagłówki sekcji i dwa zdania - a nie ekran błędu i nie
//      pustkę bez wyjaśnienia.
//
// CO WIDZI ROBOT. Katalog jest indeksowany, więc tytuł dokumentu, opis, adres
// kanoniczny i dwa węzły JSON-LD (`CollectionPage` + `BreadcrumbList`) są tu
// przedmiotem dowodu na równi z tym, co widzi człowiek.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Plakietki formatu i fallbacku opisu na kaflu
// - to `eventsCatalogueFormatBadge.test.tsx`, który montuje `EventCard`
// z PRAWDZIWYM słownikiem; tutaj `t` echuje klucz, bo przedmiotem dowodu jest
// PODZIAŁ i KOLEJNOŚĆ, a nie brzmienie napisów. (2) Kontraktu samego JSON-LD -
// `lib/seo/__tests__`. (3) Zachowania `loadResilient` - `lib/ssr/__tests__`;
// tutaj stoi PRAWDZIWY, bo dowodem jest to, co trasa z jego wynikiem robi.
//
// WZORZEC przejęty z `eventShellLoader.test.ts` (loader wołany WPROST, atrapy na
// warstwie zapytań i na nagłówku odpowiedzi) oraz z `eventParticipantRoutes.test.tsx`
// (montaż trasy przez `@/test/routeHarness`).
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

import { axeViolations, summarize } from "@/test/axe";
import { publicEventRow } from "@/test/events/publicEventRow";
import type { PublicEvent } from "@/lib/community/publicQueries";

const h = vi.hoisted(() => ({
  /** Wiersze, które oddaje warstwa zapytań listy. */
  events: [] as PublicEvent[],
  /** Rzut z zapytania listy - ścieżka degradacji transportu. */
  listThrows: false,
  eventsEnabled: true,
  /** Nagłówki `Cache-Control`, jakie loader ustawił na odpowiedzi. */
  cacheControl: [] as string[],
  /** Ile razy warstwa zapytań została naprawdę zawołana. */
  listCalls: 0,
  /** Adres żądania - z niego liczy się język i adres kanoniczny. */
  requestUrl: "https://nes.eu/events",
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-community", () => ({ ensureI18n: () => undefined }));

// Warstwa zapytań listy - granica danych. Klucz jest DOKŁADNIE ten, którego
// używa produkcja: rozjechany klucz dałby test przechodzący na cudzym wpisie
// cache'a, a w produkcji SSR grzałby jeden klucz, a komponent czytał drugi.
vi.mock("@/lib/community/publicQueries", () => ({
  publicEventsQueryOptions: () => ({
    queryKey: ["public-events"],
    queryFn: async () => {
      h.listCalls += 1;
      if (h.listThrows) throw new Error("lista wydarzeń padła");
      return h.events;
    },
  }),
}));

vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => ({}),
  },
  resolveSetting: () => ({ events_enabled: h.eventsEnabled }),
}));

vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => ({ events_enabled: h.eventsEnabled }),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => undefined,
  readRouteCacheDirective: () => null,
}));

vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => h.requestUrl }));

// Kafel linkuje do `/events/$slug`, trasy której w drzewie testowym nie ma.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Obrazek okładki ma własny plik testowy (srcSet, `sizes`, leniwe ładowanie).
vi.mock("@/components/atoms/OptimizedImage", () => ({
  OptimizedImage: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} data-testid="okladka" />
  ),
}));

// Trzy ekrany zastępcze mają własne pliki. Tutaj dowodzimy WYŁĄCZNIE tego,
// KTÓRY z nich trasa pokazuje - bo pomylenie ich to pomylenie faktu.
vi.mock("@/components/community/CommunityDisabled", () => ({
  CommunityDisabled: () => <div data-testid="modul-wylaczony" />,
}));
vi.mock("@/components/molecules/DegradedDataNotice", () => ({
  DegradedDataNotice: ({ title }: { title: string }) => (
    <div data-testid="komunikat-degradacji" data-title={title} />
  ),
}));
vi.mock("@/components/community/EventsListSkeleton", () => ({
  EventsListSkeleton: () => <div data-testid="szkielet-listy" />,
}));
vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: ({ title }: { title: string }) => (
    <div data-testid="ekran-bledu" data-title={title} />
  ),
}));

const { renderRoute, routeHead } = await import("@/test/routeHarness");
const { Route: EventsIndexRoute } = await import("@/routes/events.index");

/** Projekcja loadera pod `head()` - kształt jest prywatny dla trasy. */
interface HeadEvent {
  slug: string;
  titlePl: string;
  titleEn: string;
  startsAt: string;
  endsAt: string | null;
  kind: string;
  location: string | null;
  cover: string | null;
}
interface EventsLoaderData {
  headEvents: HeadEvent[];
  degraded: boolean;
}
type Loader = (ctx: { context: { queryClient: QueryClient } }) => Promise<EventsLoaderData>;

/** STRAŻNIK, nie rzutowanie - warunek sprawdza w runtime, że to funkcja. */
function isLoader(value: unknown): value is Loader {
  return typeof value === "function";
}

/** Komponent stanu trasy (oczekiwanie, błąd) w kształcie, który tu wołamy. */
type RouteStateComponent = (props: { error?: unknown }) => ReactNode;

/**
 * STRAŻNIK, nie rzutowanie. Bez niego `pendingComponent` zawęża się do typu
 * `Function`, a jego wywołanie oddaje `any` - czyli dokładnie to, czego
 * w tym repozytorium nie ma prawa być.
 */
function isRouteStateComponent(value: unknown): value is RouteStateComponent {
  return typeof value === "function";
}

async function runLoader(): Promise<EventsLoaderData> {
  const raw: unknown = EventsIndexRoute.options.loader;
  if (!isLoader(raw)) throw new Error("test: trasa katalogu nie ma loadera");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return raw({ context: { queryClient } });
}

/**
 * Wiersz listy publicznej w kształcie, jaki oddaje `fetchPublicEvents`.
 *
 * `ends_at: null` W DOMYŚLE, bo o przynależności do sekcji decyduje KONIEC,
 * a fikstura ma koniec w 2099 roku - bez tego każdy wiersz z datą „dawno temu"
 * i tak byłby nadchodzący, a test archiwum przechodziłby na złym powodzie.
 */
function row(overrides: Partial<PublicEvent>): PublicEvent {
  return publicEventRow({ cover_url: null, ends_at: null, ...overrides });
}

const ROK_TEMU = "2024-03-01T09:00:00.000Z";
const DAWNO = "2023-03-01T09:00:00.000Z";
const ZA_ROK = "2099-03-01T09:00:00.000Z";
const ZA_DWA_LATA = "2100-03-01T09:00:00.000Z";

function tytul(entries: Record<string, unknown>[]): unknown {
  return entries.find((entry) => "title" in entry)?.title;
}
function metaTresc(entries: Record<string, unknown>[], name: string): unknown {
  return entries.find((entry) => entry.name === name)?.content;
}
function ogTresc(entries: Record<string, unknown>[], property: string): unknown {
  return entries.find((entry) => entry.property === property)?.content;
}

/** `head()` trasy z podanym ładunkiem loadera - to on niesie węzły JSON-LD. */
function head(loaderData: EventsLoaderData) {
  return routeHead(EventsIndexRoute, { loaderData });
}

/** Sparsowany węzeł JSON-LD o zadanym `@type`. */
function jsonLd(scripts: { children?: string }[], type: string): Record<string, unknown> {
  for (const script of scripts) {
    const parsed: unknown = JSON.parse(script.children ?? "{}");
    if (parsed !== null && typeof parsed === "object" && "@type" in parsed) {
      const node = { ...(parsed as Record<string, unknown>) };
      if (node["@type"] === type) return node;
    }
  }
  throw new Error(`test: brak węzła JSON-LD o typie ${type}`);
}

async function zamontuj() {
  return renderRoute({
    route: EventsIndexRoute,
    path: "/events",
    initialEntry: "/events",
  });
}

beforeEach(() => {
  h.events = [];
  h.listThrows = false;
  h.eventsEnabled = true;
  h.cacheControl = [];
  h.listCalls = 0;
  h.requestUrl = "https://nes.eu/events";
});

afterEach(cleanup);

describe("loader katalogu - co dostaje crawler, zanim cokolwiek się narysuje", () => {
  it("moduł wyłączony: ZERO zapytań o listę i pusta projekcja", async () => {
    // Wyłączony moduł znaczy stronę, której nikt nie zobaczy - grzanie listy
    // byłoby wyłącznie kosztem, a `degraded` musi zostać fałszem, bo nic nie
    // zawiodło. `degraded: true` postawiłoby tu komunikat o awarii.
    h.eventsEnabled = false;
    h.events = [row({ slug: "a", starts_at: ZA_ROK })];

    const data = await runLoader();

    expect(data).toEqual({ headEvents: [], degraded: false });
    expect(h.listCalls).toBe(0);
    expect(h.cacheControl).toEqual([]);
  });

  it("do projekcji `head()` wchodzą TYLKO wydarzenia, które się jeszcze nie skończyły", async () => {
    // Węzeł `CollectionPage` z zeszłorocznym wydarzeniem to zaproszenie do
    // spotkania, którego nie ma - a wyszukiwarka pokazuje takie wpisy
    // z datą i przyciskiem, jakby były aktualne.
    h.events = [
      row({ id: "1", slug: "minione", starts_at: ROK_TEMU, ends_at: ROK_TEMU }),
      row({ id: "2", slug: "przyszle", starts_at: ZA_ROK, ends_at: ZA_ROK }),
    ];

    const data = await runLoader();

    expect(data.headEvents.map((ev) => ev.slug)).toEqual(["przyszle"]);
  });

  it("wydarzenie TRWAJĄCE zostaje - liczy się koniec, a nie początek", async () => {
    // Dwudniowy kongres w drugim dniu ma nadal wisieć w katalogu i w danych
    // strukturalnych: filtr po `starts_at` skasowałby go w połowie trwania.
    h.events = [row({ id: "1", slug: "trwa", starts_at: ROK_TEMU, ends_at: ZA_ROK })];

    const data = await runLoader();

    expect(data.headEvents.map((ev) => ev.slug)).toEqual(["trwa"]);
  });

  it("wydarzenie BEZ końca liczy się po dacie rozpoczęcia", async () => {
    // `ends_at` jest nullowalne (webinar bez zadeklarowanego końca). Brak
    // zapasowego pola wyrzuciłby takie wydarzenia z projekcji zawsze.
    h.events = [
      row({ id: "1", slug: "bez-konca-minione", starts_at: ROK_TEMU, ends_at: null }),
      row({ id: "2", slug: "bez-konca-przyszle", starts_at: ZA_ROK, ends_at: null }),
    ];

    const data = await runLoader();

    expect(data.headEvents.map((ev) => ev.slug)).toEqual(["bez-konca-przyszle"]);
  });

  it("projekcja jest posortowana NAJBLIŻSZYM naprzód, nie kolejnością z bazy", async () => {
    // `ItemList` w JSON-LD ma `position`, a wyszukiwarka czyta tę kolejność
    // wprost. Losowa kolejność z bazy daje „pierwsze" wydarzenie za dwa lata.
    h.events = [
      row({ id: "1", slug: "pozniejsze", starts_at: ZA_DWA_LATA, ends_at: ZA_DWA_LATA }),
      row({ id: "2", slug: "wczesniejsze", starts_at: ZA_ROK, ends_at: ZA_ROK }),
    ];

    const data = await runLoader();

    expect(data.headEvents.map((ev) => ev.slug)).toEqual(["wczesniejsze", "pozniejsze"]);
  });

  it("projekcja jest PRZYCIĘTA do trzydziestu - dokument nie rośnie bez granicy", async () => {
    // Bez limitu serwis z dwustoma wydarzeniami wysyłałby dwieście węzłów
    // `Event` w każdym dokumencie listy, na każdą odsłonę.
    h.events = Array.from({ length: 35 }, (_unused, index) =>
      row({
        id: `id-${index}`,
        slug: `wydarzenie-${String(index).padStart(2, "0")}`,
        // Kolejne dni od 1 marca 2099 - kolejność jest jednoznaczna.
        starts_at: `2099-03-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`,
        ends_at: null,
      }),
    );

    const data = await runLoader();

    expect(data.headEvents).toHaveLength(30);
  });

  it("projekcja niesie DOKŁADNIE pola, z których liczy się węzeł `Event`", async () => {
    // Zgubione `location` albo `cover` nie psuje ekranu - psuje kartę wyniku
    // wyszukiwania, której nikt z zespołu nie ogląda.
    h.events = [
      row({
        id: "1",
        slug: "szczyt",
        title_pl: "Szczyt strategiczny",
        title_en: "Strategic summit",
        starts_at: ZA_ROK,
        ends_at: ZA_DWA_LATA,
        kind: "roundtable",
        location: "Bruksela",
        cover_url: "https://cdn.example.test/szczyt.jpg",
      }),
    ];

    const data = await runLoader();

    expect(data.headEvents[0]).toEqual({
      slug: "szczyt",
      titlePl: "Szczyt strategiczny",
      titleEn: "Strategic summit",
      startsAt: ZA_ROK,
      endsAt: ZA_DWA_LATA,
      kind: "roundtable",
      location: "Bruksela",
      cover: "https://cdn.example.test/szczyt.jpg",
    });
  });

  it("ścieżka szczęśliwa ustawia cache WSPÓLNY - dokument nadaje się na brzeg", async () => {
    h.events = [row({ id: "1", slug: "a", starts_at: ZA_ROK })];

    await runLoader();

    // KONKRETNA polityka, nie „jakiś s-maxage": `public` decyduje, czy brzeg
    // w ogóle wolno mu trzymać dokument, a `s-maxage` bez `public` jest dla
    // CDN-a martwy. Wartość zero też „zawiera s-maxage=" i nic nie cachuje.
    expect(h.cacheControl).toEqual([
      "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
    ]);
  });

  it("DEGRADACJA nie rzuca, ale ZDEJMUJE dokument ze wspólnego cache'a", async () => {
    // Rzut z loadera dawał HTTP 500: wypadnięcie z CDN, alarm monitoringu
    // i strona czytana przez crawlera jako awaria serwera. Teraz odpowiedź ma
    // 200 - ale zdegradowanego renderu NIE WOLNO podać kolejnym czytelnikom.
    h.listThrows = true;

    const data = await runLoader();

    expect(data.degraded).toBe(true);
    expect(data.headEvents).toEqual([]);
    expect(h.cacheControl).toEqual(["private, no-store"]);
  });
});

describe("nagłówek dokumentu - to, co widzi robot", () => {
  it("tytuł karty przeglądarki niesie markę, a `og:title` zostaje krótki", async () => {
    // Dwie różne role: pierwszy jest etykietą zakładki i wynikiem w SERP-ie,
    // drugi - nagłówkiem karty w komunikatorze, gdzie marka stoi już obok
    // w `og:site_name`. Zrównanie ich daje kartę z marką powtórzoną dwa razy.
    const data = await runLoader();
    const entries = (head(data).meta ?? []) as Record<string, unknown>[];

    expect(tytul(entries)).toBe("Wydarzenia - New European Strategies");
    expect(ogTresc(entries, "og:title")).toBe("Wydarzenia");
  });

  it("katalog NIE dostaje `noindex` - to jest strona, o którą prosi organizator", async () => {
    const data = await runLoader();
    const entries = (head(data).meta ?? []) as Record<string, unknown>[];

    expect(metaTresc(entries, "robots")).toBeUndefined();
    // Opis jest tym, co stoi pod tytułem w wyniku wyszukiwania. Próg długości
    // spełnia też napis zastępczy, więc dowodem jest TREŚĆ: wymienione formaty
    // to jedyny powód, dla którego ktoś kliknie w katalog zamiast w wydarzenie.
    expect(metaTresc(entries, "description")).toBe(
      "Panele, webinaria, spotkania na żywo i briefingi tylko dla społeczności.",
    );
  });

  it("adres w wersji angielskiej daje ANGIELSKI tytuł i opis", async () => {
    // Język liczy się z ADRESU, nie ze stanu i18next: dokument SSR powstaje,
    // zanim przeglądarka cokolwiek przełączy, więc `/en/events` musi wyjść
    // z serwera po angielsku albo nie wyjdzie po angielsku wcale.
    h.requestUrl = "https://nes.eu/en/events";
    const data = await runLoader();
    const entries = (head(data).meta ?? []) as Record<string, unknown>[];

    expect(tytul(entries)).toBe("Events - New European Strategies");
    expect(String(metaTresc(entries, "description"))).toContain("webinars");
  });

  it("adres kanoniczny wskazuje na `/events`, a nie na adres z parametrami", async () => {
    const data = await runLoader();
    const links = (head(data).links ?? []) as Record<string, unknown>[];

    expect(links.find((link) => link.rel === "canonical")?.href).toBe("https://nes.eu/events");
  });

  it("dane strukturalne to DWA węzły: katalog i okruszki", async () => {
    // Bez `BreadcrumbList` wynik wyszukiwania pokazuje goły adres zamiast
    // ścieżki, a bez `CollectionPage` katalog nie jest dla robota listą
    // wydarzeń, tylko zwykłą stroną z tekstem.
    h.events = [row({ id: "1", slug: "szczyt", starts_at: ZA_ROK })];
    const data = await runLoader();

    const scripts = head(data).scripts ?? [];

    expect(scripts).toHaveLength(2);
    expect(scripts.every((script) => script.type === "application/ld+json")).toBe(true);
    // Sam FAKT istnienia węzła nic nie daje - okruszki działają wtedy, gdy są
    // DRABINĄ: pozycje po kolei od strony głównej, a ostatni szczebel (strona
    // bieżąca) BEZ `item`, bo odnośnik do samego siebie w wyniku wyszukiwania
    // Google odrzuca razem z całym węzłem.
    const okruszki = jsonLd(scripts, "BreadcrumbList").itemListElement;
    expect(okruszki).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Start",
        item: "https://nes.eu/",
      },
      { "@type": "ListItem", position: 2, name: "Wydarzenia" },
    ]);
  });

  it("węzeł katalogu wymienia wydarzenia W KOLEJNOŚCI projekcji loadera", async () => {
    h.events = [
      row({ id: "1", slug: "pozniejsze", starts_at: ZA_DWA_LATA, ends_at: null }),
      row({ id: "2", slug: "wczesniejsze", starts_at: ZA_ROK, ends_at: null }),
      row({ id: "3", slug: "minione", starts_at: DAWNO, ends_at: null }),
    ];
    const data = await runLoader();

    const collection = jsonLd(head(data).scripts ?? [], "CollectionPage");
    const mainEntity = collection.mainEntity;
    if (mainEntity === null || typeof mainEntity !== "object") {
      throw new Error("test: węzeł katalogu nie ma listy");
    }
    const items = (mainEntity as { itemListElement?: unknown }).itemListElement;
    if (!Array.isArray(items)) throw new Error("test: `itemListElement` nie jest listą");

    expect(items).toHaveLength(2);
    expect(items.map((item: { position?: unknown }) => item.position)).toEqual([1, 2]);
    expect(JSON.stringify(items)).toContain("wczesniejsze");
    expect(JSON.stringify(items)).not.toContain("minione");
  });

  it("PUSTY katalog daje węzeł z PUSTĄ listą, a nie brak węzła", async () => {
    // Brak węzła i węzeł z pustą listą to dla robota dwie różne rzeczy:
    // pierwsza znaczy „to nie jest katalog", druga „katalog, dziś pusty".
    const data = await runLoader();

    const collection = jsonLd(head(data).scripts ?? [], "CollectionPage");
    const mainEntity = collection.mainEntity;
    if (mainEntity === null || typeof mainEntity !== "object") {
      throw new Error("test: węzeł katalogu nie ma listy");
    }

    expect((mainEntity as { itemListElement?: unknown }).itemListElement).toEqual([]);
  });

  it("przy DEGRADACJI zostają SAME okruszki - ścieżka jest prawdziwa, katalog nieznany", async () => {
    // Druga połowa naprawy niżej. Węzeł katalogu znika, ale `BreadcrumbList`
    // ZOSTAJE: ścieżka „Start > Wydarzenia" jest prawdziwa niezależnie od
    // tego, czy lista dojechała, więc usunięcie jej byłoby zubożeniem wyniku
    // wyszukiwania bez żadnego zysku.
    h.listThrows = true;
    const data = await runLoader();

    expect(data.degraded).toBe(true);
    const scripts = head(data).scripts ?? [];
    expect(scripts).toHaveLength(1);
    expect(jsonLd(scripts, "BreadcrumbList").itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Start", item: "https://nes.eu/" },
      { "@type": "ListItem", position: 2, name: "Wydarzenia" },
    ]);
  });

  it("render ZDEGRADOWANY nie wysyła robotowi katalogu BEZ ANI JEDNEGO wydarzenia", async () => {
    // NAPRAWIONY DEFEKT. Nagłówek trasy mówi wprost: przy awarii transportu
    // strona „NIE udaje, że wydarzeń nie ma" - i BODY nie udawało, bo pokazuje
    // komunikat z ponowieniem. Warstwa danych strukturalnych o tej zasadzie nie
    // wiedziała: `head()` dostawał `loaderData.headEvents === []` i beztrosko
    // budował z tego `CollectionPage` z PUSTĄ listą `ItemList`.
    //
    // DLACZEGO TO NIE BYŁO NIESZKODLIWE. Odpowiedź wychodzi z HTTP 200 (to
    // jest cała pointa degradacji), a `Cache-Control: private, no-store`
    // odcina wyłącznie CACHE - indeksowania nie blokuje; robi to `noindex`,
    // którego tu nie ma. Blip backendu w chwili odwiedzin crawlera podawał
    // mu więc oświadczenie „katalog wydarzeń tego serwisu jest pusty",
    // podpisane danymi strukturalnymi - a to jest dokładnie to zdanie,
    // którego trasa świadomie nie mówi człowiekowi.
    h.listThrows = true;
    const data = await runLoader();

    // Zdegradowany dokument nie składa robotowi oświadczenia o zawartości
    // katalogu.
    const typy = (head(data).scripts ?? []).map((script) => {
      const parsed: unknown = JSON.parse(script.children ?? "{}");
      return parsed !== null && typeof parsed === "object" && "@type" in parsed
        ? String((parsed as Record<string, unknown>)["@type"])
        : "";
    });
    expect(typy).not.toContain("CollectionPage");
  });
});

describe("ekran katalogu - trzy różne fakty, trzy różne widoki", () => {
  it("moduł wyłączony pokazuje ZAPROSZENIE do innej części serwisu, nie pustkę", async () => {
    h.eventsEnabled = false;

    await zamontuj();

    expect(screen.getByTestId("modul-wylaczony")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("DEGRADACJA mówi „nie udało się wczytać”, a NIE „brak wydarzeń”", async () => {
    // Najważniejsza asercja tego bloku. Pusta lista w miejscu awarii to zarzut
    // wobec organizatora, że jego wydarzenia zniknęły - zamiast informacji, że
    // to my mamy problem, i przycisku, którym czytelnik może spróbować jeszcze
    // raz (po hydratacji backend zwykle już odpowiada).
    h.listThrows = true;

    await zamontuj();

    expect(screen.getByTestId("komunikat-degradacji")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("community.events.empty")).toBeNull();
  });

  it("komunikat degradacji jest po polsku, a przy adresie EN - po angielsku", async () => {
    // OBA języki w jednym przypadku, bo dowodem jest RÓŻNICA. Awaria to jedyny
    // ekran, którego napisy nie idą przez słownik i18next (komunikat powstaje
    // w trasie), więc jest to jedyne miejsce w katalogu, gdzie język łatwo
    // zabetonować na polskim i nie zauważyć tego przez miesiące.
    h.listThrows = true;

    await zamontuj();
    expect(screen.getByTestId("komunikat-degradacji").dataset.title).toBe(
      "Nie udało się załadować wydarzeń",
    );

    cleanup();
    h.requestUrl = "https://nes.eu/en/events";

    await zamontuj();
    expect(screen.getByTestId("komunikat-degradacji").dataset.title).toBe("Couldn't load events");
  });

  it("PUSTY katalog to stan NORMALNY: dwie sekcje, dwa zdania, zero alarmu", async () => {
    await zamontuj();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "community.events.title" }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("community.events.empty")).toBeTruthy();
    expect(screen.getByText("community.events.pastEmpty")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("komunikat-degradacji")).toBeNull();
  });

  it("nadchodzące i archiwum to DWIE sekcje - wydarzenie trafia dokładnie do jednej", async () => {
    h.events = [
      row({ id: "1", slug: "przyszle", title_pl: "Kongres przyszły", starts_at: ZA_ROK }),
      row({ id: "2", slug: "minione", title_pl: "Kongres miniony", starts_at: DAWNO }),
    ];

    await zamontuj();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    const sekcje = screen.getAllByRole("list");
    expect(sekcje).toHaveLength(2);
    expect(sekcje[0].textContent).toContain("Kongres przyszły");
    expect(sekcje[0].textContent).not.toContain("Kongres miniony");
    expect(sekcje[1].textContent).toContain("Kongres miniony");
  });

  it("nadchodzące idą od NAJBLIŻSZEGO, archiwum od NAJŚWIEŻSZEGO", async () => {
    // Dwie przeciwne kolejności i to nie jest niekonsekwencja: u góry
    // czytelnik szuka „co dalej", w archiwum - „co było ostatnio". Jedna
    // wspólna kolejność zepsułaby jedno albo drugie.
    h.events = [
      row({ id: "1", slug: "za-dwa-lata", title_pl: "Za dwa lata", starts_at: ZA_DWA_LATA }),
      row({ id: "2", slug: "za-rok", title_pl: "Za rok", starts_at: ZA_ROK }),
      row({ id: "3", slug: "dawno", title_pl: "Dawno temu", starts_at: DAWNO }),
      row({ id: "4", slug: "rok-temu", title_pl: "Rok temu", starts_at: ROK_TEMU }),
    ];

    await zamontuj();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
    const [nadchodzace, archiwum] = screen.getAllByRole("list");
    const tytuly = (list: HTMLElement) =>
      Array.from(list.querySelectorAll("h3")).map((node) => node.textContent);

    expect(tytuly(nadchodzace)).toEqual(["Za rok", "Za dwa lata"]);
    expect(tytuly(archiwum)).toEqual(["Rok temu", "Dawno temu"]);
  });

  it("sekcja PUSTA obok sekcji pełnej dalej mówi zdaniem, a nie znika", async () => {
    // Serwis, który dopiero startuje, ma same nadchodzące. Zniknięta sekcja
    // archiwum czyta się jak brakujący kawałek strony.
    h.events = [row({ id: "1", slug: "przyszle", starts_at: ZA_ROK })];

    await zamontuj();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("community.events.pastEmpty")).toBeTruthy();
    expect(screen.queryByText("community.events.empty")).toBeNull();
  });

  it("kafel prowadzi POD ADRES WYDARZENIA, nie pod wzorzec trasy", async () => {
    // Odnośnik z niepodstawionym `$slug` wygląda w DOM-ie poprawnie i klika
    // się w 404. To jest jedyny sposób wejścia z katalogu na wydarzenie.
    h.events = [row({ id: "1", slug: "kongres-cee-2026", starts_at: ZA_ROK })];

    await zamontuj();

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/events/kongres-cee-2026");
  });

  it("zamontowany katalog nie ma naruszeń axe", async () => {
    h.events = [
      row({
        id: "1",
        slug: "przyszle",
        starts_at: ZA_ROK,
        cover_url: "https://cdn.example.org/a.jpg",
      }),
      row({ id: "2", slug: "minione", starts_at: DAWNO }),
    ];

    const { container } = await zamontuj();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("kafel katalogu - co czytelnik wie PRZED kliknięciem", () => {
  it("briefing Pro jest oznaczony JAKO briefing, nie jako zwykłe wydarzenie członkowskie", async () => {
    // Bramka warstwy odkryta dopiero na stronie wydarzenia to zmarnowane
    // kliknięcie - a przy briefingu Pro dodatkowo zła nazwa benefitu:
    // to nie jest „tylko dla członków", tylko konkretny produkt cennika.
    h.events = [
      row({
        id: "1",
        slug: "briefing",
        starts_at: ZA_ROK,
        visibility: "members",
        kind: "briefing",
        capacity: 120,
        location: null,
      }),
    ];

    await zamontuj();

    await waitFor(() => expect(screen.getByText("community.events.proBriefing")).toBeTruthy());
    // Limit miejsc stoi na kaflu, bo to on decyduje, czy warto się spieszyć.
    expect(screen.getByRole("listitem").textContent).toContain("120");
  });

  it("wydarzenie członkowskie NIE-briefingowe dostaje plakietkę członkowską", async () => {
    h.events = [row({ id: "1", slug: "spotkanie", starts_at: ZA_ROK, visibility: "members" })];

    await zamontuj();

    await waitFor(() => expect(screen.getByText("community.events.membersOnly")).toBeTruthy());
    expect(screen.queryByText("community.events.proBriefing")).toBeNull();
  });

  it("wydarzenie BEZ strefy pokazuje samą godzinę, a nie pusty nawias", async () => {
    // Pusty nawias po godzinie czyta się jak brakujące dane. Strefa jest
    // dopisywana WYŁĄCZNIE wtedy, gdy jest co dopisać.
    h.events = [row({ id: "1", slug: "bez-strefy", starts_at: ZA_ROK, timezone: null })];

    await zamontuj();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("listitem").textContent).not.toContain("()");
  });

  it("wydarzenie BEZ opisu nie rysuje pustego akapitu pod tytułem", async () => {
    h.events = [
      row({
        id: "1",
        slug: "bez-opisu",
        starts_at: ZA_ROK,
        description_pl: null,
        description_en: null,
      }),
    ];

    await zamontuj();

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("listitem").querySelector("p.line-clamp-3")).toBeNull();
  });

  it("wydarzenie BEZ tytułu w żadnym języku wchodzi do danych strukturalnych PO SLUGU", async () => {
    // Węzeł `Event` bez `name` jest dla robota niekompletny i wypada z wyników
    // rozszerzonych. Slug jest ostatnią rzeczą, która na pewno istnieje.
    h.events = [
      row({ id: "1", slug: "kongres-bez-nazwy", starts_at: ZA_ROK, title_pl: "", title_en: "" }),
    ];
    const data = await runLoader();

    const collection = jsonLd(head(data).scripts ?? [], "CollectionPage");

    expect(JSON.stringify(collection.mainEntity)).toContain("kongres-bez-nazwy");
  });
});

describe("stany przejściowe trasy - jeden komplet, nie dwa", () => {
  it("ekran oczekiwania to SZKIELET LISTY, a nie pusty ekran ani spinner", async () => {
    // Szkielet trzyma wysokość strony, więc treść nie przeskakuje po dojściu
    // danych. Pusty ekran w tym miejscu daje na wolnym łączu mignięcie „brak
    // wydarzeń" przed listą.
    const pending: unknown = EventsIndexRoute.options.pendingComponent;
    if (!isRouteStateComponent(pending)) throw new Error("test: trasa nie ma ekranu oczekiwania");
    const { render } = await import("@testing-library/react");

    const { getByTestId } = render(pending({}));

    expect(getByTestId("szkielet-listy")).toBeTruthy();
  });

  it("ekran błędu trasy nazywa rzecz po imieniu i robi to w JĘZYKU CZYTELNIKA", async () => {
    // Wspólny ekran awarii bez tytułu mówi „coś poszło nie tak" - czytelnik nie
    // wie nawet, czego dotyczyło. Tytuł jest tym, co odróżnia awarię katalogu
    // od awarii całego serwisu.
    h.requestUrl = "https://nes.eu/en/events";
    const errorComponent: unknown = EventsIndexRoute.options.errorComponent;
    if (!isRouteStateComponent(errorComponent)) {
      throw new Error("test: trasa nie ma ekranu błędu");
    }
    const { render } = await import("@testing-library/react");

    const { getByTestId } = render(errorComponent({ error: new Error("padło") }));

    expect(getByTestId("ekran-bledu").dataset.title).toBe("Failed to load events");
  });
});
