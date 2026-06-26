// Coverage for the data-driven widget view components. Each is rendered
// directly (not through the lazy WidgetView boundary) with a stubbed data
// layer so the populated render paths - cards, lists, marquee, chips - and
// their empty states are exercised.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// Per-table dataset, mutated per test. Hoisted so the vi.mock factory can close
// over it before the module graph is imported.
const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
const podcasts = vi.hoisted(() => ({ list: [] as unknown[] }));
const stories = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const methods = [
      "select",
      "eq",
      "neq",
      "is",
      "in",
      "not",
      "gte",
      "lte",
      "gt",
      "lt",
      "order",
      "range",
      "limit",
      "or",
      "filter",
      "ilike",
      "match",
      "contains",
    ];
    for (const m of methods) builder[m] = () => builder;
    builder.single = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null });
    builder.maybeSingle = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null });
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return builder;
  };
  return {
    supabase: { from: (t: string) => makeBuilder(t), rpc: async () => ({ data: [], error: null }) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
}));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
      ...rest
    }: { to?: unknown; params?: { slug?: string }; children?: unknown } & Record<
      string,
      unknown
    >) => (
      <a href={typeof to === "string" ? to.replace("$slug", params?.slug ?? "") : "#"} {...rest}>
        {children as never}
      </a>
    ),
  };
});

// Podcast/web-story query options resolve from their own Supabase helpers;
// stub the option factories so the views receive deterministic episodes/stories.
vi.mock("@/lib/queries/podcasts", () => ({
  latestPodcastsQueryOptions: (limit: number) => ({
    queryKey: ["pods", limit],
    queryFn: async () => podcasts.list,
  }),
}));
vi.mock("@/lib/queries/webStories", () => ({
  latestWebStoriesQueryOptions: (limit: number) => ({
    queryKey: ["stories", limit],
    queryFn: async () => stories.list,
  }),
}));
// The audio player is an unrelated atom; keep it inert so podcast cards render fast.
vi.mock("@/components/atoms/PodcastPlayer", () => ({
  PodcastPlayer: () => <div data-testid="podcast-player" />,
}));
// The full-screen story viewer is unrelated; stub it so opening a story is observable.
vi.mock("@/components/web-stories/StoryViewer", () => ({
  StoryViewer: () => <div data-testid="story-viewer" />,
}));

import { RatedListView } from "../RatedListView";
import { TabsBlock } from "../TabsBlock";
import { NewsTickerView } from "../NewsTickerView";
import { PodcastLatestView } from "../PodcastLatestView";
import { WebStoriesCarouselView } from "../WebStoriesCarouselView";
import { PostListView } from "../PostListView";
import { CategoriesView } from "../CategoriesView";
import { TagsView } from "../TagsView";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  db.tables = {};
  podcasts.list = [];
  stories.list = [];
});
afterEach(cleanup);

describe("RatedListView (manual source)", () => {
  const items = [
    {
      title_pl: "Pierwszy temat",
      title_en: "First",
      excerpt_pl: "Opis A",
      author: "Anna",
      rating: 8.3,
      category_pl: "Analiza",
    },
    {
      title_pl: "Drugi temat",
      title_en: "Second",
      excerpt_pl: "Opis B",
      author: "Jan",
      rating: 9.1,
      category_pl: "Wywiad",
    },
  ];

  it("renders manually-authored items with author + excerpt", () => {
    const { container } = wrap(
      <RatedListView
        c={{ source: "manual", items, showAuthor: true, showExcerpt: true }}
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("Pierwszy temat");
    expect(container.textContent).toContain("Drugi temat");
    expect(container.textContent).toContain("Anna");
  });

  it("honours number position + rating + category toggles in dark mode", () => {
    const { container } = wrap(
      <RatedListView
        c={{
          source: "manual",
          items,
          numberPosition: "inline",
          showRating: true,
          showCategory: true,
          showDate: true,
        }}
        lang="pl"
        mode="dark"
      />,
    );
    expect(container.textContent).toContain("Pierwszy temat");
  });

  it("localizes titles for EN", () => {
    const { container } = wrap(<RatedListView c={{ source: "manual", items }} lang="en" />);
    expect(container.textContent).toContain("First");
  });

  it("renders grid layout with load-more, borders and rich item toggles", () => {
    const { container } = wrap(
      <RatedListView
        c={{
          source: "manual",
          items,
          columnsDesktop: 2,
          columnGapPx: 16,
          rowGapPx: 20,
          gridBorders: "full",
          gridBorderWidthPx: 2,
          scrollingMode: "loadmore",
          pageSize: 1,
          showReadMore: true,
          showBookmark: true,
          showPostFormat: true,
          numberPosition: "left",
          colorScheme: "dark",
        }}
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("Pierwszy temat");
  });

  it("renders the dynamic source by querying posts + author profiles", async () => {
    db.tables.posts = [
      {
        id: "1",
        slug: "dyn-1",
        title_pl: "Dynamiczny wpis",
        title_en: "Dynamic",
        excerpt_pl: "Z bazy",
        excerpt_en: "From DB",
        published_at: "2026-02-01T00:00:00Z",
        post_format: "video",
        author_id: "a1",
      },
    ];
    db.tables.profiles = [{ id: "a1", display_name: "Redakcja" }];
    wrap(
      <RatedListView
        c={{ source: "dynamic", numberOfPosts: 4, showAuthor: true, showPostFormat: true }}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Dynamiczny wpis")).toBeTruthy();
    expect(screen.getByText(/Redakcja/)).toBeTruthy();
  });
});

describe("TabsBlock", () => {
  const tabs = [
    { label_pl: "Zakładka 1", html_pl: "<p>Treść jeden</p>" },
    { label_pl: "Zakładka 2", html_pl: "<p>Treść dwa</p>" },
  ];

  it("shows the first panel and switches on tab click", () => {
    wrap(<TabsBlock tabs={tabs} lang="pl" nodeId="n1" />);
    expect(screen.getByText("Treść jeden")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Zakładka 2" }));
    expect(screen.getByText("Treść dwa")).toBeTruthy();
  });

  it("renders a placeholder when there are no tabs", () => {
    const { container } = wrap(<TabsBlock tabs={[]} lang="pl" nodeId="n2" />);
    expect(container.textContent).toContain("Brak zakładek");
  });
});

describe("NewsTickerView", () => {
  it("renders a marquee of post links when data is present", async () => {
    db.tables.posts = [
      { id: "1", slug: "alpha", title_pl: "Alfa", title_en: "Alpha" },
      { id: "2", slug: "beta", title_pl: "Beta", title_en: "Beta" },
    ];
    wrap(<NewsTickerView c={{ badge_pl: "Najnowsze", limit: 10 }} lang="pl" />);
    const links = await screen.findAllByRole("link", { name: "Alfa" });
    expect(links[0].getAttribute("href")).toBe("/post/alpha");
  });

  it("shows an empty-state message when there are no posts", async () => {
    db.tables.posts = [];
    wrap(<NewsTickerView c={{}} lang="pl" />);
    expect(await screen.findByText(/Brak wpisów/)).toBeTruthy();
  });
});

describe("PodcastLatestView", () => {
  const eps = [
    {
      id: "p1",
      slug: "odc-1",
      title_pl: "Odcinek 1",
      title_en: "Episode 1",
      excerpt_pl: "Opis",
      cover_image_url: "https://cdn.x/c1.jpg",
      audio_url: "https://cdn.x/a1.mp3",
      duration_seconds: 125,
      season: 1,
      episode_number: 1,
    },
    {
      id: "p2",
      slug: "odc-2",
      title_pl: "Odcinek 2",
      title_en: "Episode 2",
      excerpt_pl: "Opis",
      cover_image_url: "",
      audio_url: "https://cdn.x/a2.mp3",
      duration_seconds: 60,
      season: 1,
      episode_number: 2,
    },
  ];

  it("renders grid / list / featured variants", async () => {
    for (const variant of ["grid", "list", "featured"]) {
      podcasts.list = eps;
      const view = wrap(
        <PodcastLatestView c={{ variant, columns: 2, showPlayer: "false" }} lang="pl" />,
      );
      expect(await screen.findByText("Odcinek 1")).toBeTruthy();
      view.unmount();
    }
  });

  it("shows the empty state with no episodes", async () => {
    podcasts.list = [];
    wrap(<PodcastLatestView c={{}} lang="pl" />);
    expect(await screen.findByText(/Brak odcinków/)).toBeTruthy();
  });
});

describe("WebStoriesCarouselView", () => {
  const items = [
    {
      id: "s1",
      slug: "story-1",
      title_pl: "Historia 1",
      title_en: "Story 1",
      cover_url: "https://cdn.x/s1.jpg",
      pages: [],
    },
    {
      id: "s2",
      slug: "story-2",
      title_pl: "Historia 2",
      title_en: "Story 2",
      cover_url: "",
      pages: [],
    },
  ];

  it("renders story cards in carousel and grid variants", async () => {
    for (const variant of ["carousel", "grid"]) {
      stories.list = items;
      const view = wrap(<WebStoriesCarouselView c={{ variant, limit: 8 }} lang="pl" />);
      expect((await screen.findAllByLabelText("Historia 1")).length).toBeGreaterThan(0);
      view.unmount();
    }
  });

  it("shows the empty state with no stories", async () => {
    stories.list = [];
    wrap(<WebStoriesCarouselView c={{}} lang="pl" />);
    expect(await screen.findByText(/Brak historii/)).toBeTruthy();
  });
});

describe("PostListView", () => {
  const posts = [
    {
      id: "1",
      slug: "first",
      title_pl: "Pierwszy wpis",
      title_en: "First post",
      excerpt_pl: "Zajawka",
      excerpt_en: "Excerpt",
      cover_image_url: "https://cdn.x/1.jpg",
      published_at: "2026-01-01T00:00:00Z",
      post_format: "standard",
      author_id: "a1",
    },
    {
      id: "2",
      slug: "second",
      title_pl: "Drugi wpis",
      title_en: "Second post",
      excerpt_pl: "Zajawka 2",
      excerpt_en: "Excerpt 2",
      cover_image_url: null,
      published_at: "2026-01-02T00:00:00Z",
      post_format: "standard",
      author_id: "a2",
    },
  ];

  it("renders fetched posts across grid/list/numbered variants", async () => {
    for (const variant of ["card", "list", "numbered"]) {
      db.tables.posts = posts;
      const view = wrap(<PostListView c={{ variant, limit: 6, columns: 3 }} lang="pl" />);
      expect((await screen.findAllByText("Pierwszy wpis")).length).toBeGreaterThan(0);
      view.unmount();
    }
  });

  it("renders as a carousel", async () => {
    db.tables.posts = posts;
    wrap(<PostListView c={{ limit: 8 }} lang="pl" carousel />);
    expect((await screen.findAllByText("Pierwszy wpis")).length).toBeGreaterThan(0);
  });
});

describe("CategoriesView / TagsView", () => {
  it("renders category chips from live data", async () => {
    db.tables.categories = [
      { id: "c1", slug: "analizy", name_pl: "Analizy", name_en: "Analyses" },
      { id: "c2", slug: "wywiady", name_pl: "Wywiady", name_en: "Interviews" },
    ];
    wrap(<CategoriesView lang="pl" />);
    expect(await screen.findByText("Analizy")).toBeTruthy();
    expect(screen.getByText("Wywiady")).toBeTruthy();
  });

  it("renders tag chips from live data", async () => {
    db.tables.tags = [{ id: "t1", slug: "ue", name: "UE" }];
    wrap(<TagsView />);
    expect(await screen.findByText(/UE/)).toBeTruthy();
  });

  it("renders category chips in English", async () => {
    db.tables.categories = [{ id: "c1", slug: "ue", name_pl: "UE", name_en: "EU" }];
    wrap(<CategoriesView lang="en" />);
    expect(await screen.findByText("EU")).toBeTruthy();
  });
});

describe("NewsTickerView extra branches", () => {
  it("pauses on hover and uses a custom separator", async () => {
    db.tables.posts = [{ id: "1", slug: "a", title_pl: "Alfa", title_en: "Alpha" }];
    const { container } = wrap(
      <NewsTickerView c={{ separator: "—", pauseOnHover: true, speedSeconds: 30 }} lang="pl" />,
    );
    await screen.findAllByText("Alfa");
    const track = container.querySelector(".w-max") as HTMLElement;
    fireEvent.mouseEnter(track);
    fireEvent.mouseLeave(track);
    expect(track).toBeTruthy();
  });

  it("filters by category slugs", async () => {
    db.tables.categories = [{ id: "c1" }];
    db.tables.post_categories = [{ post_id: "1" }];
    db.tables.posts = [{ id: "1", slug: "a", title_pl: "Alfa", title_en: "Alpha" }];
    wrap(<NewsTickerView c={{ categoriesCsv: "ue", uniqueOnPage: true }} lang="en" />);
    expect((await screen.findAllByText("Alpha")).length).toBeGreaterThan(0);
  });
});

describe("TabsBlock + Podcast + WebStories extra branches", () => {
  it("TabsBlock falls back to PL label/html in EN", () => {
    wrap(
      <TabsBlock tabs={[{ label_pl: "PLtab", html_pl: "<p>PLtreść</p>" }]} lang="en" nodeId="n" />,
    );
    expect(screen.getByText("PLtab")).toBeTruthy();
    expect(screen.getByText("PLtreść")).toBeTruthy();
  });

  it("Podcast renders in EN with the player and a label-less episode", async () => {
    podcasts.list = [
      {
        id: "p1",
        slug: "s1",
        title_pl: "T1",
        title_en: "E1",
        excerpt_pl: "",
        excerpt_en: "Ex",
        cover_image_url: "",
        audio_url: "https://x/a.mp3",
        duration_seconds: 90,
        season: null,
        episode_number: null,
      },
    ];
    wrap(<PodcastLatestView c={{ variant: "grid", showPlayer: "true" }} lang="en" />);
    expect(await screen.findByText("E1")).toBeTruthy();
    expect(screen.getByTestId("podcast-player")).toBeTruthy();
  });

  it("WebStories opens a story viewer on click", async () => {
    stories.list = [
      {
        id: "s1",
        slug: "story",
        title_pl: "H1",
        title_en: "S1",
        cover_url: "https://x/c.jpg",
        pages: [{ id: "pg1" }],
      },
    ];
    wrap(<WebStoriesCarouselView c={{ variant: "grid" }} lang="en" />);
    const btn = await screen.findByLabelText("S1");
    fireEvent.click(btn);
    expect(screen.getByTestId("story-viewer")).toBeTruthy();
  });
});
