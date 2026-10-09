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
// Zakazane w stanie (PLAN P2.5): `menu_id`, pola domyślne i domyślne
// `mega_config` w menu (wąski, jawny wyjątek: `mega_config` pozycji
// najwyższego poziomu - zgodność z kartą sprzed wdrożenia), pola drugiego
// języka w wierszach postów (`*_en` na stronie PL), pola paska, których pasek
// nie renderuje, `popup_*` w newsletterze formularza inline.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
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
  NEWSLETTER_INLINE_LABEL_KEYS,
  defaultNewsletterSettings,
  newsletterInlineSettingsQueryOptions,
  projectNewsletterInlineSettings,
} = await import("@/hooks/useNewsletterSettings");
const { buildRegistrationFieldsApi } = await import("@/lib/auth/registrationFields");
const { resolvePopupFields } = await import("@/lib/newsletter/popupFields");
const { DEFAULT_MEGA_CONFIG } = await import("@/lib/menus/types");

/**
 * Pola, których etykiety niesie projekcja formularzy inline: 7 pól
 * podpisywanych przez `NewsletterForm`/`JoinUsForm` - bez hasła, jego
 * powtórzenia, listy i zgody newslettera (pola popupu/rejestracji).
 */
const INLINE_LABEL_KEYS = [
  "company",
  "email",
  "first_name",
  "job",
  "last_name",
  "linkedin",
  "phone",
];

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
    qc.prefetchQuery(headerTickerQueryOptions(resolveActiveTickerConfig(header.trending), lang)),
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
  it("menu: każda pozycja bez `menu_id` i pól domyślnych; domyślne `mega_config` WYŁĄCZNIE w korzeniach", async () => {
    const state = await homeState("pl");
    const menus = dataOf(state, "menu-with-items") as Array<{ items: Row[] } | null>;
    const main = menus.find((m) => m && m.items.length > 0);
    // Kontrola, że asercje niżej nie są puste: wszystkie 46 pozycji fixture.
    expect(main?.items).toHaveLength(fixture["menu-items"].length);
    expect(JSON.stringify(menus)).not.toContain("menu_id");
    const items = main!.items;
    // Korzeń = brak rodzica albo rodzic spoza wyniku (jak `buildPublicMenuTree`
    // i `compactMenuWithItems`); brak pola `parent_id` w przesyłce znaczy `null`.
    const ids = new Set(items.map((row) => row.id));
    const isRoot = (row: Row) => !row.parent_id || !ids.has(row.parent_id as string);
    const roots = items.filter(isRoot);
    expect(roots.length).toBeGreaterThan(0);
    expect(items.length - roots.length).toBeGreaterThan(30);
    // KAŻDA pozycja (korzenie też): pola zawsze obecne są, a żadne pole
    // opcjonalne nie jedzie z wartością, którą i tak podstawia normalizacja.
    const defaults: Row = {
      parent_id: null,
      label_pl: "",
      label_en: "",
      href: "",
      target: "_self",
      css_class: "",
      visibility: "all",
      icon: "",
      mega_enabled: false,
    };
    for (const row of items) {
      for (const key of ["id", "item_type", "position", "ref_id"]) expect(row).toHaveProperty(key);
      for (const [key, value] of Object.entries(defaults)) {
        if (key in row) expect(row[key], `${key} w ${String(row.id)}`).not.toEqual(value);
      }
    }
    // JEDYNY wyjątek, wąski i jawny: `mega_config` każdego korzenia jedzie
    // zawsze (stary `MegaPanel` czyta `mega_config.featured_post_id` bez `?.`),
    // więc domyślne `mega_config` niosą WYŁĄCZNIE korzenie - w fixture
    // wszystkie 7 (konfiguracja nieprawidłowa -> domyślna). Rozszerzenie
    // reguły na pozycje zagnieżdżone zmieni liczbę i czerwieni test.
    for (const row of roots) expect(row).toHaveProperty("mega_config");
    const withDefaultMega = items
      .filter(
        (row) => "mega_config" in row && isDeepStrictEqual(row.mega_config, DEFAULT_MEGA_CONFIG),
      )
      .map((row) => row.id);
    expect(withDefaultMega).toEqual(
      roots
        .filter((row) => isDeepStrictEqual(row.mega_config, DEFAULT_MEGA_CONFIG))
        .map((row) => row.id),
    );
    expect(withDefaultMega).toHaveLength(roots.length);
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

  it("pasek „na czasie” niesie wyłącznie pola, które renderuje - jeden tytuł (P3.7b, T4)", async () => {
    // Język w kluczu paska: tytuł tylko w języku klucza, `slug` tylko bez `href`.
    for (const lang of ["pl", "en"] as const) {
      const state = await homeState(lang);
      const rows = rowsOf(state, "header_ticker");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([
          "author_avatar_url",
          "author_display_name",
          "href",
          "id",
          `title_${lang}`,
        ]);
      }
    }
  });

  it("zajawki tylko w zapytaniach widgetów, które je renderują (P3.7b, T2)", async () => {
    for (const lang of ["pl", "en"] as const) {
      const state = await homeState(lang);
      const entries = state.queries.filter(
        (q) => q.queryKey[0] === "builder-post-list" || q.queryKey[0] === "builder-slider-posts",
      );
      expect(entries.length).toBeGreaterThan(0);
      let withoutExcerpt = 0;
      for (const entry of entries) {
        const input = entry.queryKey[1] as { withExcerpt?: unknown };
        expect(typeof input.withExcerpt, JSON.stringify(entry.queryKey)).toBe("boolean");
        if (input.withExcerpt) continue;
        withoutExcerpt += 1;
        for (const row of entry.state.data as Row[]) {
          expect(Object.keys(row).filter((k) => k.startsWith("excerpt_"))).toEqual([]);
        }
      }
      // Fixture `/`: każdy widget post-listy i slidera ma zajawkę wyłączoną
      // (`showExcerpt: "0"`/`false` albo wariant `ranked`) - asercja nie jest pusta.
      expect(withoutExcerpt).toBe(entries.length);
    }
  });

  it("projekcja formularza inline nie niesie pól popupu", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const inline = await qc.fetchQuery(newsletterInlineSettingsQueryOptions());
    expect(inline.heading_pl).toEqual(expect.any(String));
    expect(Object.keys(inline).filter((k) => k.startsWith("popup_"))).toEqual([]);
    // Etykiety pól jadą (formularze ich potrzebują) - WYŁĄCZNIE pól, które
    // formularze inline podpisują; reszta konfiguracji pól nie.
    expect(inline.field_labels.map((r) => r.key).sort()).toEqual(INLINE_LABEL_KEYS);
    expect([...NEWSLETTER_INLINE_LABEL_KEYS].sort()).toEqual(INLINE_LABEL_KEYS);
    for (const row of inline.field_labels) {
      expect(Object.keys(row).sort()).toEqual(["key", "label_en", "label_pl"]);
    }
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

  it("etykiety pól z projekcji = etykiety z pełnego wiersza (każde pole, oba języki)", () => {
    // Odbiorca etykiet: `buildRegistrationFieldsApi(...).label()` - to samo,
    // co liczy `useNewsletterFieldLabels` z `popup_fields` pełnego klucza.
    const full = {
      ...defaultNewsletterSettings(),
      popup_fields: resolvePopupFields([
        { key: "first_name", label_pl: "Imię redakcji", label_en: "Given name" },
        { key: "company", label_pl: "Instytucja", label_en: "" },
        { key: "phone", enabled: true, label_pl: "Telefon kontaktowy", placeholder_pl: "+48" },
      ]),
    };
    const inline = projectNewsletterInlineSettings(full);
    for (const lang of ["pl", "en"] as const) {
      const fromFull = buildRegistrationFieldsApi(full.popup_fields, lang);
      const fromInline = buildRegistrationFieldsApi(inline.field_labels, lang);
      for (const key of NEWSLETTER_INLINE_LABEL_KEYS) {
        expect(fromInline.label(key), `${key}/${lang}`).toBe(fromFull.label(key));
      }
    }
    expect(buildRegistrationFieldsApi(inline.field_labels, "pl").label("company")).toBe(
      "Instytucja",
    );
  });

  it("stan SSR `/`: newsletter bez pól popupu (poza listami przy `inline_doc`)", async () => {
    const state = await homeState("pl");
    const entries = state.queries.filter((q) => q.queryKey[0] === "newsletter-settings");
    // Widget `join-us` fixture grzeje WYŁĄCZNIE klucz projekcji inline.
    expect(entries.map((q) => q.queryKey)).toEqual([["newsletter-settings", "inline"]]);
    for (const entry of entries) {
      const data = entry.state.data as Row;
      const popup = Object.keys(data).filter(
        (k) => k.startsWith("popup_") && !(k === "popup_mailing_lists" && data.inline_doc),
      );
      expect(popup, JSON.stringify(entry.queryKey)).toEqual([]);
      const labelKeys = (data.field_labels as Array<{ key: string }>).map((r) => r.key).sort();
      expect(labelKeys).toEqual(INLINE_LABEL_KEYS);
    }
  });
});
