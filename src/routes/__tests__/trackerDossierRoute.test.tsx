// Trasa PUBLICZNA `/tracker/$slug` - strona dossier legislacyjnego.
// Do dziś: 0 z 67 linii, 0 z 14 funkcji.
//
// CO DOWODZI TEN PLIK.
//
// To najgłębsza strona modułu i jedyna, na którą wchodzi się WPROST z kanału
// RSS, z alertu obserwowania i z wyniku wyszukiwania. Render samego komponentu
// mija warstwę, w której mieszkają skutki: `notFound()` żyje w LOADERZE,
// `head()` biegnie POZA drzewem Reacta, a liczba zapytań pierwszego malowania
// jest własnością SKLEJENIA loadera z sześcioma `useQuery`.
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. NIEISTNIEJĄCY SLUG TO 404, NIE PUSTA STRONA. Adres z literówką albo
//      po usuniętym dossier musi wypaść z indeksu; strona 200 z napisem „nie
//      znaleziono" zostaje w nim jako soft 404 i monitoring linków milczy.
//   2. ALE 404 WOLNO OPRZEĆ TYLKO NA CZYSTYM ODCZYCIE. Awaria transportu
//      znaczy „nie wiem", a 404 z niewiedzy wyrzuca ŻYWE dossier z indeksu na
//      czas blipu backendu. Stąd para: pusto -> 404, blip -> 200 z `noindex`.
//   3. KOTWICA WPISU OSI CZASU MUSI ISTNIEĆ W DOKUMENCIE. Kanał
//      `/tracker/rss.xml` linkuje pozycje wprost do `#update-<id>`; oś czasu
//      pobierana dopiero po hydratacji zostawia te linki bez celu.
//   4. TREŚĆ JEDNEGO OBSZARU ROBOCZEGO NIE WYCHODZI NA HOŚCIE DRUGIEGO.
//      Cudzy wiersz nie wraca z odczytu, więc trasa musi z tego zrobić 404,
//      a nie cudzy tytuł na naszej domenie.
//   5. PANEL NIE OFERUJE AKCJI, KTÓRĄ BAZA ODRZUCI. Obserwowanie wymaga
//      planu Pro (RLS na `eu_policy_follows`) - bez niego trasa NIE PRÓBUJE
//      insertu, tylko kieruje na ofertę; a insert MUSI nieść jawny tenant.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `src/lib/tracker/queries.ts` biegnie tu PRAWDZIWY (atrapowany jest tylko
//   klient PostgREST i RPC), więc klucze cache, filtry i kod duplikatu
//   (`23505`) są tymi z produkcji.
// - SĄSIEDZKICH ORGANIZMÓW: `DossierFollowers` (sieć kontaktów) i
//   `ClubAnchorThreads` (kluby) mają własne pliki testowe i własne zapytania;
//   tutaj są atrapami-markerami, bo przedmiotem dowodu jest WYŁĄCZNIE to, co
//   trasa im podaje.
// - MAPY STANOWISK: `PolicyPositionsMap` biegnie PRAWDZIWY (to on niesie
//   tekstową alternatywę mapy, czyli tabelę danych - patrz blok
//   „dostępność"), ale zasób geometrii jest atrapowany: 200 kB GeoJSON-a nie
//   ma czego dowieść, a jego brak jest realnym stanem pierwszego malowania.
// - KONTRAKTU NAGŁÓWKA `x-tenant-host`:
//   `src/integrations/supabase/__tests__/tenantHostFetch.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, render, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `eu_policy_items` ze WSZYSTKICH obszarów roboczych. */
  items: [] as Record<string, unknown>[],
  /** Wiersze `eu_policy_updates` (oś czasu). */
  updates: [] as Record<string, unknown>[],
  /** Wiersze `eu_policy_positions` (stanowiska państw). */
  positions: [] as Record<string, unknown>[],
  /** Wiersze `eu_policy_links` (powiązane akty, z embedem dossier). */
  links: [] as Record<string, unknown>[],
  /** Wiersze `eu_policy_follows` widoczne dla zalogowanego (owner-only). */
  follows: [] as Record<string, unknown>[],
  /** Zarejestrowane inserty do `eu_policy_follows` - dowód jawnego tenanta. */
  followInserts: [] as Record<string, unknown>[],
  /** Zarejestrowane usunięcia obserwacji. */
  followDeletes: [] as Record<string, unknown>[],
  /** Odpowiedź na insert obserwacji: `null` = sukces, inaczej kod SQLSTATE. */
  followInsertError: null as { message: string; code: string } | null,
  /** Wynik RPC `current_membership_tier` - `null` = brak planu. */
  tier: null as Record<string, unknown> | null,
  /** Tenant PRZEGLĄDANEJ domeny (atrapa polityki `public_tenant_id()`). */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** Zalogowany czytelnik (null = gość) i jego tenant domowy. */
  user: null as { id: string } | null,
  authTenantId: null as string | null,
  /** Powierzchnie, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Etykiety odczytów w kolejności - podstawa pomiaru fal loadera. */
  reads: [] as string[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/tracker/akt-o-rynkach-danych",
  /** Nagłówki `Cache-Control` ustawione przez loader. */
  cacheControl: [] as string[],
  /** Komunikaty podane do `toast.info` / `toast.error`. */
  toasts: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail, pgError } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const stub = supabaseFromStub();
  const rpc = supabaseRpcStub();

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
    const row = h.items
      .filter((item) => item.tenant_id === h.tenantId)
      .find((item) => item.slug === eq.get("slug") && item.status === eq.get("status"));
    return ok(row ?? null);
  });
  stub.setResponse("eu_policy_updates", (chain) => {
    h.reads.push("eu_policy_updates");
    if (h.broken.has("eu_policy_updates")) {
      return fail("test: tabela eu_policy_updates niedostepna");
    }
    const eq = eqMap(chain.calls);
    return ok(h.updates.filter((row) => row.item_id === eq.get("item_id")));
  });
  stub.setResponse("eu_policy_positions", (chain) => {
    h.reads.push("eu_policy_positions");
    if (h.broken.has("eu_policy_positions")) {
      return fail("test: tabela eu_policy_positions niedostepna");
    }
    const eq = eqMap(chain.calls);
    return ok(h.positions.filter((row) => row.item_id === eq.get("item_id")));
  });
  stub.setResponse("eu_policy_links", () => {
    h.reads.push("eu_policy_links");
    if (h.broken.has("eu_policy_links")) return fail("test: tabela eu_policy_links niedostepna");
    return ok(h.links);
  });
  stub.setResponse("eu_policy_follows", (chain) => {
    if (chain.has("insert")) {
      const payload = chain.argsOf("insert")?.[0];
      if (payload && typeof payload === "object") {
        h.followInserts.push({ ...(payload as Record<string, unknown>) });
      }
      return h.followInsertError
        ? { data: null, error: pgError(h.followInsertError.message, h.followInsertError.code) }
        : ok(null);
    }
    if (chain.has("delete")) {
      h.followDeletes.push(Object.fromEntries(eqMap(chain.calls)));
      return ok(null);
    }
    h.reads.push("eu_policy_follows");
    return ok(h.follows);
  });
  rpc.setResponse("current_membership_tier", () => {
    h.reads.push("current_membership_tier");
    return ok(h.tier === null ? [] : [h.tier]);
  });
  return { supabase: { from: stub.from, rpc: rpc.rpc } };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.user ? { user: h.user } : null,
    user: h.user,
    roles: [],
    tenantId: h.authTenantId,
    loading: false,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    info: (message: string) => void h.toasts.push(message),
    error: (message: string) => void h.toasts.push(message),
    success: (message: string) => void h.toasts.push(message),
  },
}));

// Geometria mapy: 200 kB GeoJSON-a niczego tu nie dowodzi, a jej BRAK jest
// realnym stanem pierwszego malowania (SVG dogrywa się po hydracji). Tabela
// danych - czyli tekstowa alternatywa mapy - montuje się niezależnie od niego,
// więc to ją asertujemy w bloku dostępności.
vi.mock("@/lib/charts/geoQuery", () => ({
  geoAssetQueryOptions: (region: string) => ({
    queryKey: ["public", "geo", region] as const,
    queryFn: async () => null,
  }),
}));

// Sąsiedzkie organizmy: mają własne pliki testowe i własne zapytania. Tutaj
// przedmiotem dowodu jest WYŁĄCZNIE to, co trasa im podaje.
vi.mock("@/components/network/DossierFollowers", () => ({
  DossierFollowers: (props: { itemId: string }) => (
    <div data-testid="dossier-followers" data-item={props.itemId} />
  ),
}));
vi.mock("@/components/clubs/organisms/ClubAnchorThreads", () => ({
  ClubAnchorThreads: (props: { anchorType: string; anchorId: string }) => (
    <div data-testid="club-threads" data-anchor={`${props.anchorType}:${props.anchorId}`} />
  ),
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
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { itemBySlugQueryOptions, itemUpdatesQueryOptions } from "@/lib/tracker/queries";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as DossierRoute } from "@/routes/tracker.$slug";

const PATH = "/tracker/$slug";
// Identyfikatory obszarów roboczych. Ten sam literał stoi w fabryce
// `vi.hoisted` wyżej: vitest wynosi ją nad importy i nad te deklaracje, więc
// odwołanie do stałej z tamtego miejsca padłoby na „cannot access before
// initialization".
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "77777777-7777-4777-8777-777777777777";
const SLUG = "akt-o-rynkach-danych";

// ── fixtures (RODO: wszystkie dossier, noty i osoby są ZMYŚLONE) ────────────

function item(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ITEM_ID,
    tenant_id: TENANT_A,
    slug: SLUG,
    title_pl: "Akt o rynkach danych",
    title_en: "Data Markets Act",
    summary_pl: "Zasady dostępu do danych przemysłowych.",
    summary_en: "Rules on access to industrial data.",
    policy_area: "digital",
    stage: "council",
    importance: 3,
    reference: "2026/0101(COD)",
    source_url: "https://example.org/dossier",
    rapporteur: "Jan Kowalczyk",
    committee: "IMCO",
    lead_dg: "DG CONNECT",
    next_milestone_pl: "Głosowanie w Radzie",
    next_milestone_en: "Council vote",
    next_milestone_at: "2026-10-15",
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

function policyUpdate(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UPDATE_ID,
    item_id: ITEM_ID,
    note_pl: "Rada przyjęła stanowisko ogólne.",
    note_en: "The Council adopted its general approach.",
    stage_from: "parliament",
    stage_to: "council",
    source_url: "https://example.org/dokument",
    happened_on: "2026-07-01",
    created_at: "2026-07-01T10:00:00.000Z",
    ...patch,
  };
}

function position(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    item_id: ITEM_ID,
    country_code: "PL",
    stance: "support",
    note_pl: null,
    note_en: null,
    updated_at: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

const PRO_TIER = { features: { regulatory_monitoring: true } };

async function mount(slug = SLUG, queryClient?: QueryClient) {
  return renderRoute({
    route: DossierRoute,
    path: PATH,
    initialEntry: `/tracker/${slug}`,
    queryClient,
  });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv",
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

type DossierLoader = (ctx: {
  context: { queryClient: QueryClient };
  params: { slug: string };
}) => Promise<{ item: Record<string, unknown> | null }>;

function dossierLoader(): DossierLoader {
  const loader: unknown = DossierRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as DossierLoader;
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.items = [item()];
  h.updates = [policyUpdate()];
  h.positions = [];
  h.links = [];
  h.follows = [];
  h.followInserts = [];
  h.followDeletes = [];
  h.followInsertError = null;
  h.tier = null;
  h.tenantId = TENANT_A;
  h.user = null;
  h.authTenantId = null;
  h.broken = new Set<string>();
  h.reads = [];
  h.requestUrl = `https://nes.example.org/tracker/${SLUG}`;
  h.cacheControl = [];
  h.toasts = [];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /tracker/$slug - sklejenie i treść dossier", () => {
  it("czyta slug ze ŚCIEŻKI i pokazuje TO dossier, nie pierwsze z tabeli", async () => {
    // Adres jest jedynym wejściem na tę stronę. Slug odczytany z innego miejsca
    // dałby stronę, która pod każdym adresem pokazuje to samo dossier - a każdy
    // taki adres jest zaindeksowany osobno.
    h.items = [item({ id: "inne", slug: "inne-dossier", title_pl: "Inne dossier" }), item()];
    const view = await mount("inne-dossier");

    expect(view.currentPath()).toBe("/tracker/inne-dossier");
    expect(screen.getByRole("heading", { level: 1, name: /Inne dossier/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: /Akt o rynkach danych/ }),
    ).not.toBeInTheDocument();
  });

  it("pokazuje metryki procedury: referencję, sprawozdawcę, komisję i DG", async () => {
    // Cztery pola z jednego wiersza, każde renderowane warunkowo. Dossier bez
    // nich jest legalne, więc wypadnięcie któregoś nie daje żadnego błędu.
    await mount();

    expect(screen.getByText("2026/0101(COD)")).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalczyk")).toBeInTheDocument();
    expect(screen.getByText("IMCO")).toBeInTheDocument();
    expect(screen.getByText("DG CONNECT")).toBeInTheDocument();
  });

  it("oś czasu niesie KOTWICĘ wpisu, do której linkuje kanał RSS", async () => {
    // Pozycje `/tracker/rss.xml` linkują wprost do `#update-<id>`. Bez tego
    // identyfikatora w dokumencie link z czytnika prowadzi w nicość.
    const view = await mount();

    expect(screen.getByText("Rada przyjęła stanowisko ogólne.")).toBeInTheDocument();
    expect(view.container.querySelector(`#update-${UPDATE_ID}`)).not.toBeNull();
  });

  it("sekcje opcjonalne znikają w CAŁOŚCI, gdy nie ma czego pokazać", async () => {
    // Nagłówek sekcji nad pustką to obietnica bez pokrycia. Stanowiska
    // i powiązane akty są opcjonalne, oś czasu ma własny komunikat pustki.
    h.updates = [];
    await mount();

    expect(
      screen.getByText("Brak aktualizacji - oś czasu pojawi się po pierwszym wpisie."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Powiązane akty" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Stanowiska państw członkowskich" }),
    ).not.toBeInTheDocument();
  });

  it("podaje dzieciom identyfikator TEGO dossier, nie slug", async () => {
    // `DossierFollowers` i `ClubAnchorThreads` kotwiczą się po identyfikatorze.
    // Podanie sluga zamiast id nie wywala niczego - po prostu nie znajdują nic.
    await mount();

    expect(screen.getByTestId("dossier-followers")).toHaveAttribute("data-item", ITEM_ID);
    expect(screen.getByTestId("club-threads")).toHaveAttribute(
      "data-anchor",
      `eu_policy_item:${ITEM_ID}`,
    );
  });

  it("po angielsku bierze angielski tytuł, streszczenie i notę osi czasu", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: /Data Markets Act/ })).toBeInTheDocument();
    expect(screen.getByText("Rules on access to industrial data.")).toBeInTheDocument();
    expect(screen.getByText("The Council adopted its general approach.")).toBeInTheDocument();
    expect(screen.queryByText("Akt o rynkach danych")).not.toBeInTheDocument();
  });

  it("dossier bez tłumaczenia spada na drugi język, a nie na pustkę", async () => {
    // Redakcja tłumaczy dossier stopniowo. Pusty nagłówek H1 to strona bez
    // tytułu - dla czytelnika i dla wyszukiwarki.
    await i18n.changeLanguage("en");
    h.items = [item({ title_en: "", summary_en: "" })];
    await mount();

    expect(
      screen.getByRole("heading", { level: 1, name: /Akt o rynkach danych/ }),
    ).toBeInTheDocument();
  });
});

describe("trasa /tracker/$slug - 404 kontra degradacja", () => {
  it("nieistniejący slug kończy się 404, a nie stroną 200 z komunikatem", async () => {
    // `notFound()` w loaderze jest jedyną rzeczą, która trzyma ten adres poza
    // indeksem. Bez niego crawler widzi HTTP 200 i zostawia adres w indeksie.
    await mount("nie-ma-takiego-dossier");

    expect(screen.getByText("Nie znaleziono dossier.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do trackera" })).toHaveAttribute(
      "href",
      "/tracker",
    );
  });

  it("po angielsku ekran 404 też jest angielski", async () => {
    await i18n.changeLanguage("en");
    await mount("nie-ma-takiego-dossier");

    expect(screen.getByText("File not found.")).toBeInTheDocument();
  });

  it("loader RZUCA na pustym CZYSTYM odczycie", async () => {
    // Dowód wykonawczy na samym loaderze: to jedyne miejsce, w którym widać
    // różnicę między rzutem (404) i wartością (200).
    await expect(
      dossierLoader()({ context: { queryClient: freshClient() }, params: { slug: "nie-ma" } }),
    ).rejects.toBeTruthy();
  });

  it("blip backendu NIE daje 404 - 404 z niewiedzy jest gorsze", async () => {
    // Sedno rozróżnienia: awaria transportu znaczy „nie wiem". Twarde 404
    // wyrzuciłoby ŻYWE dossier z indeksu na czas blipu, a adres wróciłby tam
    // dopiero po ponownym zaindeksowaniu.
    h.broken.add("eu_policy_items");
    const data = await dossierLoader()({
      context: { queryClient: freshClient() },
      params: { slug: SLUG },
    });

    expect(data.item).toBeNull();
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("nagłówek zdegradowanej strony wychodzi z indeksu, zamiast zostać w nim pusty", async () => {
    // Strona bez dossier nie ma czego obiecywać. `noindex, follow` pozwala jej
    // wrócić do indeksu samodzielnie, gdy backend wróci.
    const head = routeHead(DossierRoute, { params: { slug: SLUG }, loaderData: { item: null } });

    expect(metaContent(head, "name", "robots")).toBe("noindex, follow");
    expect(headTitle(head)).toBe("Tracker legislacyjny UE");
  });

  it("czysty render 404 NIE ustawia no-store - to trwały stan adresu", async () => {
    // 404 z czystego odczytu jest faktem o adresie, nie awarią, więc brzegowi
    // wolno go zapamiętać. `no-store` na każdym 404 zamieniłby skanowanie
    // martwych linków w ruch do bazy.
    await expect(
      dossierLoader()({ context: { queryClient: freshClient() }, params: { slug: "nie-ma" } }),
    ).rejects.toBeTruthy();

    expect(h.cacheControl.at(-1)).not.toContain("no-store");
  });
});

describe("trasa /tracker/$slug - izolacja obszarów roboczych", () => {
  it("dossier innego obszaru roboczego daje 404, a nie swój tytuł na tym hoście", async () => {
    // Autorytetem jest polityka publiczna (`tenant_id = public_tenant_id()`):
    // cudzy wiersz NIE WRACA z odczytu. Test pilnuje SKUTKU.
    h.items = [item({ tenant_id: TENANT_B, title_pl: "Dossier obcego obszaru" })];
    await mount();

    expect(screen.getByText("Nie znaleziono dossier.")).toBeInTheDocument();
    expect(screen.queryByText("Dossier obcego obszaru")).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ten sam slug na własnym hoście renderuje się normalnie", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa nie
    // renderowała NICZEGO - a to nie izolacja, tylko awaria.
    h.items = [item({ tenant_id: TENANT_B, title_pl: "Dossier obcego obszaru" })];
    h.tenantId = TENANT_B;
    await mount();

    expect(
      screen.getByRole("heading", { level: 1, name: /Dossier obcego obszaru/ }),
    ).toBeInTheDocument();
  });

  it("insert obserwacji niesie JAWNY tenant - RLS bez niego odrzuca wiersz", async () => {
    // To jedyne miejsce w tej trasie, gdzie tenant jedzie WPROST w ładunku
    // (`eu_policy_follows` wymaga zgodności z tenantem dossier). Zgubienie go
    // zamienia obserwowanie w cichą odmowę bazy.
    h.user = { id: USER_ID };
    h.authTenantId = TENANT_A;
    h.tier = PRO_TIER;
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: "Obserwuj" }));

    await waitFor(() => expect(h.followInserts).toHaveLength(1));
    expect(h.followInserts[0]).toEqual({
      item_id: ITEM_ID,
      user_id: USER_ID,
      tenant_id: TENANT_A,
    });
  });
});

describe("trasa /tracker/$slug - obserwowanie za bramką planu", () => {
  it("gość dostaje zaproszenie do logowania, a nie cichy brak reakcji", async () => {
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Obserwuj" }));

    expect(h.toasts).toContain("Zaloguj się, aby obserwować");
    expect(h.followInserts).toEqual([]);
  });

  it("czytelnik bez planu Pro NIE dostaje próby insertu, tylko ofertę", async () => {
    // Reguła „panel nie oferuje akcji, którą baza odrzuci": bez planu RLS na
    // `eu_policy_follows` odmówiłby, a czytelnik dostałby surowy błąd zamiast
    // informacji, czego mu brakuje.
    h.user = { id: USER_ID };
    h.authTenantId = TENANT_A;
    h.tier = { features: { regulatory_monitoring: false } };
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: "Obserwuj" }));

    expect(h.followInserts).toEqual([]);
    expect(h.toasts).toContain("Monitoring regulacyjny z alertami jest częścią planu Pro.");
  });

  it("ODOBSERWOWAĆ można zawsze - także bez planu Pro", async () => {
    // Świadome ustalenie, nie przeoczenie: bramka planu dotyczy ZAŁOŻENIA
    // obserwacji. Uwięzienie czytelnika w subskrypcji alertów, których nie
    // może wyłączyć, byłoby defektem samym w sobie.
    h.user = { id: USER_ID };
    h.authTenantId = TENANT_A;
    h.tier = { features: { regulatory_monitoring: false } };
    h.follows = [{ item_id: ITEM_ID }];
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: "Obserwujesz" }));

    await waitFor(() => expect(h.followDeletes).toHaveLength(1));
    expect(h.followDeletes[0]).toEqual({ item_id: ITEM_ID, user_id: USER_ID });
  });

  it("odmowa bazy daje komunikat ze słownika, nie surowy tekst z PostgREST", async () => {
    // Czytelnik nie ma prawa zobaczyć zdania o polityce RLS. Kod duplikatu
    // (23505) jest przy tym IGNOROWANY w warstwie zapytań - tu wymuszamy inny.
    h.user = { id: USER_ID };
    h.authTenantId = TENANT_A;
    h.tier = PRO_TIER;
    h.followInsertError = { message: "new row violates row-level security policy", code: "42501" };
    await mount();

    fireEvent.click(await screen.findByRole("button", { name: "Obserwuj" }));

    await waitFor(() =>
      expect(h.toasts).toContain("Nie udało się zmienić obserwowania. Spróbuj ponownie."),
    );
    for (const message of h.toasts) expect(message).not.toContain("row-level");
  });

  it("po angielsku podpowiedź obserwowania też jest angielska", async () => {
    await i18n.changeLanguage("en");
    h.user = { id: USER_ID };
    h.authTenantId = TENANT_A;
    h.tier = PRO_TIER;
    await mount();

    expect(await screen.findByRole("button", { name: "Follow" })).toBeInTheDocument();
    expect(screen.getByText("You will get a notification about every update")).toBeInTheDocument();
  });
});

describe("trasa /tracker/$slug - dostępność i alternatywa mapy", () => {
  it("mapa stanowisk ma TEKSTOWĄ alternatywę - tabelę państw i stanowisk", async () => {
    // Kolor na mapie nie istnieje dla czytnika ekranu ani dla crawlera. Tabela
    // jest w dokumencie od razu (zwinięta), więc wartości są dostępne bez
    // najeżdżania kursorem na kraj.
    h.positions = [position(), position({ country_code: "DE", stance: "oppose" })];
    await mount();

    const toggle = await screen.findByRole("button", { name: /Pokaż dane|Ukryj dane/ });
    fireEvent.click(toggle);

    const table = await screen.findByRole("table");
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Polska" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Niemcy" })).toBeInTheDocument();
  });

  it("pasek postępu ma nazwę dostępną z ETAPEM i pozycją na osi", async () => {
    // Sześć pasków bez nazwy nie znaczy nic. `aria-label` na gołym `<div>` jest
    // przy tym IGNOROWANY (element bez roli nie ma nazwy dostępnej), więc
    // asercja idzie po ROLI - inaczej przechodziłaby na atrybucie, którego
    // czytnik ekranu i tak nie czyta.
    await mount();

    expect(
      screen.getByRole("img", { name: "Postęp procedury legislacyjnej: Rada (3/6)" }),
    ).toBeInTheDocument();
  });

  it("nie zostawia strony dossier z wadami dostępności", async () => {
    h.positions = [position()];
    h.links = [];
    const view = await mount();
    await screen.findByRole("heading", { level: 1, name: /Akt o rynkach danych/ });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("nie zostawia ekranu 404 z wadami dostępności", async () => {
    // Ekran 404 jest osobnym komponentem trasy i renderuje się rzadko, więc
    // jest naturalnym miejscem, w którym regresja dostępności przeżyłaby długo.
    const view = await mount("nie-ma-takiego-dossier");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /tracker/$slug - nagłówek dokumentu i dane strukturalne", () => {
  it("tytuł i opis biorą się Z DOSSIER i niosą sufiks modułu", async () => {
    const head = routeHead(DossierRoute, {
      params: { slug: SLUG },
      loaderData: { item: item() },
    });

    expect(headTitle(head)).toBe("Akt o rynkach danych - Tracker legislacyjny UE");
    expect(metaContent(head, "name", "description")).toBe(
      "Zasady dostępu do danych przemysłowych.",
    );
    expect(metaContent(head, "property", "og:type")).toBe("article");
  });

  it("dossier bez streszczenia opisuje się TYTUŁEM, nie pustką", async () => {
    // Pusty `content` w wyniku wyszukiwania to wynik bez zajawki, a zajawka
    // decyduje o kliknięciu.
    const head = routeHead(DossierRoute, {
      params: { slug: SLUG },
      loaderData: { item: item({ summary_pl: null, summary_en: null }) },
    });

    expect(metaContent(head, "name", "description")).toBe("Akt o rynkach danych");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł, sufiks i tytuł kanału RSS", async () => {
    h.requestUrl = `https://nes.example.org/en/tracker/${SLUG}`;
    const head = routeHead(DossierRoute, {
      params: { slug: SLUG },
      loaderData: { item: item() },
    });

    expect(headTitle(head)).toBe("Data Markets Act - EU policy tracker");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
    const feed = (head.links ?? []).find((link) => link.type === "application/rss+xml");
    expect(feed?.title).toBe("EU legislative tracker - RSS");
  });

  it("po angielsku nagłówek BEZ dossier też mówi po angielsku", async () => {
    h.requestUrl = `https://nes.example.org/en/tracker/${SLUG}`;
    const head = routeHead(DossierRoute, { params: { slug: SLUG }, loaderData: { item: null } });

    expect(headTitle(head)).toBe("EU policy tracker");
    expect(metaContent(head, "name", "description")).toBe("EU legislative file tracker.");
  });

  it("węzeł Legislation niesie referencję procedury i jurysdykcję UE", async () => {
    // `legislationIdentifier` to jedyne miejsce, w którym numer procedury
    // (2026/0101(COD)) jest maszynowo czytelny dla asystentów i agregatorów.
    const head = routeHead(DossierRoute, {
      params: { slug: SLUG },
      loaderData: { item: item() },
    });
    const legislation = jsonLdNode(head, "Legislation");

    expect(legislation.legislationIdentifier).toBe("2026/0101(COD)");
    expect(legislation.legislationJurisdiction).toEqual({
      "@type": "AdministrativeArea",
      name: "European Union",
    });
    expect(legislation.dateModified).toBe("2026-07-01T00:00:00.000Z");
    expect(legislation.sameAs).toBe("https://example.org/dossier");
  });

  it("dossier bez źródła nie dostaje pustego sameAs", async () => {
    const legislation = jsonLdNode(
      routeHead(DossierRoute, {
        params: { slug: SLUG },
        loaderData: { item: item({ source_url: null, reference: null }) },
      }),
      "Legislation",
    );

    expect(legislation).not.toHaveProperty("sameAs");
    expect(legislation).not.toHaveProperty("legislationIdentifier");
  });

  it("okruszki prowadzą przez tracker do TEGO dossier", async () => {
    const breadcrumbs = jsonLdNode(
      routeHead(DossierRoute, { params: { slug: SLUG }, loaderData: { item: item() } }),
      "BreadcrumbList",
    );

    // OSTATNI okruszek NIE ma adresu - to strona bieżąca, a link do samej
    // siebie w grafie jest szumem. Dowód idzie więc po kształcie listy, nie po
    // wyszukaniu sluga w stringu (tamta asercja przechodziłaby na `url` węzła
    // Legislation, czyli na czymś zupełnie innym).
    const elements = breadcrumbs.itemListElement;
    expect(Array.isArray(elements)).toBe(true);
    const list = elements as Record<string, unknown>[];
    expect(list.map((entry) => entry.name)).toEqual([
      "Start",
      "Tracker legislacyjny UE",
      "Akt o rynkach danych",
    ]);
    expect(list[1].item).toBe("https://nes.example.org/tracker");
    expect(list[2]).not.toHaveProperty("item");
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM MALOWANIU ───────────────────────────────
//
// POMIAR, NIE OPINIA. Loader biegnie na TYM SAMYM kliencie zapytań, który potem
// dostaje `renderRoute`, więc świeży wpis cache'u nie jest ponawiany na montażu
// i granica między falami jest widoczna.
//
// ZMIERZONE PRZED ZMIANĄ: loader 1 odczyt (dossier), klient 5 (oś czasu,
// stanowiska, powiązane, obserwacje, plan). ZMIERZONE PO: loader 2 (dossier
// + oś czasu), klient 3 dla GOŚCIA: plan (RPC `current_membership_tier`),
// stanowiska i powiązane akty. Lista własnych obserwacji jest bramkowana
// `enabled: !!userId`, więc gość jej nie robi wcale.
//
// CO ZOSTAJE KLIENCKIE - ODRZUCENIE Z UZASADNIENIEM.
// * STANOWISKA: mapa i tak dogrywa ~200 kB geometrii po hydratacji, więc
//   przeniesienie samych stanowisk do loadera nie dałoby crawlerowi mapy -
//   dałoby mu tabelę, którą i tak zbuduje po pierwszym round-tripie.
// * POWIĄZANE AKTY: sekcja pod całą treścią, poniżej osi czasu i klubów.
// * WŁASNE OBSERWACJE I PLAN: dane CZYTELNIKA, nie treść. Zasianie ich
//   w loaderze wpuściłoby stan konta do dehydrowanego ładunku SSR, który
//   trafia do cache'a wspólnego - to nie optymalizacja, to wyciek.

describe("trasa /tracker/$slug - zapadka na liczbie zapytań pierwszego malowania", () => {
  it("loader grzeje dossier I OŚ CZASU, w dwóch falach", async () => {
    // Bez drugiej fali kotwica `#update-<id>`, do której linkuje kanał RSS,
    // nie istnieje w oddanym dokumencie.
    const queryClient = freshClient();
    await dossierLoader()({ context: { queryClient }, params: { slug: SLUG } });

    expect(h.reads).toEqual(["eu_policy_items", "eu_policy_updates"]);
    expect(queryClient.getQueryData(itemBySlugQueryOptions(SLUG).queryKey)).toBeTruthy();
    expect(queryClient.getQueryData(itemUpdatesQueryOptions(ITEM_ID).queryKey)).toHaveLength(1);
  });

  it("gość nie dokłada po hydratacji więcej niż TRZY odczyty", async () => {
    // ZAPADKA. Każdy odczyt w tej fali to round-trip z pełnym opóźnieniem sieci
    // czytelnika. Dopisanie tu kolejnego `useQuery` bez zasiewu w loaderze ma
    // wywalić ten test, a nie przejść niezauważone.
    const queryClient = freshClient();
    await dossierLoader()({ context: { queryClient }, params: { slug: SLUG } });
    const loaderReads = [...h.reads];

    const view = await mount(SLUG, queryClient);
    await screen.findByRole("heading", { level: 1, name: /Akt o rynkach danych/ });
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    const clientReads = h.reads.slice(loaderReads.length);
    // ZMIERZONE: plan (RPC), stanowiska, powiązane akty. Oś czasu NIE MOŻE tu
    // być - jest w falach loadera, bo kanał RSS linkuje wprost do jej kotwic.
    expect(clientReads, `odczyty klienta: ${clientReads.join(", ")}`).toHaveLength(3);
    expect(clientReads).not.toContain("eu_policy_updates");
  });

  it("gość NIE pyta o własne obserwacje ani o plan - to dane konta", async () => {
    // `enabled: !!userId` jest tu granicą prywatności, nie optymalizacją:
    // anonimowy odczyt `eu_policy_follows` i tak wróciłby pusty, ale kosztowałby
    // round-trip i wpis w logu bazy na każdą wizytę.
    const queryClient = freshClient();
    await dossierLoader()({ context: { queryClient }, params: { slug: SLUG } });
    const loaderReads = [...h.reads];

    const view = await mount(SLUG, queryClient);
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(h.reads.slice(loaderReads.length)).not.toContain("eu_policy_follows");
  });

  it("blip osi czasu NIE wywraca strony dossier ani nie kasuje treści", async () => {
    // Warunek konieczny przeniesienia osi do loadera: gołe `ensureQueryData`
    // zamieniłoby awarię jednej sekcji w HTTP 500 na działającym dossier.
    h.broken.add("eu_policy_updates");
    await mount();

    expect(
      screen.getByRole("heading", { level: 1, name: /Akt o rynkach danych/ }),
    ).toBeInTheDocument();
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("czysty render deklaruje politykę treści, nie no-store", async () => {
    await dossierLoader()({ context: { queryClient: freshClient() }, params: { slug: SLUG } });

    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });
});

/** `errorComponent` trasy jako komponent - STRAŻNIK, nie rzutowanie. */
function routeErrorComponent(): (props: { error: Error; reset: () => void }) => ReactElement {
  const component: unknown = DossierRoute.options.errorComponent;
  if (typeof component !== "function") throw new Error("test: trasa nie ma errorComponent");
  return component as (props: { error: Error; reset: () => void }) => ReactElement;
}

describe("trasa /tracker/$slug - ekran awarii mówi językiem strony", () => {
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
