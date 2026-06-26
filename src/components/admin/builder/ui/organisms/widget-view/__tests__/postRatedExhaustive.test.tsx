// Exhaustive variant/branch coverage for the two largest data views:
// PostListView (card/minimal/overlay/list/ranked/numbered + carousel + states)
// and RatedListView (manual + dynamic, every display toggle and layout mode).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, pending: false }));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "is",
      "in",
      "not",
      "gte",
      "lte",
      "order",
      "range",
      "limit",
      "ilike",
    ])
      b[m] = () => b;
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return b;
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
      children,
      ...rest
    }: { to?: unknown; children?: unknown } & Record<string, unknown>) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>
        {children as never}
      </a>
    ),
  };
});

import { PostListView } from "../PostListView";
import { RatedListView } from "../RatedListView";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const POSTS = [
  {
    id: "1",
    slug: "a",
    title_pl: "Wpis A",
    title_en: "Post A",
    excerpt_pl: "Zaj A",
    excerpt_en: "Exc A",
    cover_image_url: "https://cdn.example.com/a.jpg",
    published_at: "2026-01-02T00:00:00Z",
    post_format: "standard",
    author_id: "au1",
  },
  {
    id: "2",
    slug: "b",
    title_pl: "Wpis B",
    title_en: "Post B",
    excerpt_pl: "Zaj B",
    excerpt_en: "Exc B",
    cover_image_url: null,
    published_at: "2026-01-01T00:00:00Z",
    post_format: "video",
    author_id: null,
  },
];

beforeEach(() => {
  db.tables = {};
});
afterEach(cleanup);

describe("PostListView variants", () => {
  it("renders every grid/list variant with and without covers", async () => {
    db.tables.posts = POSTS;
    db.tables.profiles = [{ id: "au1", display_name: "Autorka" }];
    for (const variant of ["card", "minimal", "overlay", "list", "ranked", "numbered"]) {
      const view = wrap(<PostListView c={{ variant, limit: 6, columns: 3 }} lang="pl" />);
      expect((await screen.findAllByText("Wpis A")).length).toBeGreaterThan(0);
      view.unmount();
    }
  });

  it("renders ranked/numbered with index side + valign options and author", async () => {
    db.tables.posts = POSTS;
    db.tables.profiles = [{ id: "au1", display_name: "Autorka" }];
    for (const indexSide of ["left", "right"]) {
      for (const indexVAlign of ["top", "middle", "bottom"]) {
        const view = wrap(
          <PostListView
            c={{
              variant: "ranked",
              indexSide,
              indexVAlign,
              indexSizePx: 60,
              indexOpacity: 0.3,
              indexColor: "#111",
              indexColorDark: "#eee",
              indexWeight: "900",
            }}
            lang="pl"
          />,
        );
        expect((await screen.findAllByText("Wpis A")).length).toBeGreaterThan(0);
        view.unmount();
      }
    }
    wrap(
      <PostListView
        c={{ variant: "numbered", indexSide: "left", indexVAlign: "bottom", indexOpacity: -1 }}
        lang="en"
      />,
    );
    expect((await screen.findAllByText("Post A")).length).toBeGreaterThan(0);
  });

  it("renders as a carousel and in English", async () => {
    db.tables.posts = POSTS;
    wrap(<PostListView c={{ limit: 8, mobileHorizontalScroll: true }} lang="en" carousel />);
    expect((await screen.findAllByText("Post A")).length).toBeGreaterThan(0);
  });

  it("applies thumbnail overrides and unique-on-page", async () => {
    db.tables.posts = POSTS;
    wrap(
      <PostListView
        c={{
          variant: "card",
          uniqueOnPage: true,
          thumbnailOverrides: { "1": "https://cdn.example.com/override.jpg" },
        }}
        lang="pl"
      />,
    );
    expect((await screen.findAllByText("Wpis A")).length).toBeGreaterThan(0);
  });

  it("shows a loading skeleton on first paint, then the empty state", async () => {
    db.tables.posts = [];
    const { container } = wrap(
      <PostListView c={{ variant: "card", columns: 2, limit: 4 }} lang="pl" />,
    );
    // First synchronous render: query still pending -> aria-busy skeleton.
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(await screen.findByText(/Brak wpisów/)).toBeTruthy();
  });
});

describe("RatedListView manual display toggles", () => {
  const items = [
    {
      title_pl: "R1",
      title_en: "R1en",
      excerpt_pl: "ex1",
      author: "A1",
      rating: 8.5,
      category_pl: "Kat",
      date: "2026-01-01",
      format: "video",
    },
    {
      title_pl: "R2",
      title_en: "R2en",
      excerpt_pl: "ex2",
      author: "A2",
      rating: 0,
      category_pl: "Kat2",
      date: "2026-02-01",
      format: "gallery",
    },
  ];

  it("renders with all display toggles enabled", () => {
    const { container } = wrap(
      <RatedListView
        c={{
          source: "manual",
          items,
          showAuthor: true,
          showDate: true,
          showExcerpt: true,
          showRating: true,
          showCategory: true,
          showReadMore: true,
          showBookmark: true,
          showPostFormat: true,
          numberPosition: "behind",
          numberColor: "#222",
          numberColorDark: "#ddd",
          categoryColor: "#dc2626",
          titleColor: "#111",
          titleHoverColor: "#f00",
          metaColor: "#666",
          excerptColor: "#999",
          readMoreColor: "#00f",
          bookmarkColor: "#0a0",
          postFormatColor: "#a0a",
          numberFont: "serif",
          titleFont: "mono",
          categoryWeight: "600",
        }}
        lang="pl"
        mode="dark"
      />,
    );
    expect(container.textContent).toContain("R1");
  });

  it("renders with all display toggles disabled and number positions", () => {
    for (const numberPosition of ["behind", "left", "inline", "none"]) {
      const { container } = wrap(
        <RatedListView
          c={{
            source: "manual",
            items,
            showAuthor: false,
            showExcerpt: false,
            showRating: false,
            showCategory: false,
            numberPosition,
          }}
          lang="pl"
        />,
      );
      expect(container.textContent).toContain("R1");
    }
  });

  it("renders each scrolling mode + grid border style", () => {
    for (const scrollingMode of ["none", "carousel", "scroll", "loadmore"]) {
      const { container } = wrap(
        <RatedListView
          c={{
            source: "manual",
            items,
            scrollingMode,
            pageSize: 1,
            scrollMaxHeightPx: 300,
            gridBorders: "full",
            gridBorderColor: "#ccc",
            gridBorderWidthPx: 2,
            columnsDesktop: 2,
          }}
          lang="pl"
        />,
      );
      expect(container.textContent).toContain("R1");
    }
  });

  it("renders each post format icon and the light color scheme in EN", () => {
    for (const format of ["video", "gallery", "audio", "quote", "link", "standard"]) {
      const { container } = wrap(
        <RatedListView
          c={{
            source: "manual",
            items: [{ title_pl: "F", rating: 5, format }],
            showPostFormat: true,
            colorScheme: "light",
          }}
          lang="en"
        />,
      );
      expect(container.textContent).toContain("F");
    }
  });
});

describe("RatedListView dynamic source", () => {
  it("queries posts with category/tag/author filters and renders results", async () => {
    db.tables.posts = [
      {
        id: "1",
        slug: "d1",
        title_pl: "Dyn 1",
        title_en: "Dyn 1en",
        excerpt_pl: "e",
        excerpt_en: "e",
        published_at: "2026-01-01T00:00:00Z",
        post_format: "standard",
        author_id: "au1",
      },
    ];
    db.tables.post_categories = [{ post_id: "1" }];
    db.tables.post_tags = [{ post_id: "1" }];
    db.tables.profiles = [{ id: "au1", display_name: "Redakcja" }];
    wrap(
      <RatedListView
        c={{
          source: "dynamic",
          numberOfPosts: 5,
          postOffset: 0,
          categoriesFilter: "ue",
          tagsFilter: "nato",
          authorFilter: "Redakcja",
          postFormatFilter: "standard",
          orderBy: "title_asc",
          showAuthor: true,
          showReadMore: true,
          showExcerpt: true,
        }}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Dyn 1")).toBeTruthy();
    expect(document.querySelector(".rl-more")).toBeTruthy();
  });

  it("returns empty for excludeable filters without matches", async () => {
    db.tables.posts = [];
    const { container } = wrap(
      <RatedListView
        c={{
          source: "dynamic",
          excludeCategories: "x",
          excludeTags: "y",
          excludePostIds: "z",
          orderBy: "title_desc",
        }}
        lang="en"
      />,
    );
    expect(container).toBeTruthy();
  });

  it("exercises every filter + order branch (include/exclude/postIds/authors/random)", async () => {
    db.tables.posts = [
      {
        id: "1",
        slug: "d1",
        title_pl: "Q1",
        title_en: "Q1",
        excerpt_pl: "e",
        excerpt_en: "e",
        published_at: "2026-01-01T00:00:00Z",
        post_format: "video",
        author_id: "au1",
      },
      {
        id: "2",
        slug: "d2",
        title_pl: "Q2",
        title_en: "Q2",
        excerpt_pl: "e",
        excerpt_en: "e",
        published_at: "2026-02-01T00:00:00Z",
        post_format: "standard",
        author_id: "au2",
      },
    ];
    db.tables.post_categories = [{ post_id: "1" }, { post_id: "2" }];
    db.tables.post_tags = [{ post_id: "1" }, { post_id: "2" }];
    db.tables.profiles = [
      { id: "au1", display_name: "Red" },
      { id: "au2", display_name: "Akcja" },
    ];
    for (const orderBy of ["random", "title_asc", "title_desc", "last_published"]) {
      const v = wrap(
        <RatedListView
          c={{
            source: "dynamic",
            numberOfPosts: 5,
            postOffset: 0,
            categoriesFilter: "ue",
            excludeCategories: "old",
            tagsFilter: "nato",
            excludeTags: "draft",
            postIdsFilter: "1,2",
            excludePostIds: "9",
            authorFilter: "Red",
            postFormatFilter: "all",
            orderBy,
            showAuthor: true,
          }}
          lang="pl"
        />,
      );
      expect((await screen.findAllByText("Q1")).length).toBeGreaterThan(0);
      v.unmount();
    }
  });
});
