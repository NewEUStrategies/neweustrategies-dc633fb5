// Trasa PUBLICZNA `/tracker/explorer` - macierz stanowisk i koalicji.
// Do dziś: 0 z 41 linii.
//
// ── DECYZJA N4 DLA TEJ TRASY: NAPRAWIONE, NIE ODRZUCONE ────────────────────
//
// Audyt modułu 07 wymienił cztery trasy treściowe bez loadera. Dla tej
// rozstrzygnięcie brzmi NAPRAWIĆ i naprawa jest w tym samym commicie co ten
// plik. Uzasadnienie, w kolejności wagi:
//
//   1. `useQuery` NIE STARTUJE FETCHA NA SERWERZE, więc crawler i pierwsze
//      malowanie dostawały `t("tracker.loading")` - a powłoka bez treści
//      wchodzi do NES Edge Cache na do 24 h.
//   2. TO JEDYNA POWIERZCHNIA, NA KTÓREJ TE DANE ISTNIEJĄ. Kanał
//      `/tracker/rss.xml` niesie wpisy osi czasu, `/tracker` niesie karty
//      dossier, a przekrój „dossier x 27 państw" nie schodzi z serwera
//      NIGDZIE INDZIEJ. Nie ma więc żadnej wersji tej treści, którą crawler
//      mógłby przeczytać zamiast tej.
//   3. `head()` tej trasy deklaruje indeksowalny tytuł i opis w OBU
//      językach, czyli trasa JEST zgłoszona do indeksu jako treść. Argument
//      „to narzędzie interaktywne, nie treść" rozbija się o jej własne meta.
//
// ROZWAŻONE I ODRZUCONE: „dane przyjdą z loadera trasy nadrzędnej i tu
// wystarczy je przefiltrować". Sprawdzone w `routeTree.gen.ts`: pliku
// `tracker.tsx` NIE MA, rodzicem `/tracker/*` jest `__root`, więc nie ma
// czyich danych filtrować.
//
// CENA, KTÓRĄ ZAPŁACILIŚMY ŚWIADOMIE: kaskada dwóch fal. Klucz stanowisk
// zawiera identyfikatory dossier (`positions-bulk` + posortowany join), więc
// druga fala MUSI poczekać na pierwszą. Dlatego fala pierwsza (statystyki
// i dossier) biegnie równolegle, a druga ma krótszy budżet - i dlatego blok
// „fale loadera" niżej mierzy to jako kontrakt, a nie jako szczegół.
//
// BRAK `notFound()` ZOSTAJE: pusty tracker (nowy tenant, dossier bez ani
// jednego stanowiska) to legalny stan z komunikatem `tracker.explorer.noData`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `src/lib/tracker/queries.ts` biegnie tu PRAWDZIWY (atrapowany jest tylko
//   klient PostgREST i RPC), więc klucze cache i filtry są tymi z produkcji.
// - RADIXOWEJ WARSTWY ROZWIJANEJ: `@/components/ui/select` jest podmieniony na
//   natywny `<select>` (wspólna atrapa `radixSelectStub`), bo Radix nie
//   otwiera listy pod happy-dom. Przedmiotem dowodu jest tu SKUTEK wyboru
//   obszaru (nowy odczyt), nie animacja listy.
// - KONTRAKTU NAGŁÓWKA `x-tenant-host`: ma własny plik
//   `src/integrations/supabase/__tests__/tenantHostFetch.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, render, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `eu_policy_items` ze WSZYSTKICH obszarów roboczych. */
  items: [] as Record<string, unknown>[],
  /** Wiersze `eu_policy_positions` ze WSZYSTKICH obszarów roboczych. */
  positions: [] as Record<string, unknown>[],
  /** Wynik RPC `get_tracker_stats`. */
  stats: null as Record<string, unknown> | null,
  /**
   * Tenant PRZEGLĄDANEJ domeny - atrapa odgrywa politykę
   * `tenant_id = public_tenant_id()`. Trasa własnego porównania tenantów nie
   * ma i mieć nie powinna, więc modelujemy SKUTEK.
   */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** Powierzchnie, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Etykiety odczytów w kolejności - podstawa pomiaru fal loadera. */
  reads: [] as string[],
  /** Wartości filtra `policy_area`, z jakimi produkcja weszła w odczyt. */
  areaFilters: [] as unknown[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/tracker/explorer",
  /** Nagłówki `Cache-Control` ustawione przez loader. */
  cacheControl: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const stub = supabaseFromStub();
  const rpc = supabaseRpcStub();

  /** Wszystkie pary `.eq(kolumna, wartość)` łańcucha - `argsOf` daje pierwszą. */
  function eqMap(calls: ReadonlyArray<{ method: string; args: ReadonlyArray<unknown> }>) {
    const out = new Map<string, unknown>();
    for (const call of calls) {
      if (call.method === "eq" && typeof call.args[0] === "string") {
        out.set(call.args[0], call.args[1]);
      }
    }
    return out;
  }

  stub.setResponse("eu_policy_items", (chain) => {
    h.reads.push("eu_policy_items");
    if (h.broken.has("eu_policy_items")) return fail("test: tabela eu_policy_items niedostepna");
    const eq = eqMap(chain.calls);
    h.areaFilters.push(eq.get("policy_area"));
    const area = eq.get("policy_area");
    return ok(
      h.items
        .filter((row) => row.tenant_id === h.tenantId)
        .filter((row) => row.status === eq.get("status"))
        .filter((row) => area === undefined || row.policy_area === area),
    );
  });
  stub.setResponse("eu_policy_positions", (chain) => {
    h.reads.push("eu_policy_positions");
    if (h.broken.has("eu_policy_positions")) {
      return fail("test: tabela eu_policy_positions niedostepna");
    }
    const inArgs = chain.argsOf("in");
    const ids = Array.isArray(inArgs?.[1]) ? (inArgs[1] as unknown[]) : [];
    return ok(
      h.positions
        .filter((row) => row.tenant_id === h.tenantId)
        .filter((row) => ids.includes(row.item_id)),
    );
  });
  rpc.setResponse("get_tracker_stats", () => {
    h.reads.push("get_tracker_stats");
    if (h.broken.has("get_tracker_stats")) return fail("test: RPC get_tracker_stats niedostepny");
    return ok(h.stats);
  });
  return { supabase: { from: stub.from, rpc: rpc.rpc } };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

// Radix nie otwiera listy pod happy-dom (potrzebuje realnego wskaźnika
// i pomiarów układu), więc test nie miałby jak wybrać obszaru - a wybór
// obszaru jest tu całą treścią zachowania filtra.
vi.mock("@/components/ui/select", async () => {
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(await import("react"));
});

// `<Link>` czyta kontekst routera i wywraca się bez `RouterProvider`, a blok
// „wyjście serwera" renderuje KOMPONENT trasy poza routerem (bo tylko tak
// widać HTML serwera). Podmieniamy JEDNO wiązanie; `createFileRoute`,
// `RouterProvider` i reszta modułu zostają prawdziwe.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Ekran awarii trasy: `FriendlyErrorPage` pod nim woła `useRouter()`, więc bez
// `RouterProvider` nie da się go wyrenderować - a przedmiotem dowodu jest tu
// WYŁĄCZNIE to, JAKI TYTUŁ trasa mu podaje (do 2026-09-02 był to polski
// literał, widziany także przez czytelnika wersji angielskiej). Marker echuje
// ten prop; sam ekran ma własny plik testowy.
vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: (props: { title?: string }) => (
    <div data-testid="route-error">{String(props.title)}</div>
  ),
}));

import "@/test/i18nReal";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import {
  positionsForItemsQueryOptions,
  publishedItemsQueryOptions,
  trackerStatsQueryOptions,
} from "@/lib/tracker/queries";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as ExplorerRoute } from "@/routes/tracker.explorer";

const PATH = "/tracker/explorer";
// Identyfikatory obszarów roboczych. Ten sam literał stoi w fabryce
// `vi.hoisted` wyżej: vitest wynosi ją nad importy i nad te deklaracje, więc
// odwołanie do stałej z tamtego miejsca padłoby na „cannot access before
// initialization".
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** Ten sam literał, którym trasa woła loader i inicjuje stan komponentu. */
const MATRIX_LIMIT = 100;
const ITEM_ID = "11111111-1111-4111-8111-111111111111";

// ── fixtures (RODO: wszystkie dossier są ZMYŚLONE) ──────────────────────────

function item(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ITEM_ID,
    tenant_id: TENANT_A,
    slug: "akt-o-rynkach-danych",
    title_pl: "Akt o rynkach danych",
    title_en: "Data Markets Act",
    summary_pl: "Zasady dostępu do danych przemysłowych.",
    summary_en: "Rules on access to industrial data.",
    policy_area: "digital",
    stage: "council",
    importance: 3,
    reference: "2026/0101(COD)",
    source_url: "https://example.org/dossier",
    rapporteur: null,
    committee: null,
    lead_dg: null,
    next_milestone_pl: null,
    next_milestone_en: null,
    next_milestone_at: null,
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

function position(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant_id: TENANT_A,
    item_id: ITEM_ID,
    country_code: "PL",
    stance: "support",
    note_pl: null,
    note_en: null,
    updated_at: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

const STATS = { total: 12, by_stage: { council: 7 }, by_area: { digital: 5 } };

async function mount(queryClient?: QueryClient) {
  return renderRoute({ route: ExplorerRoute, path: PATH, initialEntry: PATH, queryClient });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
// `httpEquiv` w unii kluczy: `head()` tych tras emituje nie tylko
// `name`/`property`, ale też `http-equiv` (np. `content-language`),
// a helper skopiowany z innego testu tego klucza nie znał.
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

/** Komponent trasy - STRAŻNIK, nie rzutowanie. */
function explorerComponent(): () => ReactElement {
  const component: unknown = ExplorerRoute.options.component;
  if (typeof component !== "function") throw new Error("test: trasa nie ma komponentu");
  return component as () => ReactElement;
}

type ExplorerLoader = (ctx: {
  context: { queryClient: QueryClient };
}) => Promise<{ degraded: boolean }>;

function explorerLoader(): ExplorerLoader {
  const loader: unknown = ExplorerRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as ExplorerLoader;
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/** Wyjście SERWERA komponentu trasy - `render()` z RTL tego nie pokaże, bo
 *  efekty montowania (start fetcha) wykonują się przed powrotem z `render`. */
function ssr(queryClient: QueryClient): string {
  const Component = explorerComponent();
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.items = [item()];
  h.positions = [position()];
  h.stats = STATS;
  h.tenantId = TENANT_A;
  h.broken = new Set<string>();
  h.reads = [];
  h.areaFilters = [];
  h.requestUrl = "https://nes.example.org/tracker/explorer";
  h.cacheControl = [];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /tracker/explorer - macierz stanowisk", () => {
  it("wiersz macierzy linkuje do dossier, a komórka niesie tekst dla czytnika", async () => {
    // Kolor komórki jest CAŁĄ informacją tej strony, więc bez tekstowego
    // odpowiednika (`sr-only`) macierz nie istnieje dla czytnika ekranu ani
    // dla crawlera - a to jest jedyne miejsce w serwisie z tymi danymi.
    await mount();

    expect(await screen.findByRole("link", { name: "Akt o rynkach danych" })).toHaveAttribute(
      "href",
      "/tracker/akt-o-rynkach-danych",
    );
    expect(screen.getByText("Polska: Za")).toBeInTheDocument();
  });

  it("do macierzy wchodzą TYLKO dossier z co najmniej jednym stanowiskiem", async () => {
    // Wiersz bez ani jednego stanowiska to 27 pustych kratek - szum, który
    // wypycha z ekranu wiersze niosące treść.
    h.items = [
      item(),
      item({
        id: "22222222-2222-4222-8222-222222222222",
        slug: "bez-stanowisk",
        title_pl: "Dossier bez stanowisk",
      }),
    ];
    await mount();

    expect(await screen.findByRole("link", { name: "Akt o rynkach danych" })).toBeInTheDocument();
    expect(screen.queryByText("Dossier bez stanowisk")).not.toBeInTheDocument();
  });

  it("kafle statystyk pokazują liczbę dossier i rozkłady, nie zaślepkę", async () => {
    await mount();

    expect(await screen.findByText("12")).toBeInTheDocument();
    // Rozkłady jadą przez etykiety domeny, nie przez surowe klucze bazy
    // (`council`, `digital`). Etykieta obszaru występuje na stronie DWA razy -
    // w kaflu i na liście filtra - więc liczba obok niej jest tu jedynym
    // jednoznacznym dowodem, że kafel dostał dane z RPC.
    expect(screen.getByText("Rada")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getAllByText("Cyfryzacja").length).toBeGreaterThan(0);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("po angielsku bierze angielski tytuł dossier i angielską etykietę stanowiska", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(await screen.findByRole("link", { name: "Data Markets Act" })).toBeInTheDocument();
    expect(screen.getByText("Poland: In favour")).toBeInTheDocument();
    expect(screen.queryByText("Akt o rynkach danych")).not.toBeInTheDocument();
  });

  it("filtr obszaru ZAWĘŻA ODCZYT, a nie tylko przestawia etykietę", async () => {
    // Filtr zmienia KLUCZ zapytania, więc jego jedynym widocznym skutkiem jest
    // nowy odczyt z `policy_area`. Gdyby przestał dochodzić do zapytania,
    // strona wyglądałaby identycznie i pokazywała wszystko przy każdym filtrze.
    await mount();
    await screen.findByRole("link", { name: "Akt o rynkach danych" });

    fireEvent.change(screen.getByLabelText("Obszar polityki"), { target: { value: "energy" } });

    await waitFor(() => expect(h.areaFilters).toContain("energy"));
  });

  it("nie zostawia macierzy z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByRole("link", { name: "Akt o rynkach danych" });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /tracker/explorer - stan pusty i degradacja", () => {
  it("brak dossier ze stanowiskami daje komunikat, nie 404 i nie pustą tabelę", async () => {
    h.positions = [];
    await mount();

    expect(
      await screen.findByText("Brak dossier ze stanowiskami dla wybranego filtra."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.positions = [];
    await mount();

    expect(
      await screen.findByText("No files with positions for the selected filter."),
    ).toBeInTheDocument();
  });

  it("awaria KTÓREJKOLWIEK z trzech powierzchni nie wywraca trasy", async () => {
    // Gołe `ensureQueryData` zamieniłoby blip jednej z nich w HTTP 500 na całej
    // stronie - a wtedy crawler traktuje ją jako awarię serwera i wypada ona
    // z indeksu. Zdegradowany render woli pustkę niż piątkę.
    h.broken.add("get_tracker_stats");
    h.broken.add("eu_policy_items");
    await mount();

    expect(
      await screen.findByRole("heading", { level: 1, name: /Explorer stanowisk/ }),
    ).toBeInTheDocument();
  });

  it("zdegradowany render deklaruje no-store, czysty - politykę treści", async () => {
    // Bez tego rozróżnienia brzeg zapamiętałby pustą macierz na cały okres
    // świeżości i serwowałby ją kolejnym czytelnikom po powrocie bazy.
    h.broken.add("eu_policy_positions");
    const degraded = await explorerLoader()({ context: { queryClient: freshClient() } });
    expect(degraded.degraded).toBe(true);
    expect(h.cacheControl.at(-1)).toContain("no-store");

    h.broken = new Set<string>();
    h.cacheControl = [];
    const clean = await explorerLoader()({ context: { queryClient: freshClient() } });
    expect(clean.degraded).toBe(false);
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });

  it("awaria samych STATYSTYK też liczy się jako degradacja", async () => {
    // Kafle są treścią nad zgięciem. Gdyby RPC wypadł z rachunku `degraded`,
    // strona z zerami w kaflach weszłaby do cache'a wspólnego na 15 minut.
    h.broken.add("get_tracker_stats");
    const data = await explorerLoader()({ context: { queryClient: freshClient() } });

    expect(data.degraded).toBe(true);
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });
});

describe("trasa /tracker/explorer - izolacja obszarów roboczych", () => {
  it("dossier innego obszaru roboczego nie pojawia się w macierzy tego hosta", async () => {
    // Autorytetem jest polityka publiczna (`tenant_id = public_tenant_id()`):
    // wiersz obcego tenanta NIE WRACA z odczytu. Test pilnuje SKUTKU -
    // komunikat pustki, nie cudze dossier w macierzy.
    h.items = [item({ tenant_id: TENANT_B, title_pl: "Dossier obcego obszaru" })];
    h.positions = [position({ tenant_id: TENANT_B })];
    await mount();

    expect(
      await screen.findByText("Brak dossier ze stanowiskami dla wybranego filtra."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dossier obcego obszaru")).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: te same wiersze na własnym hoście malują macierz", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa nie
    // renderowała NICZEGO - a to nie izolacja, tylko awaria.
    h.items = [item({ tenant_id: TENANT_B, title_pl: "Dossier obcego obszaru" })];
    h.positions = [position({ tenant_id: TENANT_B })];
    h.tenantId = TENANT_B;
    await mount();

    expect(await screen.findByRole("link", { name: "Dossier obcego obszaru" })).toBeInTheDocument();
  });

  it("stanowisko obcego obszaru nie dokleja się do WŁASNEGO dossier", async () => {
    // Osobny przypadek, bo stanowiska mają własną politykę: gdyby wypadła,
    // na naszym dossier pojawiłby się kolor deklarowany w cudzym obszarze.
    h.positions = [position({ tenant_id: TENANT_B, country_code: "DE", stance: "oppose" })];
    await mount();

    expect(
      await screen.findByText("Brak dossier ze stanowiskami dla wybranego filtra."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Niemcy: Przeciw")).not.toBeInTheDocument();
  });
});

describe("trasa /tracker/explorer - nagłówek dokumentu", () => {
  it("po polsku tytuł i opis mówią o przekroju stanowisk", async () => {
    const head = routeHead(ExplorerRoute);

    expect(headTitle(head)).toBe("Explorer stanowisk i koalicji - tracker legislacyjny UE");
    expect(metaContent(head, "name", "description")).toBe(
      "Przekrój stanowisk państw członkowskich wobec kluczowych dossier legislacyjnych UE.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł i opis", async () => {
    // `head()` biegnie POZA drzewem Reacta, więc o języku rozstrzyga wyłącznie
    // prefiks adresu - nie singleton i18next wspólny dla żądań SSR.
    h.requestUrl = "https://nes.example.org/en/tracker/explorer";
    const head = routeHead(ExplorerRoute);

    expect(headTitle(head)).toBe("Positions & coalitions explorer - EU legislative tracker");
    expect(metaContent(head, "name", "description")).toBe(
      "A cross-section of member state positions on key EU legislative files.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("NIE wyłącza się z indeksu i deklaruje kanoniczny plus hreflang", async () => {
    // Trasa zgłoszona do indeksu jest właśnie tym, co przesądziło decyzję N4:
    // nie wolno jednocześnie prosić o indeksowanie i oddawać powłoki.
    const head = routeHead(ExplorerRoute);

    expect((head.meta ?? []).filter((entry) => entry.name === "robots")).toEqual([]);
    expect((head.links ?? []).find((link) => link.rel === "canonical")?.href).toBe(
      "https://nes.example.org/tracker/explorer",
    );
    expect(
      (head.links ?? [])
        .filter((link) => link.rel === "alternate")
        .map((link) => link.hrefLang)
        .sort(),
    ).toEqual(["en", "pl", "x-default"]);
  });
});

// ── FALE LOADERA I WYJŚCIE SERWERA ─────────────────────────────────────────
//
// Blok mierzy DWIE rzeczy, których nie widać w DOM: kolejność odczytów loadera
// (bo kaskada jest tu ceną decyzji N4) i HTML, który naprawdę wychodzi
// z serwera. Ma KONTROLĘ DODATNIĄ - ten sam render bez rozgrzanego cache'a.

describe("trasa /tracker/explorer - fale loadera", () => {
  it("rozgrzewa TRZY klucze, których czyta komponent, w dwóch falach", async () => {
    // Rozjazd któregokolwiek klucza daje SSR pod jednym wpisem i odczyt
    // kliencki pod innym: treść zeszłaby z serwera i została pobrana PO RAZ
    // DRUGI, bez żadnego błędu.
    const queryClient = freshClient();
    await explorerLoader()({ context: { queryClient } });

    expect(queryClient.getQueryData(trackerStatsQueryOptions().queryKey)).toEqual(STATS);
    expect(
      queryClient.getQueryData(publishedItemsQueryOptions({}, MATRIX_LIMIT).queryKey),
    ).toHaveLength(1);
    expect(
      queryClient.getQueryData(positionsForItemsQueryOptions([ITEM_ID]).queryKey),
    ).toHaveLength(1);
    // Stanowiska są OSTATNIE, bo ich klucz zawiera identyfikatory z fali 1.
    expect(h.reads.at(-1)).toBe("eu_policy_positions");
  });

  it("pusta lista dossier NIE wywołuje drugiej fali", async () => {
    // Odczyt stanowisk dla zera identyfikatorów to round-trip po nic - a przy
    // pustym trackerze (nowy tenant) byłby to koszt na każdym żądaniu.
    h.items = [];
    const queryClient = freshClient();
    await explorerLoader()({ context: { queryClient } });

    expect(h.reads).not.toContain("eu_policy_positions");
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });

  it("po rozgrzaniu przez loader klient NIE dokłada round-tripu na hydratacji", async () => {
    // To cały sens naprawy: treść wyrenderowana serwerowo hydratuje się
    // z dehydrowanego cache'a, a nie z trzech kolejnych zapytań czytelnika.
    const queryClient = freshClient();
    await explorerLoader()({ context: { queryClient } });
    const loaderReads = [...h.reads];

    const view = await mount(queryClient);
    await screen.findByRole("link", { name: "Akt o rynkach danych" });
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(h.reads.slice(loaderReads.length), "odczyty po hydratacji").toEqual([]);
  });

  it("wyjście serwera zawiera tytuł dossier i tekst stanowiska", async () => {
    const queryClient = freshClient();
    await explorerLoader()({ context: { queryClient } });

    const html = ssr(queryClient);

    expect(html).toContain("Akt o rynkach danych");
    expect(html).toContain("Polska: Za");
    expect(html).not.toContain("Wczytywanie");
  });

  it("KONTROLA DODATNIA: bez rozgrzania serwer oddaje powłokę z zaślepką kafla", async () => {
    // To jest stan, który naprawia loader: `useQuery` ma na serwerze
    // `isLoading: true`, więc zamiast macierzy schodzi gałąź ładowania,
    // a kafel statystyk pokazuje zaślepkę. Gdyby ktoś wyciął loader,
    // poprzedni test zrobi się czerwony, a ten zostanie zielony.
    const html = ssr(freshClient());

    expect(html).toContain("Wczytywanie");
    expect(html).not.toContain("Akt o rynkach danych");
  });
});

// ── DEFEKT PRZYPIĘTY, NIE NAPRAWIONY ───────────────────────────────────────
//
// Loader tej trasy ODRÓŻNIA blip backendu od pustego trackera (zwraca
// `degraded` i zdejmuje nagłówek cache'a wspólnego), ale KOMPONENT tego
// sygnału nie czyta: przy padniętej bazie czytelnik dostaje zdanie „Brak
// dossier ze stanowiskami dla wybranego filtra", które jest wtedy NIEPRAWDĄ
// i nie daje mu żadnej wskazówki, że ma ponowić.
//
// DLACZEGO NIE NAPRAWIAM TEGO TUTAJ: naprawa wymaga `Route.useLoaderData()`
// w komponencie, a to odbiera możliwość renderowania komponentu POZA routerem
// - czyli wysadza blok „wyjście serwera" wyżej, który jest jedynym dowodem
// naprawy N4 dla tej trasy (`renderToString` widzi wyjście serwera, `render()`
// z RTL nie). Domknięcie wymaga harnessu, który renderuje serwerowo CAŁE
// drzewo routera; to osobna praca na `src/test/routeHarness.tsx`.
// Wzorzec docelowy jest już w repo: `/tracker` (indeks) czyta `degraded`
// z loadera i renderuje `DegradedDataNotice` zamiast zdania o pustce.
//
// Para poniżej jest zapisem KONTRAKTU (`it.fails`) i DZISIEJSZEGO zachowania
// (kontrola dodatnia). Gdy defekt zostanie naprawiony, `it.fails` zacznie
// przechodzić i wymusi zdjęcie tej adnotacji.

describe("trasa /tracker/explorer - zdegradowana macierz kłamie o braku stanowisk", () => {
  it.fails("POWINNA mówić o awarii sekcji, a nie o braku dossier ze stanowiskami", async () => {
    h.broken.add("eu_policy_items");
    h.broken.add("eu_policy_positions");
    await mount();

    // Kontrakt: ten sam ekran, który `/tracker` pokazuje przy degradacji.
    expect(await screen.findByText("Ta sekcja chwilowo nie ma danych")).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: dziś zdegradowany render pokazuje komunikat pustki", async () => {
    // Bez tego przypadku `it.fails` wyżej przechodziłby też wtedy, gdyby trasa
    // przy awarii nie renderowała NICZEGO - a to inny defekt niż opisany.
    h.broken.add("eu_policy_items");
    h.broken.add("eu_policy_positions");
    await mount();

    expect(
      await screen.findByText("Brak dossier ze stanowiskami dla wybranego filtra."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ta sekcja chwilowo nie ma danych")).not.toBeInTheDocument();
  });
});

/** `errorComponent` trasy jako komponent - STRAŻNIK, nie rzutowanie. */
function routeErrorComponent(): (props: { error: Error; reset: () => void }) => ReactElement {
  const component: unknown = ExplorerRoute.options.errorComponent;
  if (typeof component !== "function") throw new Error("test: trasa nie ma errorComponent");
  return component as (props: { error: Error; reset: () => void }) => ReactElement;
}

describe("trasa /tracker/explorer - ekran awarii mówi językiem strony", () => {
  it("po polsku podaje zdanie ze słownika, nie literał z kodu", async () => {
    // Do 2026-09-02 tytuł ekranu awarii był wpisany po polsku na sztywno, więc
    // czytelnik wersji angielskiej dostawał jedyny polski napis na stronie -
    // i nie było tego widać w żadnym teście ani w interfejsie.
    const ErrorComponent = routeErrorComponent();
    render(<ErrorComponent error={new Error("test: awaria")} reset={() => {}} />);

    expect(screen.getByTestId("route-error")).toHaveTextContent(
      "Nie udało się wczytać trackera. Spróbuj ponownie później.",
    );
  });

  it("po angielsku to samo zdanie jest angielskie", async () => {
    await i18n.changeLanguage("en");
    const ErrorComponent = routeErrorComponent();
    render(<ErrorComponent error={new Error("test: awaria")} reset={() => {}} />);

    expect(screen.getByTestId("route-error")).toHaveTextContent(
      "Could not load the tracker. Please try again later.",
    );
  });
});
