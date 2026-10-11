// Sklejenie dwóch przekierowań dokumentów w uniwersalnym resolverze
// (`src/routes/$.tsx`) - audyt 2026-10.
//
// CO TO DOWODZI. Gramatyka (`src/lib/routing/__tests__/resolvePublicPath.test.ts`)
// mówi, JAKĄ decyzję niesie adres. Ten plik dowodzi, że loader ją FAKTYCZNIE
// wykonuje:
//   1. strona główna pod własnym slugiem (`/main`, `/en/main`) - 301 na `/`
//      z zachowanym query stringiem, `no-store`, wyłącznie dla TEJ strony
//      i wyłącznie przy PRAWDZIWYCH ustawieniach czytania;
//   2. stare kanały WordPressa (`/category/<slug>/feed/`, `/feed/atom`) - 301 na
//      trasę kanału RSS, przed jakimkolwiek zapytaniem do bazy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * pozostałych decyzji resolvera (404, taksonomie, stare adresy wpisów) -
//     `publicResolverRoute.test.tsx`;
//   * prefiksu `/en` w adresie docelowym - dokłada go rewrite `output` routera
//     (`src/router.tsx`), którego kontrakt ma `urlLanguageNavigation.test.tsx`;
//     loader rzuca kanoniczne `to`, tak samo jak przy każdym innym redirect.
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";

const harness = vi.hoisted(() => ({
  /** Wynik rezolucji treści dla żądanych segmentów (`null` = brak treści). */
  content: null as unknown,
  cacheControl: [] as string[],
  requestUrl: "",
}));

const stub = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => stub.from(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

// Rezolucja treści (`resolve_path` + pięć odnóg) ma własne testy - tu liczy się
// wyłącznie to, CO loader robi z rozwiązaną stroną.
vi.mock("@/lib/queries/public", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/public")>();
  return {
    ...actual,
    resolvedContentQueryOptions: (segments: string[]) =>
      queryOptions({
        queryKey: ["public", "resolved", segments] as const,
        queryFn: async () => harness.content,
      }),
  };
});

vi.mock("@/lib/routing/legacyPostPath", () => ({
  resolveLegacyPostPath: vi.fn(async () => null),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => harness.cacheControl.push(value),
  appendLinkHeader: () => undefined,
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => harness.requestUrl,
}));

import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { Route } from "@/routes/$";

const MAIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";

/** Ustawienia czytania produkcji (zweryfikowane 2026-10-10). */
const PRODUKCJA = { homepage_mode: "static_page", homepage_page_slug: "main" };

type Loader = (args: {
  params: { _splat?: string };
  context: { queryClient: QueryClient };
}) => Promise<unknown>;

function loader(): Loader {
  // To samo zejście przez `unknown` z jawnym strażnikiem, co w
  // `publicResolverRoute.test.tsx` - typy trasy opisują pełny kontekst routera.
  const fn: unknown = Route.options.loader;
  if (typeof fn !== "function") throw new Error("test: trasa `/$` nie ma loadera");
  return fn as Loader;
}

interface RunOptions {
  /** Mapa `site_settings`; `undefined` = brak wpisu w cache'u. */
  settings?: Record<string, unknown>;
  /** `true` - zasiew po awarii (`updatedAt: 0`), nie prawdziwy odczyt. */
  settingsSeed?: boolean;
}

/** Uruchamia loader i zwraca to, co ODDAŁ albo RZUCIŁ. */
async function runLoader(splat: string, options: RunOptions = {}): Promise<unknown> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (options.settings) {
    queryClient.setQueryData(
      siteSettingsQueryOptions.queryKey,
      options.settings,
      options.settingsSeed ? { updatedAt: 0 } : undefined,
    );
  }
  try {
    return await loader()({ params: { _splat: splat }, context: { queryClient } });
  } catch (thrown) {
    return thrown;
  }
}

/** Opis nawigacji rzuconego przekierowania (strażnik kształtu, nie rzutowanie). */
function redirectTarget(thrown: unknown): Record<string, unknown> {
  if (typeof thrown !== "object" || thrown === null || !("options" in thrown)) {
    throw new Error("test: rzucona wartość nie jest przekierowaniem routera");
  }
  const { options } = thrown;
  if (typeof options !== "object" || options === null) {
    throw new Error("test: przekierowanie bez opisu nawigacji");
  }
  return { ...options };
}

/** Rozwiązana STRONA w kształcie `ResolvedContent` (pola, które czyta loader). */
function page(id: string, slug: string): Record<string, unknown> {
  return {
    kind: "page",
    item: {
      id,
      slug,
      title_pl: "Strona",
      title_en: "Page",
      excerpt_pl: null,
      excerpt_en: null,
      editor: "builder",
      builder_data: null,
      cover_image_url: null,
      published_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      template_type: null,
    },
    crumbs: [],
    parentPageId: id,
    access: null,
  };
}

beforeEach(() => {
  stub.reset();
  harness.content = null;
  harness.cacheControl = [];
  harness.requestUrl = "";
});

describe("loader `/$` - strona główna pod własnym slugiem", () => {
  it("`/main` przy ustawieniach produkcji daje 301 na `/` z zachowanym query stringiem", async () => {
    harness.content = page(MAIN, "main");
    const thrown = await runLoader("main", { settings: { reading: PRODUKCJA } });
    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTarget(thrown)).toMatchObject({ to: "/", search: true, statusCode: 301 });
    // Spójne ustawienia rozstrzygają się bez I/O - żadnego zapytania o strony.
    expect(stub.chainsFor("pages")).toEqual([]);
  });

  it("301 strony głównej jest `no-store` - redakcja może jutro wskazać inną stronę", async () => {
    harness.content = page(MAIN, "main");
    await runLoader("main", { settings: { reading: PRODUKCJA } });
    expect(harness.cacheControl).not.toEqual([]);
    expect(harness.cacheControl.every((value) => value.includes("no-store"))).toBe(true);
  });

  it("inna strona renderuje się normalnie - przekierowanie dotyczy TYLKO strony głównej", async () => {
    harness.content = page(OTHER, "o-nas");
    const result = await runLoader("o-nas", { settings: { reading: PRODUKCJA } });
    expect(isRedirect(result)).toBe(false);
    expect(result).toMatchObject({ kind: "page", item: { id: OTHER } });
  });

  it("wpis POD stroną główną (`/main/<wpis>`) nie jest przekierowywany", async () => {
    const base = page(MAIN, "main");
    harness.content = {
      ...base,
      kind: "post",
      item: { ...(base.item as object), id: OTHER, slug: "wpis" },
      tags: [],
      categories: [],
      author: null,
      authors: [],
    };
    const result = await runLoader("main/wpis", { settings: { reading: PRODUKCJA } });
    expect(isRedirect(result)).toBe(false);
    expect(result).toMatchObject({ kind: "post", item: { id: OTHER } });
  });

  it("tryb `latest_posts` nie przekierowuje strony o slugu z ustawień", async () => {
    harness.content = page(MAIN, "main");
    const result = await runLoader("main", {
      settings: { reading: { ...PRODUKCJA, homepage_mode: "latest_posts" } },
    });
    expect(isRedirect(result)).toBe(false);
    expect(result).toMatchObject({ kind: "page", item: { id: MAIN } });
  });

  it("ZASIEW po awarii ustawień nie przekierowuje - brak pewności to zwykły render", async () => {
    // Pusta mapa z awarii czytałaby się jak „ustawień nie zapisano", a wtedy
    // strona `home` wyglądałaby na stronę główną także w serwisie z wpisami.
    harness.content = page(MAIN, "home");
    const result = await runLoader("home", { settings: {}, settingsSeed: true });
    expect(isRedirect(result)).toBe(false);
    expect(result).toMatchObject({ kind: "page", item: { id: MAIN } });
  });

  it("niespójne ustawienia: opublikowana strona z `homepage_page_id` zostawia `/main` w spokoju", async () => {
    harness.content = page(MAIN, "main");
    stub.setResponse("pages", ok([{ id: OTHER, slug: "start", parent_id: null }]));
    const result = await runLoader("main", {
      settings: { reading: { ...PRODUKCJA, homepage_page_id: OTHER } },
    });
    expect(isRedirect(result)).toBe(false);
    expect(result).toMatchObject({ kind: "page", item: { id: MAIN } });
    // Zapytanie o rywala z tymi samymi filtrami, co zapytanie strony głównej.
    const chain = stub.lastChain("pages");
    expect(chain?.argsOf("select")).toEqual(["id, slug, parent_id"]);
    expect(chain?.calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["id", OTHER] },
        { method: "eq", args: ["status", "published"] },
        { method: "is", args: ["deleted_at", null] },
      ]),
    );
  });

  it("niespójne ustawienia: strona z id NIEopublikowana - `/main` dostaje 301", async () => {
    harness.content = page(MAIN, "main");
    stub.setResponse("pages", ok([]));
    const thrown = await runLoader("main", {
      settings: { reading: { ...PRODUKCJA, homepage_page_id: OTHER } },
    });
    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTarget(thrown)).toMatchObject({ to: "/", statusCode: 301 });
  });

  it("błąd zapytania o rywali NIE kończy się 301 - strona nie może zniknąć spod adresu", async () => {
    harness.content = page(MAIN, "main");
    stub.setResponse("pages", fail("test: pages niedostępne"));
    const result = await runLoader("main", {
      settings: { reading: { ...PRODUKCJA, homepage_page_id: OTHER } },
    });
    expect(isRedirect(result)).toBe(false);
    expect(result).toMatchObject({ kind: "page", item: { id: MAIN } });
  });
});

describe("loader `/$` - stare kanały WordPressa", () => {
  it("`/category/<slug>/feed/` daje 301 na kanał RSS kategorii, bez zapytań", async () => {
    const thrown = await runLoader("category/afryka/feed/");
    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTarget(thrown)).toMatchObject({
      to: "/category/$slug/rss.xml",
      params: { slug: "afryka" },
      statusCode: 301,
      reloadDocument: true,
    });
    expect(stub.chains).toEqual([]);
  });

  it("`/tag/<slug>/feed/atom` daje 301 na kanał RSS tagu", async () => {
    const thrown = await runLoader("tag/nato/feed/atom");
    expect(redirectTarget(thrown)).toMatchObject({
      to: "/tag/$slug/rss.xml",
      params: { slug: "nato" },
      statusCode: 301,
    });
  });

  it.each(["feed/rss2", "feed/atom"])("`/%s` daje 301 na kanał serwisu", async (splat) => {
    const thrown = await runLoader(splat);
    expect(redirectTarget(thrown)).toMatchObject({ to: "/rss.xml", statusCode: 301 });
  });

  it("301 kanału jest cache'owalne - wynika z samego adresu, a czytniki odpytują go stale", async () => {
    await runLoader("category/afryka/feed/");
    expect(harness.cacheControl).toEqual([expect.stringContaining("public")]);
    expect(harness.cacheControl[0]).not.toContain("no-store");
  });
});
