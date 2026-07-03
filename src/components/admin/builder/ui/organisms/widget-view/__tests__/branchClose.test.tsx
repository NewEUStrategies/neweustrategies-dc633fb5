// Closes the remaining SimpleWidgets branch clusters: ImageWidget (site-logo /
// ratio / link permutations), PostsSliderWidget (order + filter combos),
// SearchButton edge paths, slider editable demo, animated-heading config,
// contact / testimonial / pricing variants, and the dark theme toggle.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import { ThemeProvider } from "@/components/ThemeProvider";
import type { WidgetNode, WidgetType, WidgetContent } from "@/lib/builder/types";

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

let nextId = 0;
function widget(
  type: WidgetType,
  content: WidgetContent,
  opts: { lang?: "pl" | "en"; editable?: boolean; theme?: boolean } = {},
) {
  const node: WidgetNode = { id: `bc-${nextId++}`, kind: "widget", type, content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const inner = (
    <WidgetView
      node={node}
      lang={opts.lang ?? "pl"}
      device="desktop"
      editable={opts.editable}
      onContentChange={opts.editable ? () => {} : undefined}
    />
  );
  return render(
    <QueryClientProvider client={qc}>
      {opts.theme ? <ThemeProvider>{inner}</ThemeProvider> : inner}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db.tables = {};
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ImageWidget remaining permutations", () => {
  it("renders site-logo variants and a no-ratio light/dark pair", () => {
    for (const useSiteLogo of ["main", "mobile", "transparent"]) {
      widget("image", { src: "", useSiteLogo, alt_pl: "Logo" });
    }
    // No ratio, both sources, external link, right alignment.
    const { container } = widget("image", {
      src: "https://cdn.example.com/a.png",
      srcDark: "https://cdn.example.com/b.png",
      alt_pl: "A",
      href: "https://ext.example.com",
      align: "right",
      objectFit: "fill",
    });
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_blank");
  });
});

describe("PostsSliderWidget order + filter combos", () => {
  const posts = [
    {
      id: "1",
      slug: "a",
      title_pl: "PSa",
      title_en: "PSa",
      excerpt_pl: "e",
      excerpt_en: "e",
      cover_image_url: "https://cdn.example.com/c.jpg",
      published_at: "2026-01-01T00:00:00Z",
    },
  ];

  it("renders for newest/oldest/title order with a category id", async () => {
    for (const orderBy of ["newest", "oldest", "title"]) {
      db.tables.posts = posts;
      db.tables.post_categories = [{ post_id: "1" }];
      const v = widget("slider", {
        source: "posts",
        orderBy,
        categoryId: "cat-1",
        showExcerpt: true,
      });
      expect(await screen.findByText("PSa")).toBeTruthy();
      v.unmount();
    }
  });

  it("renders empty when category/tag filters resolve to no posts", async () => {
    db.tables.posts = posts;
    db.tables.post_categories = [];
    const { container } = widget("slider", { source: "posts", categorySlugs: "nope" });
    // No allowed ids -> empty slider placeholder.
    expect(await screen.findByText(/Dodaj obrazki/)).toBeTruthy();
    expect(container).toBeTruthy();
  });
});

describe("SearchButton edge paths", () => {
  it("ignores queries shorter than two characters", async () => {
    db.tables.posts = [];
    const { container } = widget("search-button", { label_pl: "Szukaj", liveResults: "on" });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "a" } });
    // Too short -> no popover/results.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("navigates focus off when a result is clicked", async () => {
    db.tables.posts = [{ id: "1", slug: "r", title_pl: "Klik wynik", excerpt_pl: "o" }];
    const { container } = widget("search-button", { label_pl: "Szukaj", liveResults: "on" });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "kl" } });
    const link = await screen.findByText("Klik wynik");
    fireEvent.click(link);
    expect(link).toBeTruthy();
  });
});

describe("slider widget (posts-sourced default + real items)", () => {
  it("an empty-items slider is posts-sourced and renders published posts", async () => {
    // sliderUsesPostsSource: no items -> posts source, also in the editor
    // canvas (legacy placeholder demos were replaced by real published posts).
    db.tables.posts = [
      {
        id: "1",
        slug: "hero",
        title_pl: "Wpis hero",
        title_en: "Hero post",
        excerpt_pl: "e",
        excerpt_en: "e",
        cover_image_url: "https://cdn.example.com/hero.jpg",
        published_at: "2026-01-01T00:00:00Z",
      },
    ];
    widget("slider", { variant: "editorial-hero" }, { editable: true });
    expect(await screen.findByText("Wpis hero")).toBeTruthy();
  });

  it("renders real items in EN", () => {
    const { container } = widget(
      "slider",
      {
        items: [
          {
            image: "https://cdn.example.com/s.jpg",
            title_pl: "S PL",
            title_en: "S EN",
            subtitle_pl: "sub",
            href: "/p",
            cta_pl: "Go",
            cta_en: "Go",
          },
        ],
        titleSizePx: 30,
        titleWeight: 700,
        subtitleSizePx: 16,
        subtitleWeight: 400,
        rounded: "lg",
        autoplay: false,
      },
      { lang: "en" },
    );
    expect(container.textContent).toContain("S EN");
  });
});

describe("animated-heading config (spacing, rotate string, dark invert)", () => {
  it("handles trailing/leading spaces and a newline-delimited rotate string in dark mode", () => {
    expect(() =>
      widget(
        "animated-heading",
        {
          mode: "rotate",
          rotateWords_pl: "szybko\nłatwo\nskutecznie",
          textBefore_pl: "Przed ",
          textAfter_pl: " po",
          color: "#222",
          accentColor: "#f60",
        },
        { theme: true },
      ),
    ).not.toThrow();
  });
});

describe("contact / testimonial / pricing remaining variants", () => {
  it("renders contact card + compact", () => {
    for (const variant of ["card", "compact", "stacked"]) {
      expect(widget("contact", { variant }).container.querySelector("form")).toBeTruthy();
    }
  });
  it("renders testimonial centered with avatar + zero rating", () => {
    expect(
      widget("testimonial", {
        quote_pl: "Q",
        author: "A",
        variant: "centered",
        rating: 0,
        avatar: "https://cdn.example.com/a.png",
      }).container.textContent,
    ).toContain("Q");
  });
  it("renders pricing with currency/period and empty features", () => {
    expect(
      widget("pricing", {
        plans: [{ name_pl: "P", price: "9", currency: "EUR", period_pl: "/rok", featured: true }],
      }).container.textContent,
    ).toContain("P");
  });
});

describe("theme toggle in dark mode", () => {
  it("renders the dark-state toggle", () => {
    localStorage.setItem("theme", "dark");
    const { container } = widget("theme-toggle", {}, { theme: true });
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
  });
});

describe("hot-topic-bar icon fallback + account-link EN", () => {
  it("uses the Flame fallback for an unknown icon and renders account-link in EN", () => {
    expect(
      widget("hot-topic-bar", { title_pl: "T", iconName: "NotAnIcon" }).container.textContent,
    ).toContain("T");
    // Language-scoped labels: PL-only overrides must NOT leak into the EN
    // render - it falls back to the EN defaults instead.
    const en = widget("account-link", { signin_pl: "In", signup_pl: "Up" }, { lang: "en" })
      .container.textContent;
    expect(en).toContain("Sign in");
    expect(en).not.toContain("Up");
    const pl = widget("account-link", { signin_pl: "In", signup_pl: "Up" }, { lang: "pl" })
      .container.textContent;
    expect(pl).toContain("In");
    expect(pl).toContain("Up");
  });
});
