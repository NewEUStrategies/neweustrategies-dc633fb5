// @vitest-environment node
// Środowisko `node`, nie `happy-dom`: test odtwarza render SERWERA (cache
// brzegowy po stronie serwera, `typeof window === "undefined"`), a backend
// fixture czyta plik przez `new URL(..., import.meta.url)`, którego `URL`
// z happy-dom `fs` nie przyjmuje.
//
// DIETA STANU ODWODNIONEGO (P2.5, HW-3): stan react-query strony głównej `/`
// zbudowany na fixture pomiarowym NIE niesie pól, których żaden odbiorca
// pierwszego renderu nie czyta.
//
// PO CO. Stan `$tsr` jedzie w KAŻDYM dokumencie (bariera + strumień), a po
// boocie po LCP (C3) jego parsowanie i ewaluacja wchodzą do okna TBT (księga
// P0.5: K4 ParseHTML dokumentu). Projekcje żyją w funkcjach zapytań - nie w
// `dehydrate`, bo `serializeData` nie zna klucza - więc ten test woła
// PRAWDZIWE `queryOptions` i prawdziwy rejestr prefetchu buildera, a podmienia
// wyłącznie sieć: PostgREST odpowiada backend fixture z pomiaru wydajności
// (`scripts/performance/homeFixture.ts`, dane `e2e/fixtures/first-visit.json`
// bez zmian), a server fn (menu, pasek) - ich ciała na tym samym fixture.
//
// Zakazane w stanie (PLAN P2.5): `menu_id` i domyślne `mega_config` w menu,
// pola drugiego języka w wierszach postów (`*_en` na stronie PL), pola paska,
// których pasek nie renderuje, `popup_*` w projekcji formularza inline.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, dehydrate, type DehydratedState } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import type { BuilderDocument } from "@/lib/builder/types";

type Row = Record<string, unknown>;

interface FirstVisitFixture {
  settings: Array<{ key: string; value: Row }>;
  posts: Row[];
  menus: Row[];
  "menu-items": Row[];
  "home-body": Array<{ builder_data: BuilderDocument }>;
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "e2e/fixtures/first-visit.json"), "utf8"),
) as FirstVisitFixture;

/**
 * Backend fixture z pomiaru (`fixtureResponse`) plus JEDNA rzecz, której nie
 * umie: osadzenie PostgREST `menus -> menu_items`. Fixture zwraca wiersze menu
 * bez pozycji (stąd na artefakcie fixture menu jest puste), a produkcja oddaje
 * pozycje osadzone - test składa je z tych samych danych fixture.
 */
async function fixtureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { fixtureResponse } = await import("../../../../scripts/performance/homeFixture.ts");
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (
    url.pathname === "/rest/v1/menus" &&
    (url.searchParams.get("select") ?? "").includes("menu_items(")
  ) {
    const key = (url.searchParams.get("key") ?? "").replace(/^eq\./, "");
    const menu = fixture.menus.find((m) => m.key === key);
    const body = menu
      ? {
          ...menu,
          menu_items: fixture["menu-items"]
            .filter((it) => it.menu_id === menu.id)
            .sort((a, b) => Number(a.position) - Number(b.position)),
        }
      : null;
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  }
  return fixtureResponse(request);
}

function fixtureClient() {
  return createClient("http://127.0.0.1:4199", "performance-fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fixtureFetch },
  });
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: fixtureClient() }));

// Server fn nie da się wywołać bez kontekstu żądania - podstawiamy ich CIAŁA.
vi.mock("@/lib/menus/menu.functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/menus/menu.functions")>();
  return {
    ...actual,
    getMenuWithItems: ({ data }: { data: { key: string } }) =>
      actual.readMenuWithItemsWire(data.key, fixtureClient()),
  };
});

/** Wiersz paska w kształcie `TrendingPost` - tak, jak oddaje go server fn. */
function trendingRows(limit: number): Row[] {
  return fixture.posts.slice(0, limit).map((p) => ({
    id: p.id,
    slug: p.slug,
    title_pl: p.title_pl,
    title_en: p.title_en,
    cover_image_url: p.cover_image_url,
    published_at: p.published_at,
    parent_page_id: p.parent_page_id,
    views_count: 0,
    href: `/post/${String(p.slug)}`,
    author_display_name: null,
    author_avatar_url: null,
  }));
}

vi.mock("@/lib/views/postViews.functions", () => ({
  getTrendingPosts: ({ data }: { data: { limit: number } }) =>
    Promise.resolve(trendingRows(data.limit)),
  getTickerPosts: ({ data }: { data: { limit: number } }) =>
    Promise.resolve(trendingRows(data.limit)),
}));

const { prefetchBuilderDocumentQueries } = await import("@/lib/builder/prefetch");
const { headerTickerQueryOptions } = await import("@/lib/views/headerTickerQuery");
const { resolveActiveTickerConfig } = await import("@/lib/views/tickerVariants");
const {
  defaultNewsletterSettings,
  newsletterInlineSettingsQueryOptions,
  projectNewsletterInlineSettings,
} = await import("@/hooks/useNewsletterSettings");

function setting(key: string): Row {
  return fixture.settings.find((s) => s.key === key)?.value ?? {};
}

/**
 * Stan strony głównej: chrome (nagłówek ze swoim menu, pasek „na czasie",
 * stopka) i dokument buildera `/`, każdy przez TEN SAM rejestr prefetchu, co
 * loader trasy. Odwodnienie z tym samym filtrem co `router.tsx`.
 */
async function homeState(lang: "pl" | "en"): Promise<DehydratedState> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const header = setting("header") as { builder_data: BuilderDocument; trending: unknown };
  const footer = setting("footer") as { builder_data: BuilderDocument };
  await Promise.all([
    prefetchBuilderDocumentQueries(qc, header.builder_data, lang),
    prefetchBuilderDocumentQueries(qc, footer.builder_data, lang),
    prefetchBuilderDocumentQueries(qc, fixture["home-body"][0].builder_data, lang),
    qc.prefetchQuery(headerTickerQueryOptions(resolveActiveTickerConfig(header.trending))),
  ]);
  return dehydrate(qc, { shouldDehydrateQuery: (q) => q.state.status === "success" });
}

function dataOf(state: DehydratedState, root: string): unknown[] {
  return state.queries.filter((q) => q.queryKey[0] === root).map((q) => q.state.data);
}

function rowsOf(state: DehydratedState, root: string): Row[] {
  return dataOf(state, root).flatMap((d) => (Array.isArray(d) ? (d as Row[]) : []));
}

describe("stan odwodniony `/` na fixture (P2.5)", () => {
  it("menu: bez `menu_id` i bez domyślnego `mega_config` w pozycjach zagnieżdżonych", async () => {
    const state = await homeState("pl");
    const menus = dataOf(state, "menu-with-items") as Array<{ items: Row[] } | null>;
    const main = menus.find((m) => m && m.items.length > 0);
    // Kontrola, że asercje niżej nie są puste: wszystkie 46 pozycji fixture.
    expect(main?.items).toHaveLength(fixture["menu-items"].length);
    expect(JSON.stringify(menus)).not.toContain("menu_id");
    // Pozycje najwyższego poziomu niosą `mega_config` zawsze (zgodność z kartą
    // sprzed wdrożenia - `compactMenuWithItems`); zagnieżdżone tylko niedomyślne.
    const ids = new Set(main!.items.map((row) => row.id));
    const nested = main!.items.filter((row) => row.parent_id && ids.has(row.parent_id as string));
    expect(nested.length).toBeGreaterThan(30);
    for (const row of nested) {
      if (!("mega_config" in row)) continue;
      expect(row.mega_config).not.toEqual({
        columns_per_row: 4,
        width: "container",
        columns: [],
        featured_post_id: null,
      });
    }
    // Pola domyślne nie jadą (fixture: puste `css_class`/`icon`, `visibility: all`).
    for (const row of main!.items) {
      expect(row).not.toHaveProperty("css_class");
      expect(row).not.toHaveProperty("visibility");
      expect(row).not.toHaveProperty("mega_enabled");
    }
  });

  it("wiersze postów PL (post-lista, slider) nie niosą pól angielskich", async () => {
    const state = await homeState("pl");
    const lists = rowsOf(state, "builder-post-list");
    const sliders = rowsOf(state, "builder-slider-posts");
    expect(lists.length).toBeGreaterThan(0);
    expect(sliders.length).toBeGreaterThan(0);
    for (const row of [...lists, ...sliders]) {
      expect(row).not.toHaveProperty("title_en");
      expect(row).not.toHaveProperty("excerpt_en");
      expect(row.title_pl).toEqual(expect.any(String));
    }
  });

  it("wiersze postów EN nie niosą pól polskich (projekcja idzie za `lang` klucza)", async () => {
    const state = await homeState("en");
    const rows = [...rowsOf(state, "builder-post-list"), ...rowsOf(state, "builder-slider-posts")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("title_pl");
      expect(row).not.toHaveProperty("excerpt_pl");
      expect(row.title_en).toEqual(expect.any(String));
    }
  });

  it("pasek „na czasie” niesie wyłącznie pola, które renderuje", async () => {
    const state = await homeState("pl");
    const rows = rowsOf(state, "header_ticker");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "author_avatar_url",
        "author_display_name",
        "href",
        "id",
        "slug",
        "title_en",
        "title_pl",
      ]);
    }
  });

  it("projekcja formularza inline nie niesie pól popupu", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const inline = await qc.fetchQuery(newsletterInlineSettingsQueryOptions());
    expect(inline.heading_pl).toEqual(expect.any(String));
    expect(Object.keys(inline).filter((k) => k.startsWith("popup_"))).toEqual([]);
  });

  it("listy mailingowe jadą do formularza inline WYŁĄCZNIE z dokumentem inline", () => {
    // `NewsletterDocRenderer` (dokument inline) renderuje listy z
    // `popup_mailing_lists`; formularz bez dokumentu ich nie czyta.
    const lists = [{ id: "l1", label_pl: "Tygodnik", label_en: "Weekly" }];
    const base = { ...defaultNewsletterSettings(), popup_mailing_lists: lists };
    expect(projectNewsletterInlineSettings(base)).not.toHaveProperty("popup_mailing_lists");
    const withDoc = { ...base, inline_doc: { version: 1, rows: [] } as never };
    expect(projectNewsletterInlineSettings(withDoc).popup_mailing_lists).toEqual(lists);
  });
});
