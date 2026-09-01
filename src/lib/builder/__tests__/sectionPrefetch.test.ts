import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import type { BuilderDocument, SectionNode, WidgetNode } from "@/lib/builder/types";
import {
  collectBuilderWidgets,
  collectSectionWidgets,
  collectAboveFoldWidgets,
  prefetchSectionQueries,
  prefetchBuilderDocumentQueries,
  prefetchAboveFoldQueries,
  prefetchCachedRouteQueries,
  widgetQueryOptionsList,
  widgetCacheTargets,
  sectionQueryOptionsList,
  pendingSectionQueries,
  ABOVE_FOLD_SECTION_COUNT,
} from "@/lib/builder/prefetch";
import { shouldStreamSection } from "@/lib/builder/sectionStreaming";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import {
  CATEGORY_CHIP_COLUMNS,
  TAG_CHIP_COLUMNS,
  categoriesQueryOptions,
  tagsQueryOptions,
} from "@/lib/builder/taxonomyQuery";
import {
  podcastLatestLimit,
  webStoriesCarouselLimit,
  podcastLatestQueryOptions,
  webStoriesCarouselQueryOptions,
} from "@/lib/builder/mediaListQuery";
import { activePlansQueryOptions } from "@/lib/builder/pricingPlansQuery";
import {
  RATED_LIST_POST_COLUMNS,
  RATED_LIST_PROFILE_COLUMNS,
  RATED_LIST_STALE_MS,
  ratedListInput,
  ratedListQueryOptions,
  ratedListUsesDynamicSource,
} from "@/lib/builder/ratedListQuery";
import { latestPodcastsQueryOptions } from "@/lib/queries/podcasts";
import { latestWebStoriesQueryOptions } from "@/lib/queries/webStories";
import { billingKeys } from "@/lib/billing/keys";

function makeWidget(type: WidgetNode["type"], extra: Partial<WidgetNode> = {}): WidgetNode {
  return {
    kind: "widget",
    id: `w-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content: { items: [] },
    style: {},
    advanced: {},
    ...extra,
  } as WidgetNode;
}

function makeSection(widgets: WidgetNode[], id = "s1"): SectionNode {
  return {
    id,
    children: [
      {
        kind: "column",
        id: `${id}-c`,
        span: { desktop: 12 },
        children: widgets,
      },
    ],
  } as unknown as SectionNode;
}

describe("section prefetch helpers", () => {
  it("collects widgets from a section (flat columns)", () => {
    const w1 = makeWidget("post-list");
    const w2 = makeWidget("heading");
    const section = makeSection([w1, w2]);
    const widgets = collectSectionWidgets(section);
    expect(widgets.map((w) => w.id).sort()).toEqual([w1.id, w2.id].sort());
  });

  it("collects widgets from inner-sections", () => {
    const inner: WidgetNode = makeWidget("post-list");
    const section: SectionNode = {
      id: "s",
      children: [
        {
          kind: "inner-section",
          id: "is",
          columns: [{ kind: "column", id: "c", span: { desktop: 12 }, children: [inner] }],
        },
      ],
    } as unknown as SectionNode;
    expect(collectSectionWidgets(section).map((w) => w.id)).toEqual([inner.id]);
  });

  it("collectBuilderWidgets flattens across sections", () => {
    const a = makeWidget("post-list");
    const b = makeWidget("slider");
    // safeParseBuilderDoc (used by collectBuilderWidgets) only trusts a document
    // tagged `version: 1` - the canonical BuilderDocument shape.
    const doc: BuilderDocument = {
      version: 1,
      sections: [makeSection([a], "s1"), makeSection([b], "s2")],
    } as unknown as BuilderDocument;
    expect(
      collectBuilderWidgets(doc)
        .map((w) => w.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
  });
});

describe("prefetchSectionQueries", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("invokes queryClient.prefetchQuery for post-list widgets", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const section = makeSection([makeWidget("post-list"), makeWidget("heading")]);
    await prefetchSectionQueries(qc, section, "pl");
    // post-list -> 1 prefetch, heading -> 0
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("schedules slider fallback + post refs for slider widgets", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const slider = makeWidget("slider", {
      content: { items: [{ postId: "p1" }, { postId: "p2" }, { postId: "p1" }] },
    } as Partial<WidgetNode>);
    const section = makeSection([slider]);
    await prefetchSectionQueries(qc, section, "en");
    // 2 unique post refs + 1 fallback images query
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("does not throw when an underlying prefetch rejects", async () => {
    vi.spyOn(qc, "prefetchQuery").mockRejectedValue(new Error("net"));
    const section = makeSection([makeWidget("post-list")]);
    await expect(prefetchSectionQueries(qc, section, "pl")).resolves.toBeUndefined();
  });

  it("whole-document prefetch fans out across sections", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const doc: BuilderDocument = {
      version: 1,
      sections: [
        makeSection([makeWidget("post-list")], "s1"),
        makeSection([makeWidget("carousel")], "s2"),
      ],
    } as unknown as BuilderDocument;
    await prefetchBuilderDocumentQueries(qc, doc, "pl");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("collectAboveFoldWidgets", () => {
  function docOfSections(n: number): BuilderDocument {
    return {
      sections: Array.from({ length: n }, (_, i) =>
        makeSection([makeWidget("post-list")], `s${i}`),
      ),
    } as unknown as BuilderDocument;
  }

  it("returns widgets only from the first N sections", () => {
    const doc = docOfSections(5);
    expect(collectAboveFoldWidgets(doc, 2)).toHaveLength(2);
    expect(collectAboveFoldWidgets(doc, 4)).toHaveLength(4);
  });

  it("caps at the available section count", () => {
    const doc = docOfSections(2);
    expect(collectAboveFoldWidgets(doc, 10)).toHaveLength(2);
  });

  it("treats a non-positive count as zero", () => {
    const doc = docOfSections(3);
    expect(collectAboveFoldWidgets(doc, 0)).toHaveLength(0);
    expect(collectAboveFoldWidgets(doc, -1)).toHaveLength(0);
  });
});

describe("prefetchAboveFoldQueries", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  function docOfSections(n: number): BuilderDocument {
    return {
      sections: Array.from({ length: n }, (_, i) =>
        makeSection([makeWidget("post-list")], `s${i}`),
      ),
    } as unknown as BuilderDocument;
  }

  it("prefetches only the above-the-fold sections", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    await prefetchAboveFoldQueries(qc, docOfSections(6), "pl", { sections: 2 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("defaults to ABOVE_FOLD_SECTION_COUNT leading sections", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    await prefetchAboveFoldQueries(qc, docOfSections(10), "pl");
    expect(spy).toHaveBeenCalledTimes(ABOVE_FOLD_SECTION_COUNT);
  });

  it("does nothing when no data-bound widgets are above the fold", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const doc: BuilderDocument = {
      sections: [makeSection([makeWidget("heading"), makeWidget("text")], "s0")],
    } as unknown as BuilderDocument;
    await prefetchAboveFoldQueries(qc, doc, "pl");
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves within the latency budget even if a query never settles", async () => {
    vi.spyOn(qc, "prefetchQuery").mockReturnValue(new Promise<void>(() => {}));
    const start = Date.now();
    await prefetchAboveFoldQueries(qc, docOfSections(3), "pl", { budgetMs: 40 });
    // Returned because the budget elapsed, not because the prefetch settled.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("awaits fully when the budget is disabled", async () => {
    let resolved = false;
    vi.spyOn(qc, "prefetchQuery").mockImplementation(
      () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            resolved = true;
            r();
          }, 5),
        ),
    );
    await prefetchAboveFoldQueries(qc, docOfSections(1), "pl", { budgetMs: 0 });
    expect(resolved).toBe(true);
  });
});

describe("prefetchCachedRouteQueries", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  function docOfSections(n: number): BuilderDocument {
    return {
      sections: Array.from({ length: n }, (_, i) =>
        makeSection([makeWidget("post-list")], `s${i}`),
      ),
    } as unknown as BuilderDocument;
  }

  it("warms EVERY section, not just the above-the-fold cap", async () => {
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const sectionCount = ABOVE_FOLD_SECTION_COUNT + 5;
    // Budżet jest teraz WYMAGANY: martwe domyślne 6000 ms zniknęło razem
    // z jedynym wywołaniem, które na nim polegało (strona główna przeszła na
    // `prefetchAboveFoldQueries`). `0` = czekaj do końca, bez czapki - dla
    // tego testu deterministyczniej niż jakikolwiek zegar.
    await prefetchCachedRouteQueries(qc, docOfSections(sectionCount), "pl", 0);
    // One post-list prefetch per section - the whole document, uncapped.
    expect(spy).toHaveBeenCalledTimes(sectionCount);
  });

  it("stays bounded by the budget if a query never settles", async () => {
    vi.spyOn(qc, "prefetchQuery").mockReturnValue(new Promise<void>(() => {}));
    const start = Date.now();
    await prefetchCachedRouteQueries(qc, docOfSections(4), "pl", 40);
    // Returned because the budget elapsed, not because the prefetch settled.
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("widgetQueryOptionsList", () => {
  it("maps post-list / carousel to one list query each", () => {
    expect(widgetQueryOptionsList(makeWidget("post-list"), "pl")).toHaveLength(1);
    expect(widgetQueryOptionsList(makeWidget("carousel"), "pl")).toHaveLength(1);
    const [opts] = widgetQueryOptionsList(makeWidget("post-list"), "pl");
    expect(opts.queryKey[0]).toBe("builder-post-list");
  });

  it("maps a slider to one ref per UNIQUE post id plus a fallback-images query", () => {
    const slider = makeWidget("slider", {
      content: { items: [{ postId: "p1" }, { postId: "p2" }, { postId: "p1" }] },
    } as Partial<WidgetNode>);
    const opts = widgetQueryOptionsList(slider, "en");
    expect(opts).toHaveLength(3);
    const keys = opts.map((o) => o.queryKey[0]);
    expect(keys.filter((k) => k === "post-ref")).toHaveLength(2);
    expect(keys).toContain("builder-slider-fallback-images");
  });

  it("returns nothing for widgets with no data binding", () => {
    expect(widgetQueryOptionsList(makeWidget("heading"), "pl")).toHaveLength(0);
    expect(widgetQueryOptionsList(makeWidget("text"), "pl")).toHaveLength(0);
  });

  it("maps a menu widget to the shared menu-with-items query (SSR nav from the first byte)", () => {
    const menu = makeWidget("menu", { content: { menu_key: "footer" } } as Partial<WidgetNode>);
    const opts = widgetQueryOptionsList(menu, "pl");
    expect(opts).toHaveLength(1);
    // Ten sam klucz co useQuery w SiteMenu - wspólne menuWithItemsQueryOptions,
    // więc loader roota grzeje DOKŁADNIE to zapytanie, które czyta komponent.
    expect(opts[0].queryKey).toEqual(["menu-with-items", "footer"]);
  });

  it("defaults a keyless menu widget to the 'main' menu (mirrors SiteMenu's fallback)", () => {
    const bare = makeWidget("menu");
    expect(widgetQueryOptionsList(bare, "pl")[0].queryKey).toEqual(["menu-with-items", "main"]);
  });

  it("maps a posts-sourced slider to the slider-posts list query plus fallback images", () => {
    // Explicit posts source - the homepage hero configuration.
    const explicit = makeWidget("slider", {
      content: { source: "posts", limit: 5 },
    } as Partial<WidgetNode>);
    const keys = widgetQueryOptionsList(explicit, "pl").map((o) => o.queryKey[0]);
    expect(keys).toContain("builder-slider-posts");
    expect(keys).toContain("builder-slider-fallback-images");
    expect(keys).not.toContain("post-ref");
  });

  it("routes an items-less slider to posts mode, mirroring the renderer's auto-routing", () => {
    const bare = makeWidget("slider", { content: {} } as Partial<WidgetNode>);
    const keys = widgetQueryOptionsList(bare, "pl").map((o) => o.queryKey[0]);
    expect(keys).toContain("builder-slider-posts");
  });

  it("keeps per-item post refs for sliders with manually bound items", () => {
    const manual = makeWidget("slider", {
      content: { items: [{ postId: "p1" }, { image: "https://x/y.jpg" }] },
    } as Partial<WidgetNode>);
    const keys = widgetQueryOptionsList(manual, "pl").map((o) => o.queryKey[0]);
    expect(keys).not.toContain("builder-slider-posts");
    expect(keys.filter((k) => k === "post-ref")).toHaveLength(1);
  });

  it("is the single source of truth behind prefetchWidgets' fan-out count", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    const slider = makeWidget("slider", {
      content: { items: [{ postId: "p1" }, { postId: "p2" }] },
    } as Partial<WidgetNode>);
    const section = makeSection([makeWidget("post-list"), slider, makeWidget("heading")]);
    const expected = sectionQueryOptionsList(section, "pl").length;
    await prefetchSectionQueries(qc, section, "pl");
    expect(spy).toHaveBeenCalledTimes(expected);
    expect(expected).toBe(4); // 1 post-list + (2 refs + 1 fallback)
  });
});

describe("sectionQueryOptionsList", () => {
  it("flattens every data query across a section's widgets", () => {
    expect(
      sectionQueryOptionsList(makeSection([makeWidget("post-list"), makeWidget("heading")]), "pl"),
    ).toHaveLength(1);
    expect(
      sectionQueryOptionsList(makeSection([makeWidget("heading"), makeWidget("text")]), "pl"),
    ).toHaveLength(0);
  });
});

describe("pendingSectionQueries", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("treats a section with no data queries as fully settled", () => {
    const section = makeSection([makeWidget("heading")]);
    expect(pendingSectionQueries(qc, section, "pl")).toHaveLength(0);
  });

  it("reports every query as pending when the cache is cold", () => {
    const section = makeSection([makeWidget("post-list")]);
    expect(pendingSectionQueries(qc, section, "pl")).toHaveLength(1);
  });

  it("drops queries whose cache entry has resolved (success)", () => {
    const section = makeSection([makeWidget("post-list")]);
    sectionQueryOptionsList(section, "pl").forEach((o) => qc.setQueryData(o.queryKey, []));
    expect(pendingSectionQueries(qc, section, "pl")).toHaveLength(0);
  });

  it("treats an errored query as settled (the widget renders its own fallback)", () => {
    const section = makeSection([makeWidget("post-list")]);
    const [opts] = sectionQueryOptionsList(section, "pl");
    qc.setQueryData(opts.queryKey, []);
    const query = qc.getQueryCache().find({ queryKey: opts.queryKey });
    const state = qc.getQueryState(opts.queryKey);
    if (query && state) query.setState({ ...state, status: "error", error: new Error("boom") });
    expect(pendingSectionQueries(qc, section, "pl")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OGON PUNKTU 4: siedem typów widgetów bez gałęzi w rejestrze prefetchu.
//
// KLASA DEFEKTU. Brak gałęzi w `widgetQueryOptionsList` wyłącza NARAZ dwie
// rzeczy, i to bez jednego komunikatu błędu:
//   * prefetch SSR (`prefetchWidgets` iteruje po tym rejestrze) - serwer oddaje
//     widget bez danych, treść doskakuje po hydratacji,
//   * bramkę strumieniowania (`shouldStreamSection` wymaga NIEPUSTEJ listy
//     zapytań sekcji) - sekcja liczy się jako statyczna, więc nawet
//     `ServerSectionGate` nie ma na co czekać.
// Dlatego każdy typ ma tu DWIE asercje: klucz zgodny z odczytem widoku ORAZ
// niepusta lista widziana przez bramkę.
//
// DRUGA POŁOWA TEGO TESTU JEST STATYCZNA i to nie jest ozdoba. Klucz, którego
// widget nie czyta, jest AWARIĄ CICHĄ: rozgrzany wpis nikogo nie obsługuje,
// SSR zostaje pusty i nic nie płonie. Dopóki widoki mają własne `useQuery`
// (przełączenie ich na te fabryki to zmiana w `components/.../widget-view/`,
// poza tą), jedynym czujnikiem rozjazdu jest odczyt ich źródła.
// ---------------------------------------------------------------------------

const SRC = resolve(process.cwd(), "src");
const WIDGET_VIEW = resolve(SRC, "components/builder/organisms/widget-view");

function viewSource(file: string): string {
  return readFileSync(resolve(WIDGET_VIEW, file), "utf8");
}

/** Sekcja spod zgięcia: index === aboveFoldCount, czyli pierwsza strumieniowa. */
function streamsWithData(widget: WidgetNode): boolean {
  return shouldStreamSection(makeSection([widget]), "pl", 3, 3, true);
}

describe("ogon punktu 4 - taksonomie (categories / tags)", () => {
  it("categories grzeje DOKŁADNIE klucz czytany przez CategoriesView", () => {
    const widget = makeWidget("categories");
    const opts = widgetQueryOptionsList(widget, "pl");
    expect(opts).toHaveLength(1);
    expect(opts[0].queryKey).toEqual([WIDGET_QUERY_ROOTS.categories]);
    expect(opts[0].queryKey).toEqual(categoriesQueryOptions().queryKey);
    // Klucz jest niezależny od języka: PL i EN dzielą jeden wpis cache, bo
    // `select` pobiera oba języki, a wybór następuje w renderze.
    expect(widgetQueryOptionsList(widget, "en")[0].queryKey).toEqual(opts[0].queryKey);

    const targets = widgetCacheTargets(widget, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key).toEqual(opts[0].queryKey);
    // Zero oznaczałoby dla `useSectionPreload.isSectionFresh` "zawsze
    // przestarzałe", czyli rozgrzewkę tej sekcji po każdym renderze.
    expect(targets[0].staleTime).toBeGreaterThan(0);
  });

  it("tags grzeje DOKŁADNIE klucz czytany przez TagsView", () => {
    const widget = makeWidget("tags");
    const opts = widgetQueryOptionsList(widget, "pl");
    expect(opts).toHaveLength(1);
    expect(opts[0].queryKey).toEqual([WIDGET_QUERY_ROOTS.tags]);
    expect(opts[0].queryKey).toEqual(tagsQueryOptions().queryKey);

    const targets = widgetCacheTargets(widget, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key).toEqual(opts[0].queryKey);
    expect(targets[0].staleTime).toBeGreaterThan(0);
  });

  it("sekcja z samymi chipami przestaje być klasyfikowana jako statyczna", () => {
    expect(streamsWithData(makeWidget("categories"))).toBe(true);
    expect(streamsWithData(makeWidget("tags"))).toBe(true);
  });

  it("widoki nadal czytają ten sam korzeń klucza i te same kolumny (bramka dryfu)", () => {
    const cats = viewSource("CategoriesView.tsx");
    expect(cats).toContain("queryKey: [WIDGET_QUERY_ROOTS.categories]");
    expect(cats).toContain(`.select("${CATEGORY_CHIP_COLUMNS}")`);

    const tags = viewSource("TagsView.tsx");
    expect(tags).toContain("queryKey: [WIDGET_QUERY_ROOTS.tags]");
    expect(tags).toContain(`.select("${TAG_CHIP_COLUMNS}")`);
  });
});

describe("ogon punktu 4 - podcast-latest", () => {
  it("grzeje ten sam wpis, po który sięga PodcastLatestView", () => {
    const widget = makeWidget("podcast-latest", { content: { limit: 6 } } as Partial<WidgetNode>);
    const opts = widgetQueryOptionsList(widget, "pl");
    expect(opts).toHaveLength(1);
    // Widok woła `latestPodcastsQueryOptions(getNum(c, "limit", 4))` - ta sama
    // fabryka, ta sama liczba, więc ten sam wpis cache.
    expect(opts[0].queryKey).toEqual(latestPodcastsQueryOptions(6).queryKey);
    expect(opts[0].queryKey).toEqual(["podcasts", "latest", 6]);

    const targets = widgetCacheTargets(widget, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key).toEqual(opts[0].queryKey);
    expect(targets[0].staleTime).toBeGreaterThan(0);
    expect(streamsWithData(widget)).toBe(true);
  });

  it("koercja `limit` jest kopią widoku - liczba, sam ciąg cyfr, albo 4", () => {
    // Gdyby prefetch użył `asNum` z content-model, " 4 " i "4.5" dałyby INNY
    // klucz niż widok - rozgrzewka trafiałaby w pustkę.
    expect(podcastLatestLimit({ limit: 9 })).toBe(9);
    expect(podcastLatestLimit({ limit: "9" })).toBe(9);
    expect(podcastLatestLimit({ limit: " 9 " })).toBe(4);
    expect(podcastLatestLimit({ limit: "4.5" })).toBe(4);
    expect(podcastLatestLimit({ limit: "-2" })).toBe(4);
    expect(podcastLatestLimit({})).toBe(4);
    expect(podcastLatestQueryOptions({}).queryKey).toEqual(["podcasts", "latest", 4]);
  });

  it("widok nadal liczy `limit` tym samym wyrażeniem (bramka dryfu klucza)", () => {
    const view = viewSource("PodcastLatestView.tsx");
    expect(view).toContain(`getNum(c, "limit", 4)`);
    expect(view).toContain("latestPodcastsQueryOptions(limit)");
  });
});

describe("ogon punktu 4 - web-stories-carousel", () => {
  it("grzeje ten sam wpis, po który sięga WebStoriesCarouselView", () => {
    const widget = makeWidget("web-stories-carousel", {
      content: { limit: 12 },
    } as Partial<WidgetNode>);
    const opts = widgetQueryOptionsList(widget, "pl");
    expect(opts).toHaveLength(1);
    expect(opts[0].queryKey).toEqual(latestWebStoriesQueryOptions(12).queryKey);
    expect(opts[0].queryKey).toEqual(["web-stories", "latest", 12]);

    const targets = widgetCacheTargets(widget, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key).toEqual(opts[0].queryKey);
    expect(targets[0].staleTime).toBeGreaterThan(0);
    expect(streamsWithData(widget)).toBe(true);
  });

  it("klamra 2..20 JEST częścią klucza, więc liczy ją rejestr, nie queryFn", () => {
    expect(webStoriesCarouselLimit({})).toBe(8);
    expect(webStoriesCarouselLimit({ limit: 1 })).toBe(2);
    expect(webStoriesCarouselLimit({ limit: 99 })).toBe(20);
    expect(webStoriesCarouselLimit({ limit: "3" })).toBe(3);
    expect(webStoriesCarouselQueryOptions({ limit: 99 }).queryKey).toEqual([
      "web-stories",
      "latest",
      20,
    ]);
  });

  it("widok nadal zacieśnia `limit` tym samym wyrażeniem (bramka dryfu klucza)", () => {
    const view = viewSource("WebStoriesCarouselView.tsx");
    expect(view).toContain(`Math.max(2, Math.min(20, getNum(c, "limit", 8)))`);
    expect(view).toContain("latestWebStoriesQueryOptions(limit)");
  });
});

describe("ogon punktu 4 - pricing w trybie katalogu planów", () => {
  it("grzeje `plans-active` tylko przy source === plans", () => {
    const plans = makeWidget("pricing", { content: { source: "plans" } } as Partial<WidgetNode>);
    const opts = widgetQueryOptionsList(plans, "pl");
    expect(opts).toHaveLength(1);
    // Ten sam klucz co widok i co loadery /pricing, /membership-join,
    // /plans/$planId - jeden literał z billingKeys, więc rozjazd niewyrażalny.
    expect(opts[0].queryKey).toEqual(billingKeys.plansActive());
    expect(opts[0].queryKey).toEqual(activePlansQueryOptions().queryKey);

    const targets = widgetCacheTargets(plans, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key).toEqual(opts[0].queryKey);
    expect(targets[0].staleTime).toBeGreaterThan(0);
    expect(streamsWithData(plans)).toBe(true);
  });

  it("tryb ręczny nie ma zapytania i pozostaje sekcją statyczną", () => {
    const manual = makeWidget("pricing", {
      content: { plans: [{ name_pl: "Podstawowy" }] },
    } as Partial<WidgetNode>);
    expect(widgetQueryOptionsList(manual, "pl")).toEqual([]);
    expect(widgetCacheTargets(manual, "pl")).toEqual([]);
    expect(streamsWithData(manual)).toBe(false);
  });

  it("bramka źródła jest kopią tej z SimpleWidgets (bramka dryfu)", () => {
    const dispatch = readFileSync(resolve(WIDGET_VIEW, "SimpleWidgets.tsx"), "utf8");
    expect(dispatch).toContain(`getStr(c, "source") === "plans"`);
    const view = viewSource("PricingPlansView.tsx");
    expect(view).toContain("billingKeys.plansActive()");
    expect(view).toContain("queryFn: fetchActivePlans");
  });
});

describe("ogon punktu 4 - typy CELOWO bez gałęzi", () => {
  /**
   * `tailored-must-reads` NIE MOŻE dostać gałęzi prefetchu SSR i to nie jest
   * niedokończona praca, tylko decyzja - dlatego asercja jest twierdząca.
   *
   * TRZY NIEZALEŻNE POWODY:
   *  1. ZATRUCIE WPISU GOŚCIA. `useRecommendedPosts` czyta zainteresowania
   *     z `localStorage` (`anonMerge.readJson` zwraca `null`, gdy nie ma
   *     `window`), a klucz gościa `["recommended-posts","anon",N]` jest po obu
   *     stronach IDENTYCZNY. Rozgrzewka serwerowa wpisałaby więc do tego
   *     klucza listę BEZ personalizacji, a klient serwowałby ją przez cały
   *     `staleTime` 60 s - to jest GORSZE niż brak prefetchu.
   *  2. BRAK TOŻSAMOŚCI NA SERWERZE. Klucz niesie `user?.id ?? "anon"`, a
   *     sesję rozwiązuje przeglądarkowy klient Supabase - SSR widzi zawsze
   *     `null`, więc dla zalogowanego grzalibyśmy wpis, którego widget nie
   *     przeczyta.
   *  3. KLUCZ ZALEŻNY OD WYNIKU. `useAuthorsMap` kluczuje po id autorów
   *     WYLICZONYCH z rezultatu zapytania 1 - statyczny rejestr nie ma jak
   *     tego wyrazić.
   */
  it("tailored-must-reads pozostaje poza rejestrem - rozgrzewka zatruwałaby klucz gościa", () => {
    const widget = makeWidget("tailored-must-reads", {
      content: { limit: 3 },
    } as Partial<WidgetNode>);
    expect(widgetQueryOptionsList(widget, "pl")).toEqual([]);
    expect(widgetCacheTargets(widget, "pl")).toEqual([]);
  });

  /**
   * `rated-list` MIAŁ tu `it.fails` z adnotacją "ekstrakcja z widoku to decyzja
   * dla człowieka". Decyzja została podjęta i wykonana: klucz oraz cały
   * `queryFn` PRZENIESIONO z `RatedListView.tsx` do `lib/builder/ratedListQuery.ts`
   * (dało się, bo zapytanie zależało wyłącznie od treści widgetu i od `lang` -
   * zero stanu komponentu). Asercja jest teraz twierdząca i mieszka
   * w opisie niżej ("ogon punktu 4 - rated-list").
   */
});

describe("ogon punktu 4 - rated-list w trybie dynamicznym", () => {
  const DYN_CONTENT = {
    source: "dynamic",
    categoriesFilter: "polityka, gospodarka",
    excludeCategories: "sport",
    tagsFilter: "ue",
    excludeTags: "",
    postFormatFilter: "standard",
    authorFilter: "Redakcja",
    postIdsFilter: "",
    excludePostIds: "p9",
    orderBy: "title_asc",
    numberOfPosts: 6,
    postOffset: 2,
  };

  it("grzeje DOKŁADNIE wpis, po który sięga RatedListView", () => {
    const widget = makeWidget("rated-list", { content: DYN_CONTENT } as Partial<WidgetNode>);
    const opts = widgetQueryOptionsList(widget, "pl");
    expect(opts).toHaveLength(1);
    // Widok woła TĘ SAMĄ fabrykę, więc równość kluczy nie jest porównaniem
    // dwóch kopii, a tożsamością - jest jeden literał i jedno `queryFn`.
    expect(opts[0].queryKey).toEqual(ratedListQueryOptions(DYN_CONTENT, "pl").queryKey);
    expect(opts[0].queryKey).toEqual([
      WIDGET_QUERY_ROOTS.ratedList,
      {
        lang: "pl",
        cats: ["polityka", "gospodarka"],
        excludeCats: ["sport"],
        tagSlugs: ["ue"],
        excludeTagSlugs: [],
        postFormat: "standard",
        authors: ["Redakcja"],
        postIds: [],
        excludePostIds: ["p9"],
        orderBy: "title_asc",
        limit: 6,
        offset: 2,
      },
    ]);
    // Korzeń MUSI być kanoniczny, bo to on zasila inwalidację live
    // (`LIVE_INVALIDATED_ROOTS`) po publikacji wpisu.
    expect(opts[0].queryKey[0]).toBe(WIDGET_QUERY_ROOTS.ratedList);

    const targets = widgetCacheTargets(widget, "pl");
    expect(targets).toHaveLength(1);
    expect(targets[0].key).toEqual(opts[0].queryKey);
    // Zero oznaczałoby dla `useSectionPreload.isSectionFresh` "zawsze
    // przestarzałe", czyli rozgrzewkę tej sekcji po każdym renderze.
    expect(targets[0].staleTime).toBe(RATED_LIST_STALE_MS);
    expect(targets[0].staleTime).toBeGreaterThan(0);
  });

  it("sekcja z samą listą ocenianą przestaje być klasyfikowana jako statyczna", () => {
    const widget = makeWidget("rated-list", { content: DYN_CONTENT } as Partial<WidgetNode>);
    expect(streamsWithData(widget)).toBe(true);
  });

  it("PL i EN to dwa wpisy - queryFn sortuje po `title_${lang}` i wpieka tytuł", () => {
    const widget = makeWidget("rated-list", { content: DYN_CONTENT } as Partial<WidgetNode>);
    const pl = widgetQueryOptionsList(widget, "pl")[0].queryKey;
    const en = widgetQueryOptionsList(widget, "en")[0].queryKey;
    expect(pl).not.toEqual(en);
    expect((pl[1] as { lang: string }).lang).toBe("pl");
    expect((en[1] as { lang: string }).lang).toBe("en");
  });

  it("tryb ręczny nie ma zapytania i pozostaje sekcją statyczną", () => {
    const manual = makeWidget("rated-list", {
      content: { items: [{ title_pl: "Pozycja" }] },
    } as Partial<WidgetNode>);
    expect(ratedListUsesDynamicSource(manual.content)).toBe(false);
    expect(widgetQueryOptionsList(manual, "pl")).toEqual([]);
    expect(widgetCacheTargets(manual, "pl")).toEqual([]);
    expect(streamsWithData(manual)).toBe(false);
  });

  it("bramka źródła znosi spacje dokładnie tak, jak `asOneOf` w widoku", () => {
    // `asOneOf` trymuje wartość PRZED porównaniem, więc " dynamic " to nadal
    // tryb dynamiczny. Gdyby rejestr porównywał surowy string (jak `pricing`),
    // taki dokument miałby prefetch wyłączony bez żadnego sygnału.
    expect(ratedListUsesDynamicSource({ source: " dynamic " })).toBe(true);
    expect(ratedListUsesDynamicSource({ source: "DYNAMIC" })).toBe(false);
    expect(ratedListUsesDynamicSource({})).toBe(false);
  });

  it("koercje wejścia klucza są tymi samymi wyrażeniami, co w widoku", () => {
    // `limit` = asNumInRange(numberOfPosts, 4, 1, 50); `offset` = max(0, asNum(...)).
    expect(ratedListInput({}, "pl").limit).toBe(4);
    expect(ratedListInput({ numberOfPosts: 0 }, "pl").limit).toBe(1);
    expect(ratedListInput({ numberOfPosts: 999 }, "pl").limit).toBe(50);
    expect(ratedListInput({ numberOfPosts: "12" }, "pl").limit).toBe(12);
    expect(ratedListInput({ postOffset: -5 }, "pl").offset).toBe(0);
    expect(ratedListInput({ postOffset: "7" }, "pl").offset).toBe(7);
    // CSV: trim + odrzucenie pustych, BEZ sortowania i BEZ deduplikacji -
    // kolejność elementów tablicy JEST częścią hasha klucza (patrz niżej).
    expect(ratedListInput({ categoriesFilter: " b , ,a ,b " }, "pl").cats).toEqual(["b", "a", "b"]);
    // Nierozpoznane sortowanie wraca do wartości domyślnej widoku.
    expect(ratedListInput({ orderBy: "wymyślone" }, "pl").orderBy).toBe("last_published");
  });

  /**
   * CO USTALONO O HASZOWANIU KLUCZY OBIEKTOWYCH W REACT-QUERY 5 (nie zgadnięte).
   * `@tanstack/query-core` 5.102.8, `src/utils.ts:223`:
   *   export function hashKey(queryKey) {
   *     return JSON.stringify(queryKey, (_, val) =>
   *       isPlainObject(val) ? Object.keys(val).sort().reduce(...) : val);
   *   }
   * czyli klucze KAŻDEGO zwykłego obiektu są SORTOWANE przed serializacją -
   * kolejność pól w obiekcie wejścia nie wpływa na to, w który wpis cache
   * trafimy. Tablica nie przechodzi `isPlainObject`, więc jej kolejność JUŻ
   * wpływa. Test dowodzi obu połów przez publiczne API (bez importu z
   * query-core, który nie jest bezpośrednią zależnością projektu).
   */
  it("kolejność PÓL obiektu klucza jest nieistotna, kolejność ELEMENTÓW tablic - istotna", () => {
    const qc = new QueryClient();
    const root = WIDGET_QUERY_ROOTS.ratedList;
    qc.setQueryData([root, { lang: "pl", cats: ["a", "b"], limit: 4 }], ["zapisane"]);
    // Te same pola, inna kolejność zapisu -> TEN SAM wpis.
    expect(qc.getQueryData([root, { limit: 4, cats: ["a", "b"], lang: "pl" }])).toEqual([
      "zapisane",
    ]);
    // Ta sama zawartość tablicy, inna kolejność -> INNY wpis.
    expect(qc.getQueryData([root, { lang: "pl", cats: ["b", "a"], limit: 4 }])).toBeUndefined();
  });

  /**
   * BRAMKA DRYFU - tu w wariancie "widok nadal woła fabrykę".
   *
   * Dla taksonomii i mediów bramka porównuje LITERAŁY dwóch kopii zapytania, bo
   * kopie istnieją. Tutaj kopii nie ma: `queryFn` został przeniesiony, więc
   * jedyny sposób na ciche rozejście się prefetchu z widokiem to napisanie
   * w widoku DRUGIEGO zapytania obok fabryki. Dokładnie to sprawdzamy.
   */
  it("RatedListView nie odtworzył własnego zapytania obok fabryki (bramka dryfu)", () => {
    const view = viewSource("RatedListView.tsx");
    expect(view).toContain("...ratedListQueryOptions(c, lang)");
    expect(view).toContain("ratedListUsesDynamicSource(c)");
    // Żadnego drugiego klucza, żadnego drugiego `queryFn`, żadnego bezpośredniego
    // sięgnięcia do Supabase - inaczej wróciłyby dwie rozjeżdżające się kopie.
    expect(view).not.toContain("queryKey:");
    expect(view).not.toContain("queryFn:");
    expect(view).not.toContain("@/integrations/supabase/client");
    // Kolumny wiersza są jednym literałem w module danych.
    const dataModule = readFileSync(resolve(SRC, "lib/builder/ratedListQuery.ts"), "utf8");
    expect(dataModule).toContain(`"${RATED_LIST_POST_COLUMNS}"`);
    // IZOLACJA NAJEMCY zostaje na tej samej drodze, co miał widok: publiczna
    // projekcja `profiles_public` (zawężona do `public_tenant_id()`), anonimowy
    // klient `@/integrations/supabase/client`, zero klienta serwisowego.
    expect(dataModule).toContain(`"${RATED_LIST_PROFILE_COLUMNS}"`);
    expect(dataModule).toContain(`.from("profiles_public")`);
    expect(dataModule).toContain(`from "@/integrations/supabase/client"`);
    // Asercje ZAPRZECZAJĄCE liczymy na KODZIE bez komentarzy - inaczej sam
    // nagłówek modułu (który obiecuje "żadnego service_role") wywracałby test.
    const dataCode = dataModule
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(dataCode).not.toContain("service_role");
    expect(dataCode).not.toContain(`.from("profiles")`);
  });
});
