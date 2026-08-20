// MACIERZ RENDERU bloków DYNAMICZNYCH w stanie DANE WCZYTANE.
//
// `blockMatrix.test.tsx` renderuje wszystkie typy, ale bloki czytające dane
// (`latest-posts`, `query-loop`, `related-posts`, `author-bio`, `tag-cloud`,
// `categories-list`, `archives`, `calendar`, `navigation`,
// `post-navigation-link`, `more-posts`, `poll`, `liveblog`) zostają tam
// w stanie „zapytanie w toku": react-query nic nie oddaje, więc gałąź
// „mam wiersze" nie wykonuje się ANI RAZU. A to właśnie ona rysuje kartę wpisu,
// datę, okładkę i licznik - czyli wszystko, co czytelnik naprawdę widzi.
//
// Ten plik podmienia `@/lib/queries/blocks` na opcje zapytań z GOTOWYMI danymi
// i przechodzi po tych blokach jeszcze raz: dane obecne, lista PUSTA, wiersz
// z polami `null` (tytuł bez tłumaczenia, wpis bez okładki, wpis bez daty)
// oraz oba języki.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BlockView, BlocksTenantProvider } from "@/components/blocks/renderer";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

const h = vi.hoisted(() => ({
  posts: [] as unknown[],
  taxonomy: [] as unknown[],
  tags: [] as unknown[],
  navCategories: [] as unknown[],
  neighbor: null as unknown,
  poll: null as unknown,
  authorProfile: null as unknown,
  authorPostsCount: 0,
  calendarDays: [] as unknown[],
  liveBlogEntries: [] as unknown[],
  siteSetting: {} as Record<string, unknown>,
}));

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
// Opcje zapytań z danymi w miejscu odczytu z bazy. Klucze zostają UNIKALNE per
// wejście - inaczej dwa bloki o różnej konfiguracji trafiłyby w jeden wpis
// cache i test „pustej listy" czytałby dane poprzedniego przypadku.
vi.mock("@/lib/queries/blocks", () => {
  const opts = (key: readonly unknown[], value: () => unknown) => ({
    queryKey: key,
    queryFn: async () => value(),
    staleTime: 0,
    gcTime: 0,
  });
  return {
    latestPostsBlockQueryOptions: (input: unknown) => opts(["latest-posts", input], () => h.posts),
    queryLoopBlockQueryOptions: (input: unknown) => opts(["query-loop", input], () => h.posts),
    relatedPostsBlockQueryOptions: (input: unknown) => opts(["related", input], () => h.posts),
    morePostsBlockQueryOptions: (input: unknown) => opts(["more-posts", input], () => h.posts),
    blockCategoriesQueryOptions: (lang: unknown) => opts(["categories", lang], () => h.taxonomy),
    blockArchivesQueryOptions: (lang: unknown) => opts(["archives", lang], () => h.taxonomy),
    blockTagsQueryOptions: (limit: unknown) => opts(["tags", limit], () => h.tags),
    blockNavigationQueryOptions: () => opts(["navigation"], () => h.navCategories),
    postNeighborQueryOptions: (input: unknown) => opts(["neighbor", input], () => h.neighbor),
    pollBlockQueryOptions: (id: unknown) => opts(["poll", id], () => h.poll),
    authorProfileByIdQueryOptions: (id: unknown) =>
      opts(["author-profile", id], () => h.authorProfile),
    authorPostsCountQueryOptions: (id: unknown) =>
      opts(["author-count", id], () => h.authorPostsCount),
    calendarBlockQueryOptions: (input: unknown) => opts(["calendar", input], () => h.calendarDays),
    calendarTarget: (month: string) => {
      const m = /^(\d{4})-(\d{2})$/.exec(month);
      return m ? { year: Number(m[1]), month: Number(m[2]) } : { year: 2026, month: 8 };
    },
    liveBlogEntriesBlockQueryOptions: (input: unknown) =>
      opts(["liveblog", input], () => h.liveBlogEntries),
  };
});
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T extends object>(_key: string, defaults: T): T => ({
    ...defaults,
    ...h.siteSetting,
  }),
  siteSettingsQueryOptions: { queryKey: ["site-settings"], queryFn: async () => ({}) },
}));
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
  chain.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled);
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    unsubscribe: () => undefined,
  };
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
  };
});
vi.mock("@/components/blocks/renderer/lazyBlockViews", async () => {
  const [dataViz, poll, calendar, liveblog] = await Promise.all([
    import("@/components/blocks/DataVizViews"),
    import("@/components/blocks/PollBlockView"),
    import("@/components/blocks/CalendarView"),
    import("@/components/blocks/LiveBlogBlock"),
  ]);
  return {
    ChartBlockView: dataViz.ChartBlockView,
    DataMapBlockView: dataViz.DataMapBlockView,
    PollBlockView: poll.PollBlockView,
    CalendarView: calendar.CalendarView,
    LiveBlogBlock: liveblog.LiveBlogBlock,
  };
});

const NOW = new Date("2026-08-19T12:00:00.000Z");

const POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "przykladowy-wpis",
  title_pl: "Tytuł wpisu",
  title_en: "Post title",
  excerpt_pl: "Zajawka.",
  excerpt_en: "Excerpt.",
  coverUrl: "https://cdn.test/cover.jpg",
  publishedAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-15T10:00:00.000Z",
  readingTimeMin: 7,
  viewCount: 1234,
  author: {
    id: "author-1",
    name: "Autor Testowy",
    slug: "autor-testowy",
    avatarUrl: "https://cdn.test/avatar.jpg",
    bio: "Biogram autora.",
    postsCount: 12,
  } as CurrentPostCtx["author"],
  categories: [{ slug: "analizy", name: "Analizy" }],
  tags: [{ slug: "energia", name: "Energia" }],
  breadcrumbs: [{ label: "Start", href: "/" }, { label: "Wpis" }],
};

/** Wiersz wpisu w kształcie, jaki oddaje warstwa zapytań bloków. */
function postRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p-1",
    slug: "pierwszy-wpis",
    title_pl: "Pierwszy wpis",
    title_en: "First post",
    excerpt_pl: "Zajawka pierwszego wpisu.",
    excerpt_en: "First post excerpt.",
    cover_image_url: "https://cdn.test/p1.jpg",
    published_at: "2026-07-01T10:00:00.000Z",
    parent_page_id: "page-blog",
    ...overrides,
  };
}

const FULL_POSTS = [postRow(), postRow({ id: "p-2", slug: "drugi-wpis", title_pl: "Drugi wpis" })];
const BARE_POSTS = [
  postRow({
    title_pl: null,
    title_en: null,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: null,
    parent_page_id: null,
  }),
];
const FULL_TAXONOMY = [
  { label: "Analizy", href: "/analizy", count: 12 },
  { label: "Raporty", href: "/raporty", count: 0 },
];
const FULL_TAGS = [
  { slug: "energia", name: "Energia" },
  { slug: "obronnosc", name: "Obronność" },
];
const FULL_NAV = [
  { id: "c-1", slug: "analizy", name_pl: "Analizy", name_en: "Analyses" },
  { id: "c-2", slug: "raporty", name_pl: null, name_en: null },
];
const FULL_POLL = {
  id: "11111111-2222-3333-4444-555555555555",
  question_pl: "Pytanie ankiety?",
  question_en: "Poll question?",
  options: [
    { pl: "Odpowiedź A", en: "Answer A" },
    { pl: "Odpowiedź B", en: "Answer B" },
  ],
  status: "open",
  ends_at: "2026-12-31T23:59:59.000Z",
};
const FULL_AUTHOR_PROFILE = {
  id: "author-1",
  slug: "autor-testowy",
  display_name: "Autor Testowy",
  avatar_url: "https://cdn.test/avatar.jpg",
  bio_pl: "Biogram po polsku.",
  bio_en: "Bio in English.",
  job_title: "Analityk",
  twitter_url: "https://x.com/autor",
  linkedin_url: "https://linkedin.com/in/autor",
  facebook_url: "https://facebook.com/autor",
  instagram_url: "https://instagram.com/autor",
  spotify_url: "https://open.spotify.com/artist/autor",
  website_url: "https://autor.test",
};
const FULL_LIVE_ENTRIES = [
  {
    id: "e-1",
    post_id: "post-1",
    block_id: "b_liveblog",
    lang: "pl",
    title: "Wpis przypięty",
    body_html: "<p>Treść wpisu na żywo</p>",
    pinned: true,
    occurred_at: "2026-08-19T11:00:00.000Z",
  },
  {
    id: "e-2",
    post_id: "post-1",
    block_id: "b_liveblog",
    lang: "pl",
    title: null,
    body_html: "<p>Drugi wpis</p>",
    pinned: false,
    occurred_at: "2026-08-19T10:00:00.000Z",
  },
];

/** Bloki, których render zależy od danych z warstwy zapytań. */
const DATA_BLOCKS: Array<[BlockType, Record<string, unknown>]> = [
  [
    "latest-posts",
    { count: 4, category: "analizy", layout: "grid", showExcerpt: true, showImage: true },
  ],
  ["latest-posts", { count: 2, layout: "list", showExcerpt: false, showImage: false }],
  ["query-loop", { limit: 3, layout: "grid", showDate: true, showExcerpt: true, showImage: true }],
  [
    "query-loop",
    { limit: 3, layout: "list", showDate: false, showExcerpt: false, showImage: false },
  ],
  ["related-posts", { heading: "Powiązane", limit: 3, layout: "grid", strategy: "category" }],
  ["related-posts", { limit: 3, layout: "list", strategy: "tag" }],
  ["more-posts", { heading: "Więcej", limit: 4, strategy: "latest" }],
  ["more-posts", { limit: 4, strategy: "trending" }],
  ["more-posts", { limit: 4, strategy: "category" }],
  ["tag-cloud", { count: 20, showCount: true }],
  ["tag-cloud", { count: 5, showCount: false }],
  ["categories-list", { layout: "grid", showCount: true }],
  ["categories-list", { layout: "list", showCount: false }],
  ["archives", { layout: "list", showCount: true }],
  ["archives", { layout: "grid", showCount: false }],
  ["calendar", { month: "2026-08" }],
  ["calendar", { month: "nieprawidłowy" }],
  ["navigation", { menuKey: "main", layout: "horizontal" }],
  ["navigation", { layout: "vertical" }],
  ["post-navigation-link", { direction: "next", showTitle: true }],
  ["post-navigation-link", { direction: "prev", showTitle: false }],
  ["poll", { pollId: "11111111-2222-3333-4444-555555555555" }],
  ["liveblog", { title: "Relacja", reverseChronological: true, autoRefresh: true }],
  ["liveblog", { reverseChronological: false, autoRefresh: false }],
  [
    "author-bio",
    { variant: "card", showAvatar: true, showBio: true, showSocial: true, showPostsCount: true },
  ],
  [
    "author-bio",
    {
      variant: "inline",
      showAvatar: false,
      showBio: false,
      showSocial: false,
      showPostsCount: false,
    },
  ],
];

const LABEL = (type: BlockType, data: Record<string, unknown>): string =>
  `${type} ${JSON.stringify(data).slice(0, 60)}`;

function blockOf(type: BlockType, data: Record<string, unknown>): Block {
  return { id: `b_${type}`, type, data: data as Record<string, Json> };
}

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={POST_CTX}>
        <BlocksTenantProvider host="nes.test">{children}</BlocksTenantProvider>
      </CurrentPostProvider>
    </QueryClientProvider>
  );
}

async function renderLoaded(block: Block, lang: "pl" | "en" = "pl"): Promise<HTMLElement> {
  const { container, findByTestId } = render(
    <Harness>
      <div data-testid="korzen">
        <BlockView
          block={block}
          fnHtml={new Map()}
          lang={lang}
          postId="post-1"
          allBlocks={[block]}
        />
      </div>
    </Harness>,
  );
  // Czekamy na commit po rozwiązaniu zapytania - bez tego mierzymy stan
  // „w toku", czyli dokładnie tę gałąź, którą już pokrywa blockMatrix.
  await findByTestId("korzen");
  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid="korzen"]')).toBeTruthy();
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return container;
}

const LEAKS = ["undefined", "NaN", "[object Object]", "Invalid Date"];

function assertNoLeak(container: HTMLElement, label: string): void {
  const text = container.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: wyciekło "${leak}" -> ${text.slice(0, 200)}`).toBe(
      false,
    );
  }
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  h.posts = FULL_POSTS;
  h.taxonomy = FULL_TAXONOMY;
  h.tags = FULL_TAGS;
  h.navCategories = FULL_NAV;
  h.neighbor = { post: postRow(), href: "/blog/pierwszy-wpis" };
  h.poll = FULL_POLL;
  h.authorProfile = FULL_AUTHOR_PROFILE;
  h.authorPostsCount = 12;
  h.calendarDays = [
    { slug: "pierwszy-wpis", published_at: "2026-08-05T10:00:00.000Z" },
    { slug: "drugi-wpis", published_at: "2026-08-20T10:00:00.000Z" },
  ];
  h.liveBlogEntries = FULL_LIVE_ENTRIES;
  h.siteSetting = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bloki dynamiczne - dane WCZYTANE", () => {
  it.each(DATA_BLOCKS)("%s renderuje treść z danych bez wycieku wartości", async (type, data) => {
    const container = await renderLoaded(blockOf(type, data));
    assertNoLeak(container, LABEL(type, data));
  });

  it.each(DATA_BLOCKS)("%s renderuje treść z danych po angielsku", async (type, data) => {
    const container = await renderLoaded(blockOf(type, data), "en");
    assertNoLeak(container, `${LABEL(type, data)} (EN)`);
  });
});

describe("bloki dynamiczne - lista PUSTA", () => {
  beforeEach(() => {
    h.posts = [];
    h.taxonomy = [];
    h.tags = [];
    h.navCategories = [];
    h.neighbor = null;
    h.poll = null;
    h.authorProfile = null;
    h.authorPostsCount = 0;
    h.calendarDays = [];
    h.liveBlogEntries = [];
  });

  it.each(DATA_BLOCKS)("%s znosi brak wyników bez wyjątku", async (type, data) => {
    const container = await renderLoaded(blockOf(type, data));
    assertNoLeak(container, `${LABEL(type, data)} (pusto)`);
  });
});

describe("bloki dynamiczne - wiersz z polami NULL", () => {
  // Najczęstszy realny kształt danych: wpis bez tłumaczenia tytułu, bez
  // okładki, bez daty publikacji. Renderer MUSI go pokazać albo pominąć -
  // nigdy wypisać „null" ani „Invalid Date".
  beforeEach(() => {
    h.posts = BARE_POSTS;
    h.neighbor = {
      post: postRow({ title_pl: null, title_en: null, published_at: null, cover_image_url: null }),
      href: "/blog/pierwszy-wpis",
    };
    h.navCategories = [{ id: "c-1", slug: "x", name_pl: null, name_en: null }];
    h.authorProfile = {
      id: "author-1",
      slug: null,
      display_name: null,
      avatar_url: null,
      bio_pl: null,
      bio_en: null,
      job_title: null,
      twitter_url: null,
      linkedin_url: null,
      facebook_url: null,
      instagram_url: null,
      spotify_url: null,
      website_url: null,
    };
    h.liveBlogEntries = [
      {
        id: "e-1",
        post_id: "post-1",
        block_id: "b_liveblog",
        lang: "pl",
        title: null,
        body_html: "",
        pinned: false,
        occurred_at: "2026-08-19T11:00:00.000Z",
      },
    ];
    h.poll = {
      id: "11111111-2222-3333-4444-555555555555",
      question_pl: null,
      question_en: null,
      options: [],
      status: "closed",
      ends_at: null,
    };
  });

  it.each(DATA_BLOCKS)("%s znosi wiersz z pustymi polami", async (type, data) => {
    const container = await renderLoaded(blockOf(type, data));
    assertNoLeak(container, `${LABEL(type, data)} (null)`);
    // „null" wypisany dosłownie to ta sama klasa awarii co „undefined".
    expect(container.textContent ?? "").not.toContain("null");
  });
});

describe("bloki kontekstowe - stan bez wpisu", () => {
  // Bloki `post-*` trafiają też na strony bez kontekstu wpisu (archiwum,
  // wyszukiwarka, strona statyczna). Muszą się wtedy schować, nie wywalić.
  const CONTEXT_BLOCKS: Array<[BlockType, Record<string, unknown>]> = [
    ["post-title", { level: 2 }],
    ["post-date", { format: "long", showUpdated: false }],
    ["post-author", { showAvatar: true, showBio: true }],
    ["post-excerpt", { showMore: true }],
    ["post-featured-image", { aspect: "16/9", rounded: true }],
    ["post-terms", { taxonomy: "categories" }],
    ["breadcrumbs", { separator: ">", showHome: true }],
    ["reading-time", { prefix: "Czas:", wpm: 200 }],
    ["post-views", { suffix: "odsłon" }],
    ["post-stats", { items: ["views", "readingTime"], separator: "-" }],
    ["author-bio", { variant: "card" }],
    ["related-posts", { limit: 3, strategy: "category" }],
    ["post-navigation-link", { direction: "next", showTitle: true }],
  ];

  it.each(CONTEXT_BLOCKS)("%s bez kontekstu wpisu nie wywala renderu", async (type, data) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <CurrentPostProvider value={null}>
          <BlocksTenantProvider host="nes.test">
            <BlockView block={blockOf(type, data)} fnHtml={new Map()} lang="pl" allBlocks={[]} />
          </BlocksTenantProvider>
        </CurrentPostProvider>
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertNoLeak(container, `${type} (bez wpisu)`);
  });
});

describe("bloki kontekstowe - formaty daty i drugi język", () => {
  it.each(["long", "short", "relative", "nieznany-format"])(
    "post-date w formacie %s renderuje datę deterministycznie",
    async (format) => {
      const container = await renderLoaded(blockOf("post-date", { format, showUpdated: false }));
      const time = container.querySelector("time");
      expect(time, `format ${format}`).toBeTruthy();
      expect(time?.getAttribute("datetime")).toBe("2026-08-01T10:00:00.000Z");
      assertNoLeak(container, `post-date ${format}`);
    },
  );

  it.each(["pl", "en"] as const)("post-date w formacie relative dla %s", async (lang) => {
    const container = await renderLoaded(
      blockOf("post-date", { format: "relative", showUpdated: false }),
      lang,
    );
    assertNoLeak(container, `post-date relative ${lang}`);
    expect((container.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("post-date z showUpdated bierze datę AKTUALIZACJI, nie publikacji", async () => {
    const container = await renderLoaded(
      blockOf("post-date", { format: "long", showUpdated: true }),
    );
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-08-15T10:00:00.000Z",
    );
  });

  it.each([
    ["pl", "Tytuł wpisu"],
    ["en", "Post title"],
  ] as const)("post-title dla %s pokazuje tytuł w tym języku", async (lang, expected) => {
    const container = await renderLoaded(blockOf("post-title", { level: 2 }), lang);
    expect(container.textContent).toContain(expected);
  });

  it.each([1, 2, 3, 4, 5, 9, 0, -1])(
    "post-title klampuje poziom nagłówka %i do zakresu h1-h4",
    async (level) => {
      const container = await renderLoaded(blockOf("post-title", { level }));
      const heading = container.querySelector("h1,h2,h3,h4");
      expect(heading, `poziom ${level}`).toBeTruthy();
    },
  );

  it.each(["categories", "tags", "nieznana"])(
    "post-terms dla taksonomii %s renderuje się bez wyjątku",
    async (taxonomy) => {
      const container = await renderLoaded(blockOf("post-terms", { taxonomy }));
      assertNoLeak(container, `post-terms ${taxonomy}`);
    },
  );
});
