// "Set everything" renders: passing every option at a non-default value covers
// the `getStr(c,key) || default` / `typeof c.x === "number"` left-hand arms that
// the defaults-driven tests leave uncovered. Paired with the existing
// defaults tests, both sides of each option branch are then exercised.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const mk = (table: string) => {
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
    b.then = (r: (v: unknown) => unknown) => r({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return { supabase: { from: (t: string) => mk(t), rpc: async () => ({ data: [], error: null }) } };
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

import { RatedListView } from "../RatedListView";
import { PostListView } from "../PostListView";
import { NewsTickerView } from "../NewsTickerView";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
beforeEach(() => {
  db.tables = {};
});
afterEach(cleanup);

describe("RatedListView with every option set", () => {
  const items = [
    {
      title_pl: "M1",
      title_en: "M1e",
      excerpt_pl: "ex1",
      author: "A1",
      rating: 9,
      category_pl: "Cat",
      date: "2026-01-01",
      format: "video",
    },
    {
      title_pl: "M2",
      title_en: "M2e",
      excerpt_pl: "ex2",
      author: "A2",
      rating: 3,
      category_pl: "Cat2",
      date: "2026-02-01",
      format: "audio",
    },
  ];
  const everyOption = {
    source: "manual",
    items,
    numberFont: "serif",
    numberWeight: "600",
    numberSizePx: 40,
    numberColor: "#101010",
    numberColorDark: "#f0f0f0",
    numberOpacity: 0.4,
    numberPosition: "left",
    showRating: true,
    showCategory: true,
    categoryColor: "#dc2626",
    categoryColorDark: "#f87171",
    categorySizePx: 12,
    categoryWeight: "700",
    categoryUppercase: false,
    titleColor: "#222",
    titleColorDark: "#ddd",
    titleHoverColor: "#f00",
    titleSizePx: 20,
    titleWeight: "800",
    titleFont: "mono",
    showAuthor: true,
    showDate: true,
    metaColor: "#666",
    metaColorDark: "#aaa",
    metaSizePx: 13,
    showExcerpt: true,
    excerptColor: "#999",
    excerptColorDark: "#ccc",
    excerptSizePx: 14,
    excerptLines: 2,
    showReadMore: true,
    readMoreText_pl: "Dalej",
    readMoreColor: "#00f",
    readMoreColorDark: "#88f",
    showBookmark: true,
    bookmarkColor: "#0a0",
    bookmarkColorDark: "#6f6",
    bookmarkSizePx: 18,
    showPostFormat: true,
    postFormatColor: "#a0a",
    postFormatColorDark: "#d8d",
    colorScheme: "dark",
    columnsDesktop: 2,
    columnsTablet: 2,
    columnsMobile: 1,
    columnGapPx: 16,
    rowGapPx: 20,
    gridBorders: "between",
    gridBorderColor: "#ccc",
    gridBorderWidthPx: 2,
    itemSpacingPx: 18,
    itemPaddingPx: 10,
    scrollingMode: "scroll",
    scrollMaxHeightPx: 350,
    pageSize: 1,
  };
  it("renders without throwing and shows items", () => {
    const { container } = wrap(<RatedListView c={everyOption} lang="pl" mode="dark" />);
    expect(container.textContent).toContain("M1");
  });
  it("renders the same options in light scheme + EN", () => {
    const { container } = wrap(
      <RatedListView
        c={{ ...everyOption, colorScheme: "light", numberPosition: "top" }}
        lang="en"
        mode="light"
      />,
    );
    expect(container.textContent).toContain("M1e");
  });
});

describe("PostListView ranked/numbered with every index option set", () => {
  const posts = [
    {
      id: "1",
      slug: "a",
      title_pl: "PA",
      title_en: "PAe",
      excerpt_pl: "e",
      excerpt_en: "ee",
      cover_image_url: "https://cdn.example.com/a.jpg",
      published_at: "2026-01-01T00:00:00Z",
      post_format: "standard",
      author_id: "u1",
    },
  ];
  it("renders ranked + numbered with full index styling", async () => {
    db.tables.posts = posts;
    db.tables.profiles = [{ id: "u1", display_name: "Aut" }];
    for (const variant of ["ranked", "numbered"]) {
      for (const indexVAlign of ["middle", "bottom", "top"]) {
        const v = wrap(
          <PostListView
            c={{
              variant,
              indexSizePx: 64,
              indexColor: "#111",
              indexColorDark: "#eee",
              indexOpacity: 0.5,
              indexWeight: "900",
              indexSide: "left",
              indexVAlign,
              imageAspect: "1/1",
              titleWeight: "700",
              excerptWeight: "400",
            }}
            lang="pl"
          />,
        );
        expect((await screen.findAllByText("PA")).length).toBeGreaterThan(0);
        v.unmount();
      }
    }
  });

  it("renders ranked with default index opacity (token) and right side", async () => {
    db.tables.posts = posts;
    db.tables.profiles = [{ id: "u1", display_name: "Aut" }];
    wrap(
      <PostListView
        c={{ variant: "numbered", indexOpacity: -1, indexSide: "right", imageAspect: "3/4" }}
        lang="en"
      />,
    );
    expect((await screen.findAllByText("PAe")).length).toBeGreaterThan(0);
  });
});

describe("NewsTickerView with options + hover toggles off", () => {
  it("renders with pauseOnHover off and a numeric speed", async () => {
    db.tables.posts = [
      { id: "1", slug: "a", title_pl: "Ta", title_en: "Tae" },
      { id: "2", slug: "b", title_pl: "Tb", title_en: "Tbe" },
    ];
    const { container } = wrap(
      <NewsTickerView
        c={{
          badge_pl: "B",
          badge_en: "Be",
          limit: 5,
          speedSeconds: 25,
          pauseOnHover: false,
          separator: "•",
          uniqueOnPage: false,
        }}
        lang="en"
      />,
    );
    const track = (await screen.findAllByText("Tae"))[0];
    const animated = container.querySelector(".w-max") as HTMLElement;
    fireEvent.mouseEnter(animated);
    fireEvent.mouseLeave(animated);
    expect(track).toBeTruthy();
  });
});
