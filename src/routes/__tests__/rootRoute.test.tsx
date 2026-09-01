// KORZEŃ DRZEWA TRAS - loader, `head()` i sklejenie powłoki.
//
// Do 2026-09-01 ten plik miał 0 z 124 pokrytych linii i 0 z 48 funkcji, mimo że
// POSIADA OBA BUDŻETY ROZGRZEWKI SSR. Próg globalny tego nie widział, bo jest
// agregatem po całym `src/`.
//
// CO TEN PLIK DOWODZI - cztery rzeczy, każda z ceną awarii:
//
//  1. ZASIEW RODZI SIĘ PRZETERMINOWANY (`dataUpdatedAt === 0`). Bez tego jedna
//     czkawka bazy w oknie fali 1 przypina WBUDOWANE DOMYŚLNE w cache'u klienta
//     na 5-10 minut (`staleTime`), a klient nigdy nie dociąga prawdziwej
//     wartości. Dla `site_settings` skutek jest najostrzejszy: `Header` zwraca
//     `null` przy pustym `builder_data`, czyli czytelnik oglądałby stronę BEZ
//     NAGŁÓWKA do końca wizyty. Doktryna była w repo o jedną trasę dalej
//     (`routes/index.tsx`) i tu jej brakowało.
//  2. DEKORACJA NIGDY NIE WYWRACA SERWISU. Loader korzenia biegnie na KAŻDEJ
//     trasie, więc nie może być pojedynczym punktem awarii całego serwisu:
//     `allSettled` + budżet + `try/catch`, a awaria ustawień kończy się `null`,
//     nie rzutem.
//  3. DRUGA FALA MA WŁASNY, KRÓTKI BUDŻET (`CHROME_WARM_BUDGET_MS`). Wcześniej
//     miała ten sam 2 500 ms co fala 1, a startuje po jej rozstrzygnięciu -
//     czyli korzeń mógł trzymać dokument 5 s BEZ JEDNEGO BAJTU HTML-a, na każdej
//     trasie publicznej.
//  4. STRAŻNIK ZAPYTAŃ MENU USUWA TYLKO TE, KTÓRE NIE MOGĄ SIĘ ROZSTRZYGNĄĆ.
//     Szerszy predykat (samo `pending`) usuwał też zapytanie, któremu wyczerpał
//     się budżet, ale które nadal leci - czyli był aktywną ścieżką UTRATY DANYCH.
//
// Loader wołamy jako funkcję, bez runtime'u routera - to ten sam kod, który
// wykona framework, tylko bez kosztu całego drzewa (ta sama doktryna co
// `archiveRoutes.test.ts`). `src/test/routeHarness.tsx` nie da się tu użyć: buduje
// własny, atrapowy korzeń i wiesza trasę pliku jako jego dziecko, więc prawdziwy
// `__root` nigdy nie zostaje korzeniem.
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  origin: "https://neweuropeanstrategies.com",
  chrome: true,
  canonicalCalls: 0,
  i18nSyncCalls: 0,
  linkHeaders: [] as string[],
  settings: {} as Record<string, unknown>,
  settingsHangs: false,
  settingsFails: false,
  prefetch: [] as { budget: number }[],
  ticker: [] as unknown[],
  menus: [] as string[],
  menusHang: false,
  cancelMenus: false,
  social: [] as unknown[],
  brand: [] as unknown[],
}));

vi.mock("@/lib/i18n/localeRuntime", async (o) => ({
  ...(await o<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.lang,
}));
vi.mock("@/lib/seo/request", async (o) => ({
  ...(await o<typeof import("@/lib/seo/request")>()),
  getOrigin: () => h.origin,
}));
vi.mock("@/lib/http/canonicalRedirect", () => ({
  enforceCanonicalHost: () => void h.canonicalCalls++,
}));
vi.mock("@/lib/i18n", async (o) => ({
  ...(await o<typeof import("@/lib/i18n")>()),
  syncI18nToRequest: async () => void h.i18nSyncCalls++,
  getRenderI18n: () => ({}),
}));
vi.mock("@/lib/http/responseHeaders", () => ({
  appendLinkHeader: (v: string) => h.linkHeaders.push(v),
}));
vi.mock("@/lib/routing/siteChrome", () => ({ showsSiteChrome: () => h.chrome }));
vi.mock("@/lib/useSiteSetting", async (o) => ({
  ...(await o<typeof import("@/lib/useSiteSetting")>()),
  siteSettingsQueryOptions: {
    queryKey: ["site-settings"],
    queryFn: () =>
      h.settingsHangs
        ? new Promise(() => {})
        : h.settingsFails
          ? Promise.reject(new Error("ustawienia padly"))
          : Promise.resolve(h.settings),
  },
}));
vi.mock("@/lib/builder/designTokens", async (o) => ({
  ...(await o<typeof import("@/lib/builder/designTokens")>()),
  designTokensQueryOptions: { queryKey: ["design-tokens"], queryFn: async () => null },
}));
vi.mock("@/hooks/useGlobalColors", async (o) => ({
  ...(await o<typeof import("@/hooks/useGlobalColors")>()),
  globalColorsQueryOptions: { queryKey: ["global-colors"], queryFn: async () => null },
}));
vi.mock("@/lib/menus/queries", () => ({
  menuWithItemsQueryOptions: (key: string) => ({
    queryKey: ["menu-with-items", key],
    queryFn: () => (h.menusHang ? new Promise(() => {}) : Promise.resolve((h.menus.push(key), []))),
  }),
}));
vi.mock("@/lib/views/headerTickerQuery", async (o) => ({
  ...(await o<typeof import("@/lib/views/headerTickerQuery")>()),
  headerTickerQueryOptions: () => ({
    queryKey: ["header-ticker"],
    queryFn: async () => (h.ticker.push("warm"), []),
  }),
}));
vi.mock("@/lib/builder/prefetch", async (o) => ({
  ...(await o<typeof import("@/lib/builder/prefetch")>()),
  prefetchCachedRouteQueries: async (
    qcArg: QueryClient,
    _doc: unknown,
    _lang: unknown,
    budget: number,
  ) => {
    h.prefetch.push({ budget });
    // Odwzorowanie anulowania (HMR / `revert: true`): zapytanie zostaje
    // `pending` + `fetchStatus: "idle"` + bez danych - DOKŁADNIE ten stan,
    // którego szuka strażnik zapytań menu w loaderze.
    if (h.cancelMenus) {
      // Fetch menu startuje po rozstrzygnięciu dynamicznego importu - anulujemy
      // DOPIERO gdy naprawdę leci, inaczej `cancelQueries` nie ma czego złapać.
      await new Promise((r) => setTimeout(r, 0));
      await qcArg.cancelQueries({ queryKey: ["menu-with-items"], revert: true });
    }
  },
}));
vi.mock("@/lib/seo/socialDefaults", async (o) => ({
  ...(await o<typeof import("@/lib/seo/socialDefaults")>()),
  rememberSocialDefaults: (...a: unknown[]) => void h.social.push(a),
}));
vi.mock("@/lib/seo/brandDefaults", async (o) => ({
  ...(await o<typeof import("@/lib/seo/brandDefaults")>()),
  rememberBrandDefaults: (...a: unknown[]) => void h.brand.push(a),
}));

const { Route, ROOT_WARM_BUDGET_MS, CHROME_WARM_BUDGET_MS } = await import("@/routes/__root");

type Loader = (a: {
  context: { queryClient: QueryClient };
  location: { pathname: string };
}) => Promise<unknown>;

function runLoader(qc: QueryClient, pathname = "/") {
  const loader = Route.options.loader as unknown as Loader;
  return loader({ context: { queryClient: qc }, location: { pathname } });
}

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.linkHeaders = [];
  h.prefetch = [];
  h.ticker = [];
  h.menus = [];
  h.social = [];
  h.brand = [];
  h.canonicalCalls = 0;
  h.i18nSyncCalls = 0;
  h.settings = {};
  h.settingsHangs = false;
  h.chrome = true;
});

describe("__root loader", () => {
  it("zwraca null - nikt nie czyta danych korzenia, więc ustawienia nie jadą do payloadu drugi raz", async () => {
    await expect(runLoader(qc)).resolves.toBeNull();
  });

  it("wymusza kanoniczny host i synchronizuje i18n z żądaniem", async () => {
    await runLoader(qc);
    expect(h.canonicalCalls).toBe(1);
    expect(h.i18nSyncCalls).toBe(1);
  });

  it("dokłada nagłówki HTTP `Link` dla języka żądania (fonty startują przed HTML-em)", async () => {
    h.lang = "pl";
    await runLoader(qc);
    const pl = h.linkHeaders.join(" ");
    expect(pl).toContain('rel="preload"');
    h.linkHeaders = [];
    h.lang = "en";
    await runLoader(new QueryClient());
    expect(h.linkHeaders.length).toBeGreaterThan(0);
    h.lang = "pl";
  });

  it("zasiewa PRZETERMINOWANE domyślne, gdy fala 1 nic nie dowiozła", async () => {
    h.settingsHangs = true;
    await runLoader(qc);
    const st = qc.getQueryState(["site-settings"]);
    expect(qc.getQueryData(["site-settings"])).toEqual({});
    expect(st?.dataUpdatedAt).toBe(0);
    expect(qc.getQueryState(["design-tokens"])?.dataUpdatedAt).toBe(0);
    expect(qc.getQueryState(["global-colors"])?.dataUpdatedAt).toBe(0);
  });

  it("NIE nadpisuje prawdziwych ustawień zasiewem", async () => {
    h.settings = { header: { builder_data: { sections: [] } } };
    await runLoader(qc);
    expect(qc.getQueryData(["site-settings"])).toEqual(h.settings);
    expect(qc.getQueryState(["site-settings"])?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("bez chrome'u NIE grzeje ani menu, ani tickera, ani widgetów", async () => {
    h.chrome = false;
    await runLoader(qc, "/admin");
    expect(h.menus).toEqual([]);
    expect(h.ticker).toEqual([]);
    expect(h.prefetch).toEqual([]);
  });

  it("z chrome'em grzeje menu main + footer RÓWNOLEGLE z falą 1", async () => {
    h.chrome = true;
    await runLoader(qc);
    expect(h.menus.sort()).toEqual(["footer", "main"]);
  });

  it("grzeje ticker tylko gdy header ma sekcje (inaczej płaci się za nic)", async () => {
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    await runLoader(qc);
    expect(h.ticker).toHaveLength(1);
  });

  it("nie grzeje tickera, gdy header jest pusty", async () => {
    h.settings = { header: { builder_data: { sections: [] } } };
    await runLoader(qc);
    expect(h.ticker).toHaveLength(0);
  });

  it("prefetch chrome'u dostaje KRÓTKI budżet drugiej fali, nie budżet fali 1", async () => {
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    await runLoader(qc);
    // Budżet jest IMPORTOWANYM KONTRAKTEM, nie powtórzonym literałem: gdyby
    // test wpisywał 500, każda zmiana w źródle nadal by przechodziła.
    expect(h.prefetch.map((p) => p.budget)).toContain(CHROME_WARM_BUDGET_MS);
    // I jest ISTOTNIE KRÓTSZY od fali 1 - to jest cała treść naprawy punktu 1.
    expect(CHROME_WARM_BUDGET_MS).toBeLessThan(ROOT_WARM_BUDGET_MS);
  });

  it("zapamiętuje domyślne karty społecznościowej i marki dla synchronicznego head()", async () => {
    h.settings = { seo: { default_og_image_url: "https://x/y.png" } };
    await runLoader(qc);
    expect(h.social).toHaveLength(1);
    expect(h.brand).toHaveLength(1);
  });

  it("wiszące, ale NADAL LECĄCE menu ZOSTAJE - usunięcie go byłoby utratą danych", async () => {
    h.menusHang = true;
    await runLoader(qc);
    expect(qc.getQueryState(["menu-with-items", "main"])?.fetchStatus).toBe("fetching");
    h.menusHang = false;
  });

  it("ANULOWANE menu (pending + idle + bez danych) JEST usuwane - inaczej seroval czeka na martwą obietnicę", async () => {
    h.menusHang = true;
    h.cancelMenus = true;
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    await runLoader(qc);
    expect(qc.getQueryState(["menu-with-items", "main"])).toBeUndefined();
    expect(qc.getQueryState(["menu-with-items", "footer"])).toBeUndefined();
    h.menusHang = false;
    h.cancelMenus = false;
  });

  it("awaria ustawień NIE wywraca loadera - dekoracja nie może zabrać serwisu", async () => {
    h.settingsFails = true;
    await expect(runLoader(qc)).resolves.toBeNull();
    h.settingsFails = false;
  });
});

describe("__root head()", () => {
  it("niesie viewport, meta marki i reguły spekulacji", async () => {
    const head = Route.options.head as unknown as () => {
      meta: Record<string, unknown>[];
      links: Record<string, unknown>[];
      scripts: { type?: string; children?: string }[];
    };
    const r = head();
    expect(r.meta[0]).toEqual({
      name: "viewport",
      content: "width=device-width, initial-scale=1",
    });
    expect(r.meta.length).toBeGreaterThan(1);
    expect(r.links.some((l) => l.rel === "stylesheet")).toBe(true);
    expect(r.scripts[0]?.type).toBe("speculationrules");
  });
});

describe("__root wiring", () => {
  it("ma powłokę, komponent, 404 i ekran błędu", () => {
    expect(typeof Route.options.shellComponent).toBe("function");
    expect(typeof Route.options.component).toBe("function");
    expect(typeof Route.options.notFoundComponent).toBe("function");
    expect(typeof Route.options.errorComponent).toBe("function");
  });
});
