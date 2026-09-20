// KONTRAKT „404 KONTRA DEGRADACJA" DLA PIĘCIU TRAS PUBLICZNYCH:
// `/plans/$planId`, `/polls`, `/library`, `/web-stories/$slug`, `/programs/$slug`.
//
// CO NAPRAWIAMY (audyt CWV 2026-09-20, F07 / F08, wzorce W1, W2, W8). Do dziś
// każda z tych pięciu tras łamała co najmniej dwie reguły naraz:
//   * `plans.$planId` i `programs.$slug` robiły `.catch(() => null)` ->
//     `notFound()`, czyli DEGRADACJA ODPOWIADAŁA 404 (W8). 404 nie jest błędem
//     przejściowym: wyszukiwarka wypisuje po nim adres z indeksu na tygodnie,
//     a wracał on tam dniami;
//   * `web-stories.$slug` robiło GOŁE `ensureQueryData` - każdy blip bazy
//     kończył się HTTP 500 na zaindeksowanej stronie;
//   * `polls` i `library` łapały błąd, ale nie miały BUDŻETU (`catch` broni
//     przed błędem, nie przed powolnością - zwis trzymał trasę do watchdoga
//     SSR, 5 s);
//   * ŻADNA z pięciu nie ustawiała `Cache-Control`, więc zdegradowany render
//     brał domyślną politykę treści i mógł zamarznąć na brzegu na 15 minut
//     świeżości plus dobę okna `stale-while-revalidate` (W1).
//
// Testujemy loadery jako FUNKCJE, bez montowania drzewa - ta sama doktryna co
// `archiveLoaderResilience.test.ts` i `eventShellLoader.test.ts`. Render tych
// tras ma własne pliki (`planDetailsRoute`, `pollsRoute`, `libraryRoute`,
// `webStoriesRoutes`, `programsPublicRoutes`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Katalog planów; `throws` = blip odczytu, `hangs` = zwis bez rozstrzygnięcia. */
  plans: [] as Record<string, unknown>[],
  plansThrow: false,
  tiersThrow: false,
  /** Mapa `site_settings` widziana przez bramkę modułu ankiet. */
  settings: {} as Record<string, unknown>,
  settingsHangs: false,
  settingsThrow: false,
  polls: [] as Record<string, unknown>[],
  pollsThrow: false,
  resources: [] as Record<string, unknown>[],
  resourcesThrow: false,
  /** Historia web story; `null` = nie ma takiego sluga (czysty odczyt). */
  story: null as Record<string, unknown> | null,
  storyThrows: false,
  /** Landing programu; `null` = nie ma takiego sluga (czysty odczyt). */
  landing: null as Record<string, unknown> | null,
  landingThrows: false,
  landingHangs: false,
  /** Nagłówki, jakie loadery ustawiły na odpowiedzi. */
  cacheControl: [] as string[],
  linkHeaders: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  readRouteCacheDirective: () => null,
}));

// ── GRANICE DANYCH ─────────────────────────────────────────────────────────
// Atrapy CZĄSTKOWE: podmieniamy wyłącznie funkcje, które woła loader, a reszta
// modułu (klucze cache, selektory, `resolveSetting`) biegnie prawdziwa - to
// ona decyduje o parytecie kluczy loadera i komponentu.
vi.mock("@/lib/billing/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/queries")>()),
  fetchActivePlans: async () => {
    if (h.plansThrow) throw new Error("test: katalog planów niedostępny");
    return h.plans;
  },
}));

vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  fetchMembershipTiers: async () => {
    if (h.tiersThrow) throw new Error("test: warstwy niedostępne");
    return [];
  },
}));

vi.mock("@/lib/useSiteSetting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useSiteSetting")>()),
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"] as const,
    queryFn: () => {
      if (h.settingsHangs) return new Promise(() => {});
      if (h.settingsThrow) return Promise.reject(new Error("test: ustawienia niedostępne"));
      return Promise.resolve(h.settings);
    },
  },
}));

vi.mock("@/lib/community/publicQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/community/publicQueries")>()),
  publicPollsQueryOptions: () => ({
    queryKey: ["public-polls"],
    queryFn: async () => {
      if (h.pollsThrow) throw new Error("test: tabela polls niedostępna");
      return h.polls;
    },
  }),
  libraryResourcesQueryOptions: () => ({
    queryKey: ["library-resources"],
    queryFn: async () => {
      if (h.resourcesThrow) throw new Error("test: tabela member_resources niedostępna");
      return h.resources;
    },
  }),
}));

vi.mock("@/lib/queries/webStories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/webStories")>()),
  webStoryBySlugQueryOptions: (slug: string) => ({
    queryKey: ["web-stories", "slug", slug] as const,
    queryFn: async () => {
      if (h.storyThrows) throw new Error("test: baza historii niedostępna");
      return h.story;
    },
  }),
}));

vi.mock("@/lib/queries/programs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/programs")>()),
  programBySlugQueryOptions: (slug: string) => ({
    queryKey: ["programs", "landing", slug] as const,
    queryFn: () => {
      if (h.landingHangs) return new Promise(() => {});
      if (h.landingThrows) return Promise.reject(new Error("test: baza programów niedostępna"));
      return Promise.resolve(h.landing);
    },
  }),
}));

import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { contentCacheControl } from "@/lib/http/cachePolicy";
import { COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { Route as PlanRoute } from "@/routes/plans.$planId";
import { Route as PollsRoute } from "@/routes/polls";
import { Route as LibraryRoute } from "@/routes/library";
import { Route as WebStoryRoute } from "@/routes/web-stories.$slug";
import { Route as ProgramRoute } from "@/routes/programs.$slug";

const NO_STORE = "private, no-store";
const CONTENT = contentCacheControl();

/** Ładunek loadera w kształcie, którego dotykają asercje tego pliku. */
interface DegradableLoaderData {
  readonly degraded: boolean;
  readonly plan?: unknown;
  readonly story?: unknown;
  readonly landing?: unknown;
}

type Loader = (ctx: {
  context: { queryClient: QueryClient };
  params: { planId: string; slug: string };
}) => Promise<DegradableLoaderData>;

function loaderOf(route: unknown): Loader {
  return (route as { options: { loader: Loader } }).options.loader;
}

function runLoader(route: unknown, slug = "istnieje"): Promise<DegradableLoaderData> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return loaderOf(route)({
    context: { queryClient },
    params: { planId: slug, slug },
  });
}

/** Rzut z loadera - zwraca to, co poleciało, zamiast wywracać test. */
async function thrownBy(work: Promise<unknown>): Promise<unknown> {
  let thrown: unknown;
  await work.catch((error: unknown) => void (thrown = error));
  return thrown;
}

const PLAN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  h.plans = [{ id: PLAN_ID, tier_key: "member", price_cents: 4900 }];
  h.plansThrow = false;
  h.tiersThrow = false;
  h.settings = { [COMMUNITY_MODULES_KEY]: { polls_enabled: true } };
  h.settingsHangs = false;
  h.settingsThrow = false;
  h.polls = [{ id: "poll-1" }];
  h.pollsThrow = false;
  h.resources = [{ id: "res-1" }];
  h.resourcesThrow = false;
  h.story = { id: "s1", slug: "istnieje", cover_url: null, pages: [] };
  h.storyThrows = false;
  h.landing = { program: { id: "p1", slug: "istnieje", hero_image_url: null } };
  h.landingThrows = false;
  h.landingHangs = false;
  h.cacheControl = [];
  h.linkHeaders = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("/plans/$planId - katalog planów", () => {
  it("czysty odczyt z planem zostaje przy polityce treści", async () => {
    const data = await runLoader(PlanRoute, PLAN_ID);

    expect(data.degraded).toBe(false);
    expect(data.plan).not.toBeNull();
    expect(h.cacheControl).toEqual([CONTENT]);
  });

  it("BLIP KATALOGU degraduje do 200 `no-store` zamiast fabrykować 404 (W8)", async () => {
    h.plansThrow = true;
    const data = await runLoader(PlanRoute, PLAN_ID);

    expect(data.degraded).toBe(true);
    expect(data.plan).toBeNull();
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("404 leci WYŁĄCZNIE z czystego odczytu i nie utrwala się na brzegu", async () => {
    h.plans = [];
    const thrown = await thrownBy(runLoader(PlanRoute, PLAN_ID));

    expect(isNotFound(thrown)).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("blip WARSTW nie wypisuje planu z katalogu - 404 zależy od KATALOGU", async () => {
    // Warstwy zasilają wyłącznie matrycę porównania. Gdyby ich degradacja
    // dochodziła do `notFoundIfClean`, żywy plan przestawałby istnieć za każdym
    // razem, gdy padnie tabela obok - ale gdy planu naprawdę nie ma, 404 ma
    // polecieć mimo tej degradacji.
    h.tiersThrow = true;
    const data = await runLoader(PlanRoute, PLAN_ID);

    expect(data.plan).not.toBeNull();
    expect(data.degraded).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);

    h.cacheControl = [];
    h.plans = [];
    expect(isNotFound(await thrownBy(runLoader(PlanRoute, PLAN_ID)))).toBe(true);
  });
});

describe("/polls - bramka modułu i lista ankiet", () => {
  it("czysty odczyt zostaje przy polityce treści", async () => {
    const data = await runLoader(PollsRoute);

    expect(data.degraded).toBe(false);
    expect(h.cacheControl).toEqual([CONTENT]);
  });

  it("blip odczytu ankiet daje 200 `no-store`, a nie 500", async () => {
    h.pollsThrow = true;
    const data = await runLoader(PollsRoute);

    expect(data.degraded).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("ZWIS USTAWIEŃ nie blokuje listy - wchodzą domyślki, nagłówek schodzi", async () => {
    // Bramka modułu ma WŁASNY, krótki termin (300 ms). Po nim render idzie na
    // `COMMUNITY_MODULES_DEFAULTS` z kodu - a render na domyślkach nie jest
    // prawdą tenanta, więc nie wolno go rozdać z brzegu kolejnym czytelnikom.
    h.settingsHangs = true;
    const started = Date.now();
    const data = await runLoader(PollsRoute);

    expect(data.degraded).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
    // Termin bramki, a nie watchdog SSR (5 000 ms): zapas na wolny runner.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("wyłączony moduł kończy loader BEZ odczytu ankiet i z polityką treści", async () => {
    h.settings = { [COMMUNITY_MODULES_KEY]: { polls_enabled: false } };
    h.pollsThrow = true; // gdyby loader jednak czytał, wynik byłby zdegradowany
    const data = await runLoader(PollsRoute);

    expect(data.degraded).toBe(false);
    expect(h.cacheControl).toEqual([CONTENT]);
  });
});

describe("/library - lista materiałów", () => {
  it("czysty odczyt zostaje przy polityce treści", async () => {
    const data = await runLoader(LibraryRoute);

    expect(data.degraded).toBe(false);
    expect(h.cacheControl).toEqual([CONTENT]);
  });

  it("blip odczytu daje 200 `no-store` i flagę degradacji, a nie pustą bibliotekę", async () => {
    h.resourcesThrow = true;
    const data = await runLoader(LibraryRoute);

    expect(data.degraded).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("PUSTA biblioteka to CZYSTY odczyt - polityka treści zostaje", async () => {
    // Pustka i degradacja wyglądają w danych identycznie (`[]`), a różnią się
    // wyłącznie flagą - bez tej pary bramka nagłówka byłaby zawsze zielona.
    h.resources = [];
    const data = await runLoader(LibraryRoute);

    expect(data.degraded).toBe(false);
    expect(h.cacheControl).toEqual([CONTENT]);
  });
});

describe("/web-stories/$slug - tożsamość historii", () => {
  it("czysty odczyt z historią zostaje przy polityce treści", async () => {
    const data = await runLoader(WebStoryRoute);

    expect(data.degraded).toBe(false);
    expect(data.story).not.toBeNull();
    expect(h.cacheControl).toEqual([CONTENT]);
  });

  it("BLIP ODCZYTU degraduje do 200 `no-store` zamiast rzucać (było HTTP 500)", async () => {
    h.storyThrows = true;
    const data = await runLoader(WebStoryRoute);

    expect(data.degraded).toBe(true);
    expect(data.story).toBeNull();
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("brak historii nadal kończy się 404, pod `no-store`", async () => {
    h.story = null;
    const thrown = await thrownBy(runLoader(WebStoryRoute, "nie-ma"));

    expect(isNotFound(thrown)).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("preload okładki idzie TYLKO z czystego odczytu z historią", async () => {
    h.story = { id: "s1", slug: "istnieje", cover_url: "https://obrazy.example/ok.jpg", pages: [] };
    await runLoader(WebStoryRoute);
    expect(h.linkHeaders).toHaveLength(1);

    h.linkHeaders = [];
    h.storyThrows = true;
    await runLoader(WebStoryRoute);
    expect(h.linkHeaders).toEqual([]);
  });
});

describe("/programs/$slug - tożsamość programu (defekt W8)", () => {
  it("czysty odczyt z landingiem zostaje przy polityce treści", async () => {
    const data = await runLoader(ProgramRoute);

    expect(data.degraded).toBe(false);
    expect(data.landing).not.toBeNull();
    expect(h.cacheControl).toEqual([CONTENT]);
  });

  it("BLIP ODCZYTU NIE JEST 404 - degraduje do 200 `no-store`", async () => {
    h.landingThrows = true;
    const data = await runLoader(ProgramRoute);

    expect(data.degraded).toBe(true);
    expect(data.landing).toBeNull();
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("ZWIS ODCZYTU też degraduje - i mieści się w budżecie, nie w watchdogu", async () => {
    // `catch` bronił przed BŁĘDEM, nie przed POWOLNOŚCIĄ: zwis trzymał landing
    // do `SSR_QUERY_TIMEOUT_MS` (5 000 ms), a potem i tak kończył się 404.
    h.landingHangs = true;
    const started = Date.now();
    const data = await runLoader(ProgramRoute);

    expect(data.degraded).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("brak programu nadal kończy się 404, pod `no-store`", async () => {
    h.landing = null;
    const thrown = await thrownBy(runLoader(ProgramRoute, "nie-ma"));

    expect(isNotFound(thrown)).toBe(true);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });
});
