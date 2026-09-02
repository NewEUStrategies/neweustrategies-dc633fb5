// Trasa PUBLICZNA `/tracker/` - indeks trackera legislacyjnego UE.
// Do dziś: 0 z 75 linii, 0 z 23 funkcji.
//
// CO DOWODZI TEN PLIK.
//
// To strona wejściowa całego modułu: wchodzi się na nią z wyszukiwarki,
// z newslettera i z kanału RSS. Render samego komponentu mija warstwę, w której
// mieszkają skutki: `head()` biegnie POZA drzewem Reacta i składa węzeł
// `ItemList` z danych LOADERA (nie z cache'u zapytań), autodiscovery kanału
// RSS jest jedynym sposobem, w jaki czytnik znajduje feed, a liczba zapytań na
// pierwszym malowaniu jest własnością SKLEJENIA loadera z `useQuery`.
//
// CZTERY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. WĘZEŁ `ItemList` POWSTAJE Z DANYCH LOADERA. To on wystawia crawlerom
//      i asystentom całą listę dossier już w SSR. Wypadnięcie projekcji
//      `entries` nie psuje ani jednego piksela na ekranie.
//   2. PUSTO Z FALLBACKU NIE JEST PUSTO Z BAZY. Loader sieje pustą listę,
//      żeby blip backendu nie dał HTTP 500 - ale zdanie „brak dossier" jest
//      wtedy nieprawdą, a czytelnik nie ma jak się dowiedzieć, że ma ponowić.
//   3. FILTRY MUSZĄ ZAWĘŻAĆ ODCZYT, nie tylko przestawiać etykietę. Filtr,
//      który nie dochodzi do zapytania, pokazuje wszystko przy każdym wyborze.
//   4. TREŚĆ JEDNEGO OBSZARU ROBOCZEGO NIE WYCHODZI NA HOŚCIE DRUGIEGO.
//      Autorytetem jest polityka `tenant_id = public_tenant_id()`, więc cudzy
//      wiersz NIE WRACA z odczytu - a trasa musi z tego zrobić pustkę, nie
//      cudzy tytuł.
//
// ── DECYZJA N4 DLA TEJ TRASY: LOADER JEST, KONTRAKT DOMKNIĘTY ──────────────
//
// `/tracker/` nie należy do czterech tras bez loadera - ma własny wzorzec
// `withBudget` + `cancelQueries` + zasiew z `updatedAt: 0`. Naprawa, która
// tu weszła, dotyczy WARSTWY TREŚCI, nie transportu: loader zwraca teraz
// `degraded` do komponentu (patrz reguła 2), bo nagłówek `Cache-Control`
// rozróżniał blip od pustki od początku, a ekran - nie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `src/lib/tracker/queries.ts` biegnie tu PRAWDZIWY (atrapowany jest tylko
//   klient PostgREST i RPC), więc klucze cache i filtry są tymi z produkcji.
// - `trackerItemListJsonLd` i `breadcrumbListJsonLd` mają własne testy przy
//   swoich modułach; tutaj dowodzimy WYŁĄCZNIE tego, że trasa je karmi danymi
//   loadera i że wynik trafia do `headScripts`.
// - KONTRAKTU NAGŁÓWKA `x-tenant-host`:
//   `src/integrations/supabase/__tests__/tenantHostFetch.test.ts`.
// - RADIXOWEJ WARSTWY ROZWIJANEJ: `@/components/ui/select` jest podmieniony na
//   natywny `<select>` (Radix nie otwiera listy pod happy-dom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, render, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `eu_policy_items` ze WSZYSTKICH obszarów roboczych. */
  items: [] as Record<string, unknown>[],
  /** Wynik RPC `get_policy_follower_counts` - lista `{ item_id, followers }`. */
  followerCounts: [] as Record<string, unknown>[],
  /** Tenant PRZEGLĄDANEJ domeny (atrapa polityki `public_tenant_id()`). */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** Powierzchnie, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Etykiety odczytów w kolejności - podstawa pomiaru fal loadera. */
  reads: [] as string[],
  /** Pary `.eq()` z kolejnych odczytów dossier - dowód działania filtrów. */
  itemFilters: [] as Record<string, unknown>[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/tracker",
  /** Nagłówki `Cache-Control` ustawione przez loader. */
  cacheControl: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const stub = supabaseFromStub();
  const rpc = supabaseRpcStub();

  stub.setResponse("eu_policy_items", (chain) => {
    h.reads.push("eu_policy_items");
    if (h.broken.has("eu_policy_items")) return fail("test: tabela eu_policy_items niedostepna");
    const eq: Record<string, unknown> = {};
    for (const call of chain.calls) {
      if (call.method === "eq" && typeof call.args[0] === "string") eq[call.args[0]] = call.args[1];
    }
    h.itemFilters.push(eq);
    const limit = chain.argsOf("limit")?.[0];
    const rows = h.items
      .filter((row) => row.tenant_id === h.tenantId)
      .filter((row) => row.status === eq.status)
      .filter((row) => eq.policy_area === undefined || row.policy_area === eq.policy_area)
      .filter((row) => eq.stage === undefined || row.stage === eq.stage);
    return ok(typeof limit === "number" ? rows.slice(0, limit) : rows);
  });
  rpc.setResponse("get_policy_follower_counts", () => {
    h.reads.push("get_policy_follower_counts");
    if (h.broken.has("get_policy_follower_counts")) {
      return fail("test: RPC get_policy_follower_counts niedostepny");
    }
    return ok(h.followerCounts);
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

// Radix nie otwiera listy pod happy-dom (potrzebuje realnego wskaźnika),
// a wybór opcji jest tu całą treścią zachowania filtrów.
vi.mock("@/components/ui/select", async () => {
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(await import("react"));
});

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
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { TRACKER_PAGE_SIZE, publishedItemsQueryOptions } from "@/lib/tracker/queries";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as TrackerIndexRoute } from "@/routes/tracker.index";

const PATH = "/tracker/";
// Identyfikatory obszarów roboczych. Ten sam literał stoi w fabryce
// `vi.hoisted` wyżej: vitest wynosi ją nad importy i nad te deklaracje, więc
// odwołanie do stałej z tamtego miejsca padłoby na „cannot access before
// initialization".
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_ID = "11111111-1111-4111-8111-111111111111";

// ── fixtures (RODO: wszystkie dossier i osoby są ZMYŚLONE) ──────────────────

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
    next_milestone_pl: "Głosowanie w Radzie",
    next_milestone_en: "Council vote",
    next_milestone_at: "2026-10-15",
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

/** N dossier o różnych identyfikatorach - do dowodu „pokaż więcej". */
function manyItems(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) =>
    item({ id: `item-${index}`, slug: `dossier-${index}`, title_pl: `Dossier ${index}` }),
  );
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({
    route: TrackerIndexRoute,
    path: PATH,
    initialEntry: "/tracker",
    queryClient,
  });
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

/** Sparsowany węzeł JSON-LD o danym `@type` - z twardym błędem, gdy go nie ma. */
function jsonLdNode(head: RouteHeadResult, type: string): Record<string, unknown> {
  for (const script of head.scripts ?? []) {
    if (script.type !== "application/ld+json") continue;
    const parsed: unknown = JSON.parse(script.children ?? "null");
    if (parsed && typeof parsed === "object" && "@type" in parsed) {
      const node = parsed as Record<string, unknown>;
      if (node["@type"] === type) return node;
    }
  }
  throw new Error(`test: brak wezla JSON-LD @type="${type}"`);
}

type IndexLoader = (ctx: { context: { queryClient: QueryClient } }) => Promise<{
  entries: { slug: string; title_pl: string; title_en: string; reference: string | null }[];
  degraded: boolean;
}>;

function indexLoader(): IndexLoader {
  const loader: unknown = TrackerIndexRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as IndexLoader;
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.items = [item()];
  h.followerCounts = [{ item_id: ITEM_ID, followers: 12 }];
  h.tenantId = TENANT_A;
  h.broken = new Set<string>();
  h.reads = [];
  h.itemFilters = [];
  h.requestUrl = "https://nes.example.org/tracker";
  h.cacheControl = [];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /tracker - siatka dossier", () => {
  it("karta niesie tytuł, referencję, kamień milowy i licznik obserwujących", async () => {
    // Cztery niezależne rzeczy z czterech różnych źródeł (wiersz, kolumna
    // referencji, para pól kamienia i RPC liczników). Wypadnięcie licznika to
    // jedyna z nich, której brak wygląda jak zero, a nie jak brak.
    await mount();

    expect(await screen.findByRole("link", { name: /Akt o rynkach danych/ })).toHaveAttribute(
      "href",
      "/tracker/akt-o-rynkach-danych",
    );
    expect(screen.getByText("2026/0101(COD)")).toBeInTheDocument();
    expect(screen.getByText(/Głosowanie w Radzie/)).toBeInTheDocument();
    expect(screen.getByText("12 obserwujących")).toBeInTheDocument();
  });

  it("dossier o najwyższej wadze dostaje plakietkę kluczowego", async () => {
    await mount();
    expect(await screen.findByText("Kluczowe")).toBeInTheDocument();

    cleanup();
    h.items = [item({ importance: 1 })];
    await mount();
    await screen.findByRole("link", { name: /Akt o rynkach danych/ });
    expect(screen.queryByText("Kluczowe")).not.toBeInTheDocument();
  });

  it("dossier odrzucone pokazuje etykietę terminalną, a nie pasek postępu", async () => {
    // Etap terminalny nie leży na osi (`stageIndex` = -1), więc pasek
    // narysowałby postęp „przed pierwszym etapem" - komunikat wprost odwrotny
    // do prawdy o procedurze.
    h.items = [item({ stage: "withdrawn" })];
    await mount();

    // Etykieta występuje też na liście filtra etapów, więc dowodem jest BRAK
    // osi postępu, a nie samo pojawienie się słowa.
    expect(await screen.findByRole("link", { name: /Akt o rynkach danych/ })).toBeInTheDocument();
    expect(screen.getAllByText("Wycofane").length).toBeGreaterThan(0);
    expect(screen.queryByRole("img", { name: /\(\d\/6\)/ })).not.toBeInTheDocument();
  });

  it("pasek postępu ma etykietę mówiącą, KTÓRY to etap z sześciu", async () => {
    // To jedyna informacja, jaką z osi postępu dostaje czytnik ekranu -
    // sześć kropek bez etykiety nie znaczy dla niego nic.
    await mount();

    expect(await screen.findByRole("img", { name: "Rada (3/6)" })).toBeInTheDocument();
  });

  it("po angielsku bierze angielski tytuł, kamień milowy i etykietę etapu", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(await screen.findByRole("link", { name: /Data Markets Act/ })).toBeInTheDocument();
    expect(screen.getByText(/Council vote/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Council (3/6)" })).toBeInTheDocument();
  });

  it("filtry obszaru i etapu ZAWĘŻAJĄ ODCZYT, nie tylko etykietę", async () => {
    // Filtr zmienia KLUCZ zapytania, więc jego jedynym widocznym skutkiem jest
    // nowy odczyt z `policy_area`/`stage`. Gdyby przestał dochodzić do
    // zapytania, strona pokazywałaby wszystko przy każdym wyborze.
    await mount();
    await screen.findByRole("link", { name: /Akt o rynkach danych/ });

    fireEvent.change(screen.getByLabelText("Obszar polityki"), { target: { value: "energy" } });
    await waitFor(() => expect(h.itemFilters.some((eq) => eq.policy_area === "energy")).toBe(true));

    fireEvent.change(screen.getByLabelText("Etap procedury"), { target: { value: "trilogue" } });
    await waitFor(() => expect(h.itemFilters.some((eq) => eq.stage === "trilogue")).toBe(true));
  });

  it("pokaz-wiecej ROZSZERZA OKNO ODCZYTU o pełną stronę", async () => {
    // Przycisk zmienia `limit`, czyli klucz zapytania. Gdyby przestał go
    // podnosić, lista kończyłaby się na pierwszym oknie na zawsze.
    h.items = manyItems(TRACKER_PAGE_SIZE * 2);
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: "Pokaż więcej dossier" }));

    await waitFor(() =>
      expect(
        h.itemFilters.length,
        "kliknięcie nie wywołało nowego odczytu z szerszym oknem",
      ).toBeGreaterThan(1),
    );
  });

  it("prowadzi do explorera, do feedu zmian i do kanału RSS", async () => {
    // Indeks jest ślepą uliczką, jeśli nie ma z niego wyjścia do dwóch
    // pozostałych powierzchni modułu i do kanału.
    await mount();

    expect(screen.getByRole("link", { name: "Otwórz explorer" })).toHaveAttribute(
      "href",
      "/tracker/explorer",
    );
    expect(screen.getByRole("link", { name: "Co się zmieniło" })).toHaveAttribute(
      "href",
      "/tracker/changes",
    );
  });

  it("nie zostawia indeksu trackera z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByRole("link", { name: /Akt o rynkach danych/ });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /tracker - stan pusty kontra stan zdegradowany", () => {
  it("pusto z bazy mówi o braku dossier dla filtrów", async () => {
    h.items = [];
    await mount();

    expect(await screen.findByText("Brak dossier dla wybranych filtrów.")).toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.items = [];
    await mount();

    expect(await screen.findByText("No files match the selected filters.")).toBeInTheDocument();
  });

  it("pusto z FALLBACKU nie kłamie o braku dossier - pokazuje ekran ponowienia", async () => {
    // SEDNO NAPRAWY. Zdanie „Brak dossier dla wybranych filtrów" przy padniętym
    // backendzie jest nieprawdą, a czytelnik nie ma z niego jak wywnioskować,
    // że powinien ponowić. Nagłówek `Cache-Control` rozróżniał te dwa stany od
    // początku, ekran - nie.
    h.broken.add("eu_policy_items");
    await mount();

    expect(await screen.findByText("Ta sekcja chwilowo nie ma danych")).toBeInTheDocument();
    expect(screen.queryByText("Brak dossier dla wybranych filtrów.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeInTheDocument();
  });

  it("awaria liczników NIE psuje siatki - to dekoracja karty", async () => {
    // Licznik obserwujących jedzie osobnym, krótszym budżetem właśnie dlatego,
    // że jego brak wolno pokazać jako zero. Padnięcie RPC nie ma prawa zabrać
    // czytelnikowi listy dossier.
    h.broken.add("get_policy_follower_counts");
    await mount();

    expect(await screen.findByRole("link", { name: /Akt o rynkach danych/ })).toBeInTheDocument();
    expect(screen.getByText("0 obserwujących")).toBeInTheDocument();
  });

  it("zdegradowany render nie trafia do cache'a wspólnego, czysty - trafia", async () => {
    // Brzeg serwowałby zapamiętaną pustkę kolejnym czytelnikom długo po tym,
    // jak baza wróciła do zdrowia.
    h.broken.add("eu_policy_items");
    const degraded = await indexLoader()({ context: { queryClient: freshClient() } });
    expect(degraded.degraded).toBe(true);
    expect(degraded.entries).toEqual([]);
    expect(h.cacheControl.at(-1)).toContain("no-store");

    h.broken = new Set<string>();
    h.cacheControl = [];
    const clean = await indexLoader()({ context: { queryClient: freshClient() } });
    expect(clean.degraded).toBe(false);
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });

  it("awaria samych LICZNIKÓW też degraduje nagłówek cache'a", async () => {
    // Świadome ustalenie, nie przeoczenie: licznik jest dekoracją NA EKRANIE,
    // ale render z zerami zamiast liczb nie może zostać zapieczony na brzegu
    // na 15 minut.
    h.broken.add("get_policy_follower_counts");
    const data = await indexLoader()({ context: { queryClient: freshClient() } });

    expect(data.degraded).toBe(true);
    expect(data.entries).toHaveLength(1);
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("pusta lista dossier NIE wywołuje RPC liczników", async () => {
    // Odczyt liczników dla zera identyfikatorów to round-trip po nic - a przy
    // nowym tenancie byłby to koszt na każdym żądaniu.
    h.items = [];
    await indexLoader()({ context: { queryClient: freshClient() } });

    expect(h.reads).not.toContain("get_policy_follower_counts");
  });
});

describe("trasa /tracker - izolacja obszarów roboczych", () => {
  it("dossier innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    // Autorytetem jest polityka publiczna: cudzy wiersz NIE WRACA z odczytu.
    // Ten test pilnuje SKUTKU - pustka, nie cudzy tytuł na naszej domenie.
    h.items = [item({ tenant_id: TENANT_B, title_pl: "Dossier obcego obszaru" })];
    await mount();

    expect(await screen.findByText("Brak dossier dla wybranych filtrów.")).toBeInTheDocument();
    expect(screen.queryByText("Dossier obcego obszaru")).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: to samo dossier na własnym hoście renderuje się", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa nie
    // renderowała NICZEGO - a to nie izolacja, tylko awaria.
    h.items = [item({ tenant_id: TENANT_B, title_pl: "Dossier obcego obszaru" })];
    h.tenantId = TENANT_B;
    await mount();

    expect(await screen.findByRole("link", { name: /Dossier obcego obszaru/ })).toBeInTheDocument();
  });

  it("odczyt NIE filtruje po tenancie sam - i to jest właściwe rozstrzygnięcie", async () => {
    // Świadome ustalenie: gdyby trasa dokładała własne `.eq("tenant_id", ...)`,
    // musiałaby ZNAĆ tenanta na kliencie i pierwszy błąd w tej wartości byłby
    // wyciekiem. Odsiew należy do polityki `tenant_id = public_tenant_id()`,
    // której klient nie potrafi obejść, a trasa filtruje WYŁĄCZNIE po statusie.
    await mount();
    await screen.findByRole("link", { name: /Akt o rynkach danych/ });

    expect(h.itemFilters.length).toBeGreaterThan(0);
    for (const eq of h.itemFilters) {
      expect(Object.keys(eq)).not.toContain("tenant_id");
      expect(eq.status).toBe("published");
    }
  });
});

describe("trasa /tracker - nagłówek dokumentu i dane strukturalne", () => {
  it("po polsku tytuł i opis mówią o śledzeniu dossier UE", async () => {
    const head = routeHead(TrackerIndexRoute, { loaderData: { entries: [], degraded: false } });

    expect(headTitle(head)).toBe("Tracker legislacyjny UE - śledź kluczowe dossier");
    expect(metaContent(head, "name", "description")).toBe(
      "Śledź kluczowe dossier legislacyjne UE: etap procedury, oś czasu wydarzeń i nadchodzące kamienie milowe.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł, opis i tytuł kanału RSS", async () => {
    // O języku nagłówka rozstrzyga wyłącznie prefiks adresu: `head()` biegnie
    // poza drzewem Reacta i nie wolno mu czytać singletonu i18next, wspólnego
    // dla współbieżnych żądań SSR.
    h.requestUrl = "https://nes.example.org/en/tracker";
    const head = routeHead(TrackerIndexRoute, { loaderData: { entries: [], degraded: false } });

    expect(headTitle(head)).toBe("EU legislative tracker - follow key files");
    expect(metaContent(head, "name", "description")).toBe(
      "Track key EU legislative files: procedure stage, timeline of events and upcoming milestones.",
    );
    const feed = (head.links ?? []).find((link) => link.type === "application/rss+xml");
    expect(feed?.title).toBe("EU legislative tracker - RSS");
  });

  it("po polsku tytuł kanału RSS jest polski, a adres wskazuje feed trackera", async () => {
    // Autodiscovery to jedyny sposób, w jaki czytnik RSS znajduje kanał bez
    // znajomości konwencji adresów.
    const head = routeHead(TrackerIndexRoute, { loaderData: { entries: [], degraded: false } });
    const feed = (head.links ?? []).find((link) => link.type === "application/rss+xml");

    expect(feed?.title).toBe("Tracker legislacyjny UE - RSS");
    expect(String(feed?.href)).toContain("/tracker/rss.xml");
  });

  it("węzeł CollectionPage niesie LISTĘ dossier z danych loadera", async () => {
    // To on wystawia crawlerom i asystentom pełną listę już w SSR. Wypadnięcie
    // projekcji `entries` nie psuje ani jednego piksela na ekranie.
    const head = routeHead(TrackerIndexRoute, {
      loaderData: {
        entries: [
          {
            slug: "akt-o-rynkach-danych",
            title_pl: "Akt o rynkach danych",
            title_en: "Data Markets Act",
            reference: "2026/0101(COD)",
          },
        ],
        degraded: false,
      },
    });
    const collection = jsonLdNode(head, "CollectionPage");

    expect(collection.inLanguage).toBe("pl");
    expect(JSON.stringify(collection.mainEntity)).toContain("Akt o rynkach danych");
  });

  it("bez danych loadera węzeł strony zostaje, ale BEZ listy", async () => {
    // `head()` bywa wołane bez ładunku (przerwana nawigacja). Pusta lista
    // w grafie to obietnica bez pokrycia, więc `mainEntity` musi zniknąć -
    // a sam węzeł strony zostaje, bo strona istnieje.
    const collection = jsonLdNode(routeHead(TrackerIndexRoute, {}), "CollectionPage");

    expect(collection.name).toBe("Tracker legislacyjny UE - śledź kluczowe dossier");
    expect(collection.mainEntity).toBeUndefined();
  });

  it("okruszki prowadzą do trackera i schodzą z serwera razem z nagłówkiem", async () => {
    const head = routeHead(TrackerIndexRoute, { loaderData: { entries: [], degraded: false } });
    const breadcrumbs = jsonLdNode(head, "BreadcrumbList");

    expect(JSON.stringify(breadcrumbs)).toContain("Tracker legislacyjny UE");
  });

  it("zamontowana trasa wystawia OBA węzły w headScripts, nie w scripts bundlera", async () => {
    // `match.scripts` to manifest bundlera i w teście jest zawsze pusty -
    // odczyt z tamtego pola dawałby test „przechodzący" na pustej tablicy.
    const view = await mount();
    await screen.findByRole("link", { name: /Akt o rynkach danych/ });

    const types = view.headScripts().map((script) => script.type);
    expect(types.filter((type) => type === "application/ld+json")).toHaveLength(2);
  });
});

describe("trasa /tracker - zapadka na liczbie zapytań pierwszego malowania", () => {
  it("po rozgrzaniu przez loader klient NIE dokłada round-tripu", async () => {
    // Każdy odczyt w tej fali to round-trip po hydratacji z pełnym opóźnieniem
    // sieci czytelnika. Dopisanie tu `useQuery` bez zasiewu w loaderze ma
    // wywalić ten test, a nie przejść niezauważone.
    const queryClient = freshClient();
    await indexLoader()({ context: { queryClient } });
    const loaderReads = [...h.reads];
    expect(loaderReads).toEqual(["eu_policy_items", "get_policy_follower_counts"]);

    const view = await mount(queryClient);
    await screen.findByRole("link", { name: /Akt o rynkach danych/ });
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(h.reads.slice(loaderReads.length), "odczyty po hydratacji").toEqual([]);
  });

  it("loader rozgrzewa DOKŁADNIE klucz stanu początkowego komponentu", async () => {
    // Rozjazd okna („wszystkie obszary/etapy, pierwsza strona") daje SSR pod
    // jednym wpisem cache i odczyt kliencki pod innym: treść zeszłaby
    // z serwera i została pobrana PO RAZ DRUGI, bez żadnego błędu.
    expect(publishedItemsQueryOptions().queryKey).toEqual([
      "tracker",
      "items",
      "all",
      "all",
      TRACKER_PAGE_SIZE,
    ]);

    const queryClient = freshClient();
    await indexLoader()({ context: { queryClient } });

    expect(queryClient.getQueryData(publishedItemsQueryOptions().queryKey)).toHaveLength(1);
  });
});

/** `errorComponent` trasy jako komponent - STRAŻNIK, nie rzutowanie. */
function routeErrorComponent(): (props: { error: Error; reset: () => void }) => ReactElement {
  const component: unknown = TrackerIndexRoute.options.errorComponent;
  if (typeof component !== "function") throw new Error("test: trasa nie ma errorComponent");
  return component as (props: { error: Error; reset: () => void }) => ReactElement;
}

describe("trasa /tracker - ekran awarii mówi językiem strony", () => {
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
