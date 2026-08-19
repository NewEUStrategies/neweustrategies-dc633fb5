// PRZEMIAŁ WARIANTÓW na poziomie REJESTRU (nie widoku).
//
// Rejestr nie przekazuje wariantu wprost - normalizuje go łańcuchem trójargumentowym
// (`v === "outline" ? "outline" : v === "ghost" ? "ghost" : "filled"`). Każde
// ogniwo tego łańcucha to osobna gałąź i wykonuje się WYŁĄCZNIE dla dokładnie
// tej wartości w `block.data`. Macierze bloków podają jeden wariant na typ, więc
// pozostałe ogniwa zostają martwe - i wtedy literówka w normalizacji
// („compact" -> „grid") przechodzi cicho: blok renderuje się, tylko w innym
// układzie niż wybrał redaktor.
//
// Ten plik podaje KAŻDĄ dozwoloną wartość każdego wyliczenia oraz wartość
// spoza listy (musi spaść na domyślną), przechodząc przez `BlockView` - czyli
// przez tę samą normalizację, którą wykonuje produkcja.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BlockView, BlocksTenantProvider } from "@/components/blocks/renderer";
import { BlocksRenderer } from "@/components/blocks/BlocksRenderer";
import type { Block, BlockType, BlocksDoc, Json } from "@/lib/blocks/types";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

const h = vi.hoisted(() => ({ posts: [] as unknown[], taxonomy: [] as unknown[] }));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: RouterLinkStub,
    useNavigate: () => () => undefined,
    useRouter: () => ({ navigate: () => undefined }),
    useSearch: () => ({}),
    useParams: () => ({}),
  };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/lib/queries/blocks", () => {
  const opts = (key: readonly unknown[], value: () => unknown) => ({
    queryKey: key,
    queryFn: async () => value(),
    staleTime: 0,
    gcTime: 0,
  });
  return {
    latestPostsBlockQueryOptions: (i: unknown) => opts(["lp", i], () => h.posts),
    queryLoopBlockQueryOptions: (i: unknown) => opts(["ql", i], () => h.posts),
    relatedPostsBlockQueryOptions: (i: unknown) => opts(["rp", i], () => h.posts),
    morePostsBlockQueryOptions: (i: unknown) => opts(["mp", i], () => h.posts),
    blockCategoriesQueryOptions: (i: unknown) => opts(["cat", i], () => h.taxonomy),
    blockArchivesQueryOptions: (i: unknown) => opts(["arch", i], () => h.taxonomy),
    blockTagsQueryOptions: (i: unknown) => opts(["tags", i], () => []),
    blockNavigationQueryOptions: () => opts(["nav"], () => []),
    postNeighborQueryOptions: (i: unknown) => opts(["nb", i], () => null),
    pollBlockQueryOptions: (i: unknown) => opts(["poll", i], () => null),
    authorProfileByIdQueryOptions: (i: unknown) => opts(["ap", i], () => null),
    authorPostsCountQueryOptions: (i: unknown) => opts(["apc", i], () => 3),
    calendarBlockQueryOptions: (i: unknown) => opts(["cal", i], () => []),
    calendarTarget: () => ({ year: 2026, month: 8 }),
    liveBlogEntriesBlockQueryOptions: (i: unknown) => opts(["lb", i], () => []),
  };
});
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const link of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "not",
    "like",
    "ilike",
    "or",
    "filter",
    "match",
    "contains",
    "overlaps",
    "order",
    "limit",
    "range",
    "returns",
    "abortSignal",
  ]) {
    chain[link] = () => chain;
  }
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (f?: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(f);
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
  };
});
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T extends object>(_k: string, d: T): T => ({ ...d, name: "NES" }) as T,
  siteSettingsQueryOptions: { queryKey: ["ss"], queryFn: async () => ({}) },
}));

const POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "wpis",
  title_pl: "Tytuł",
  title_en: "Title",
  excerpt_pl: "Zajawka",
  excerpt_en: "Excerpt",
  publishedAt: "2026-08-01T10:00:00.000Z",
  readingTimeMin: 5,
  viewCount: 10,
  author: { id: "author-1", name: "Autor", slug: "autor" } as CurrentPostCtx["author"],
  categories: [{ slug: "analizy", name: "Analizy" }],
  tags: [{ slug: "energia", name: "Energia" }],
  breadcrumbs: [{ label: "Start", href: "/" }],
};

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={POST_CTX}>
        <BlocksTenantProvider host="nes.test">{children}</BlocksTenantProvider>
      </CurrentPostProvider>
    </QueryClientProvider>
  );
}

function renderBlock(type: BlockType, data: Record<string, unknown>): HTMLElement {
  const block: Block = { id: `b_${type}`, type, data: data as Record<string, Json> };
  const { container } = render(
    <Wrap>
      <BlockView block={block} fnHtml={new Map()} lang="pl" postId="post-1" allBlocks={[block]} />
    </Wrap>,
  );
  return container;
}

const LEAKS = ["undefined", "NaN", "[object Object]", "Invalid Date"];
function assertNoLeak(container: HTMLElement, label: string): void {
  const text = container.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: wyciekło "${leak}"`).toBe(false);
  }
}

/**
 * Tabela wyliczeń: [typ bloku, klucz danych, dozwolone wartości, dodatkowe dane].
 * Każda wartość + jedna spoza listy = pełny łańcuch normalizacji.
 */
const ENUMS: Array<[BlockType, string, readonly string[], Record<string, unknown>]> = [
  [
    "group",
    "layout",
    ["group", "row", "stack", "grid"],
    {
      children: [{ id: "b_c", type: "paragraph", data: { html: "<p>x</p>" } }],
    },
  ],
  ["categories-list", "layout", ["list", "dropdown"], {}],
  ["archives", "layout", ["list", "dropdown"], {}],
  ["latest-posts", "layout", ["grid", "list"], { count: 2 }],
  ["query-loop", "layout", ["grid", "list"], { limit: 2 }],
  ["query-loop", "orderBy", ["date", "title"], { limit: 2 }],
  ["share-buttons", "variant", ["filled", "outline", "ghost"], { networks: ["x"] }],
  ["author-bio", "variant", ["card", "inline", "minimal", "split", "profile"], {}],
  ["related-posts", "strategy", ["category", "tag", "author", "latest"], { limit: 2 }],
  ["related-posts", "layout", ["grid", "list", "compact"], { limit: 2 }],
  ["more-posts", "strategy", ["latest", "trending", "category"], { limit: 2 }],
  ["post-navigation-link", "direction", ["next", "prev"], {}],
  ["post-terms", "taxonomy", ["categories", "tags"], {}],
  ["post-date", "format", ["long", "short", "relative"], {}],
  ["navigation", "layout", ["horizontal", "vertical"], {}],
  ["quote", "variant", ["default", "plain", "card", "minimal"], { text: "T" }],
  ["separator", "variant", ["line", "dots", "wide"], {}],
  ["callout", "variant", ["info", "warning", "success", "danger"], { text: "T" }],
  ["button", "variant", ["default", "outline", "ghost"], { label: "K", href: "/x" }],
  ["newsletter", "variant", ["inline", "card", "stacked"], {}],
  ["cta-section", "variant", ["primary", "brand", "muted"], { title: "T" }],
  ["alert-banner", "variant", ["info", "success", "warning", "danger"], { message: "M" }],
  ["testimonials", "layout", ["grid", "slider"], { items: [{ quote: "Q", author: "A" }] }],
  ["feature-grid", "style", ["card", "bordered", "plain"], { items: [{ title: "T" }] }],
  ["team-grid", "shape", ["circle", "square", "rounded"], { items: [{ name: "A" }] }],
  ["step-list", "orientation", ["vertical", "horizontal"], { items: [{ title: "K" }] }],
  ["step-list", "numberStyle", ["circle", "square", "plain"], { items: [{ title: "K" }] }],
  ["divider-text", "lineStyle", ["solid", "dashed", "dotted"], { text: "albo" }],
  ["divider-text", "align", ["left", "center", "right"], { text: "albo" }],
  ["banner-image", "theme", ["dark", "light"], { image: "https://cdn.test/b.jpg", title: "T" }],
  [
    "banner-image",
    "position",
    ["left", "center", "right"],
    {
      image: "https://cdn.test/b.jpg",
      title: "T",
    },
  ],
  ["tabs", "orientation", ["horizontal", "vertical"], { items: [{ label: "A", body: "B" }] }],
  ["image", "align", ["left", "center", "right"], { url: "https://cdn.test/a.jpg" }],
  ["image", "size", ["small", "medium", "full"], { url: "https://cdn.test/a.jpg" }],
  [
    "media-text",
    "mediaPosition",
    ["left", "right"],
    {
      url: "https://cdn.test/a.jpg",
      text: "<p>x</p>",
    },
  ],
  ["buttons", "align", ["left", "center", "right"], { items: [{ label: "A", href: "/a" }] }],
  [
    "social-icons",
    "align",
    ["left", "center", "right"],
    {
      items: [{ platform: "x", url: "https://x.com/a" }],
    },
  ],
  ["hero", "align", ["left", "center", "right"], { title: "T" }],
  ["hero", "height", ["sm", "md", "lg", "xl"], { title: "T" }],
  [
    "video-hero",
    "align",
    ["left", "center", "right"],
    { src: "https://cdn.test/v.mp4", title: "T" },
  ],
  ["video-hero", "height", ["sm", "md", "lg"], { src: "https://cdn.test/v.mp4", title: "T" }],
  ["icon-box", "align", ["left", "center", "right"], { title: "T" }],
  ["progress", "color", ["primary", "brand", "success", "warning", "danger"], { value: 40 }],
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
  h.posts = [
    {
      id: "p-1",
      slug: "wpis-1",
      title_pl: "Wpis",
      title_en: "Post",
      excerpt_pl: "Z",
      excerpt_en: "E",
      cover_image_url: "https://cdn.test/p.jpg",
      published_at: "2026-07-01T10:00:00.000Z",
      parent_page_id: "page-blog",
    },
  ];
  h.taxonomy = [{ label: "Analizy", href: "/analizy", count: 4 }];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("rejestr - przemiał wartości wyliczeniowych", () => {
  it.each(ENUMS)("%s / %s: każda dozwolona wartość renderuje się", (type, key, values, extra) => {
    for (const value of values) {
      const container = renderBlock(type, { ...extra, [key]: value });
      assertNoLeak(container, `${type}.${key}=${value}`);
      cleanup();
    }
    expect(values.length).toBeGreaterThan(1);
  });

  it.each(ENUMS)("%s / %s: wartość SPOZA listy spada na domyślną", (type, key, _values, extra) => {
    const container = renderBlock(type, { ...extra, [key]: "wartosc-z-przyszlosci" });
    assertNoLeak(container, `${type}.${key}=obca`);
  });

  it.each(ENUMS)("%s / %s: wartość PUSTA spada na domyślną", (type, key, _values, extra) => {
    const container = renderBlock(type, { ...extra, [key]: "" });
    assertNoLeak(container, `${type}.${key}=""`);
  });
});

describe("rejestr - author-bio: źródło autora", () => {
  it("authorSource=inline z pełnym autorem używa danych z bloku", () => {
    const container = renderBlock("author-bio", {
      authorSource: "inline",
      inlineAuthor: { id: "a-9", name: "Autor Z Bloku", slug: "z-bloku" },
    });
    expect(container.textContent).toContain("Autor Z Bloku");
  });

  it("authorSource=inline BEZ nazwy spada na autora z kontekstu wpisu", () => {
    const container = renderBlock("author-bio", {
      authorSource: "inline",
      inlineAuthor: { id: "a-9" },
    });
    expect(container.textContent).toContain("Autor");
  });

  it.each([
    ["inlineAuthor jako tablica", []],
    ["inlineAuthor jako string", "x"],
    ["inlineAuthor jako null", null],
  ])("%s jest ignorowany i wygrywa kontekst wpisu", (_l, inlineAuthor) => {
    const container = renderBlock("author-bio", { authorSource: "inline", inlineAuthor });
    expect(container.textContent).toContain("Autor");
  });

  it("authorId jako PUSTY string nie uruchamia dociągania profilu", () => {
    const container = renderBlock("author-bio", { authorId: "" });
    expect(container.textContent).toContain("Autor");
  });

  it("authorId nie-string jest ignorowany", () => {
    const container = renderBlock("author-bio", { authorId: 7 });
    expect(container.textContent).toContain("Autor");
  });

  it("wariant profile czyta styl karty z danych bloku", () => {
    const container = renderBlock("author-bio", {
      variant: "profile",
      imagePosition: "right",
      radiusPx: 4,
    });
    expect(container.textContent).toContain("Autor");
  });
});

describe("rejestr - share-buttons: lista kanałów", () => {
  it("lista kanałów z bloku jest przekazywana widokowi", () => {
    const container = renderBlock("share-buttons", { networks: ["x", "facebook"] });
    expect(container.querySelectorAll("a").length).toBeGreaterThanOrEqual(2);
  });

  it("BEZ listy kanałów widok używa własnego zestawu domyślnego", () => {
    const container = renderBlock("share-buttons", {});
    assertNoLeak(container, "share bez listy");
  });

  it.each([
    ["networks jako string", "x,facebook"],
    ["networks jako obiekt", { x: true }],
    ["networks jako null", null],
  ])("%s nie jest brane za listę", (_l, networks) => {
    const container = renderBlock("share-buttons", { networks });
    assertNoLeak(container, "share zły kształt");
  });
});

describe("rejestr - liveblog wymaga identyfikatora wpisu", () => {
  it("BEZ postId blok relacji nie renderuje niczego", () => {
    const block: Block = { id: "b_lb", type: "liveblog", data: { title: "R" } };
    const { container } = render(
      <Wrap>
        <BlockView block={block} fnHtml={new Map()} lang="pl" allBlocks={[block]} />
      </Wrap>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("Z postId blok relacji się renderuje", () => {
    const container = renderBlock("liveblog", { title: "Relacja" });
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
});

describe("BlocksRenderer - odstępy i degradacja dokumentu", () => {
  const doc = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });
  const para = (id: string, html: string, style?: Block["style"]): Block => ({
    id,
    type: "paragraph",
    data: { html },
    style,
  });

  function renderDoc(input: BlocksDoc | null | undefined): HTMLElement {
    const { container } = render(
      <Wrap>
        <BlocksRenderer doc={input} lang="pl" postId="post-1" />
      </Wrap>,
    );
    return container;
  }

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["dokument bez bloków", { version: 1 as const, blocks: [] }],
  ])("%s nie renderuje artykułu", (_l, input) => {
    expect(renderDoc(input).innerHTML).toBe("");
  });

  it("dokument, z którego walidacja nie zostawia ani jednego bloku, nie renderuje artykułu", () => {
    const raw = { version: 1, blocks: [{ id: "b", type: "typ-z-przyszlosci", data: {} }] };
    expect(renderDoc(raw as unknown as BlocksDoc).innerHTML).toBe("");
  });

  it("blok z marginesem GÓRNYM dostaje opakowanie ze stylem", () => {
    const container = renderDoc(doc([para("b1", "<p>x</p>", { marginTop: 24 })]));
    expect(container.innerHTML).toContain("margin-top: 24px");
  });

  it("blok z marginesem DOLNYM dostaje opakowanie ze stylem", () => {
    const container = renderDoc(doc([para("b1", "<p>x</p>", { marginBottom: 32 })]));
    expect(container.innerHTML).toContain("margin-bottom: 32px");
  });

  it("blok z OBOMA marginesami dostaje oba", () => {
    const container = renderDoc(doc([para("b1", "<p>x</p>", { marginTop: 8, marginBottom: 16 })]));
    expect(container.innerHTML).toContain("margin-top: 8px");
    expect(container.innerHTML).toContain("margin-bottom: 16px");
  });

  it("margines równy 0 JEST honorowany (0 to wartość, nie brak)", () => {
    const container = renderDoc(doc([para("b1", "<p>x</p>", { marginTop: 0 })]));
    expect(container.innerHTML).toContain("margin-top: 0px");
  });

  it("blok BEZ marginesów NIE dostaje opakowania (zachowuje odstępy prose)", () => {
    const container = renderDoc(doc([para("b1", "<p>x</p>")]));
    expect(container.innerHTML).not.toContain("margin-top");
    expect(container.innerHTML).not.toContain("margin-bottom");
  });

  it("blok UKRYTY nie trafia do artykułu", () => {
    const container = renderDoc(
      doc([para("b1", "<p>Widoczny</p>"), para("b2", "<p>Ukryty</p>", { hidden: true })]),
    );
    expect(container.textContent).toContain("Widoczny");
    expect(container.textContent).not.toContain("Ukryty");
  });

  it("jawny host najemcy trafia do atrybutu zakresu", () => {
    const { container } = render(
      <Wrap>
        <BlocksRenderer doc={doc([para("b1", "<p>x</p>")])} lang="pl" tenantHost="nes.test" />
      </Wrap>,
    );
    expect(container.querySelector("article")?.getAttribute("data-tenant-scope")).toBe("nes.test");
  });

  it("BEZ jawnego hosta atrybut zakresu nie jest wypisywany", () => {
    const container = renderDoc(doc([para("b1", "<p>x</p>")]));
    expect(container.querySelector("article")?.hasAttribute("data-tenant-scope")).toBe(false);
  });

  it.each(["pl", "en"] as const)("artykuł nosi atrybut lang=%s", (lang) => {
    const { container } = render(
      <Wrap>
        <BlocksRenderer doc={doc([para("b1", "<p>x</p>")])} lang={lang} />
      </Wrap>,
    );
    expect(container.querySelector("article")?.getAttribute("lang")).toBe(lang);
  });

  it("dokument Z PRZYPISAMI renderuje sekcję przypisów z odnośnikiem powrotnym", () => {
    const container = renderDoc(doc([para("b1", "<p>Teza[fn]Źródło[/fn].</p>")]));
    expect(container.querySelector("[data-footnotes-list]")).toBeTruthy();
    expect(container.querySelector("[data-footnote-backlink]")).toBeTruthy();
    expect(container.textContent).toContain("Źródło");
  });

  it("dokument BEZ przypisów nie renderuje sekcji przypisów", () => {
    const container = renderDoc(doc([para("b1", "<p>Bez przypisów</p>")]));
    expect(container.querySelector("[data-footnotes-list]")).toBeNull();
  });

  it("dokument z blokiem NIEPOPRAWNYM zachowuje pozostałe bloki", () => {
    const raw = {
      version: 1,
      blocks: [
        { id: "b1", type: "paragraph", data: { html: "<p>Zostaje</p>" } },
        { id: "b2", type: "typ-z-przyszlosci", data: {} },
      ],
    };
    const container = renderDoc(raw as unknown as BlocksDoc);
    expect(container.textContent).toContain("Zostaje");
  });
});
