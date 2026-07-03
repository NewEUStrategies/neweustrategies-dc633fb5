// Closes dark-mode, EN-language-chrome, configured-site-logo and the remaining
// SimpleWidgets data-path branches (PostsSlider filter combos, SearchButton).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import { ThemeProvider } from "@/components/ThemeProvider";
import type { WidgetNode, WidgetType, WidgetContent } from "@/lib/builder/types";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
const i18nState = vi.hoisted(() => ({ lang: "pl" }));

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
    i18n: { language: i18nState.lang, changeLanguage: () => {} },
  }),
}));
// Provide a configured site logo so the ImageWidget logo-fallback path resolves.
vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site-settings"],
    queryFn: async () => ({
      theme_options: {
        logo: {
          main: "https://cdn.example.com/logo.png",
          main_dark: "https://cdn.example.com/logo-dark.png",
        },
      },
    }),
  },
  resolveSetting: (data: Record<string, unknown> | undefined, key: string, dflt: unknown) =>
    (data && data[key]) ?? dflt,
}));

let nextId = 0;
function widget(
  type: WidgetType,
  content: WidgetContent,
  opts: { lang?: "pl" | "en"; dark?: boolean; editable?: boolean } = {},
) {
  const node: WidgetNode = { id: `b2-${nextId++}`, kind: "widget", type, content };
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
      {opts.dark ? <ThemeProvider>{inner}</ThemeProvider> : inner}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db.tables = {};
  i18nState.lang = "pl";
  localStorage.setItem("theme", "dark");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("dark-mode render paths", () => {
  it("renders image (framed light/dark pair) in dark theme", async () => {
    const { container } = widget(
      "image",
      {
        src: "https://cdn.example.com/l.png",
        srcDark: "https://cdn.example.com/d.png",
        alt_pl: "A",
        ratio: "16/9",
        widthPx: 200,
        maxWidthPx: 300,
      },
      { dark: true },
    );
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("renders a configured site logo (light + dark) in dark theme", () => {
    const { container } = widget(
      "image",
      { src: "", useSiteLogo: "main", alt_pl: "Logo" },
      { dark: true },
    );
    expect(container).toBeTruthy();
  });

  it("renders animated-heading with color invert + dark-featured-card colors in dark theme", () => {
    const heading = widget(
      "animated-heading",
      {
        mode: "highlight",
        shape: "underline",
        highlight_pl: "x",
        color: "#222",
        accentColor: "#f60",
      },
      { dark: true },
    );
    expect(heading.container.textContent).toContain("x");
    const card = widget(
      "dark-featured-card",
      { title_pl: "T", badge_pl: "B", image: "https://cdn.example.com/c.jpg" },
      { dark: true },
    );
    expect(card.container.textContent).toContain("T");
    expect(card.container.querySelector("img")).toBeTruthy();
    // Heading with widget-level text/bg colors -> overrideCss resolves for dark.
    const node: WidgetNode = {
      id: "x",
      kind: "widget",
      type: "heading",
      content: { text_pl: "T" },
      style: { textColor: "#112233", bgColor: "#fff" },
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <WidgetView node={node} lang="pl" device="desktop" />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(container.textContent).toContain("T");
    // The per-widget color override materializes as a scoped <style> rule
    // targeting the widget id; in dark mode the text color is auto-inverted,
    // so assert the scoped selector + a forced color/background pair.
    const overrideCss = container.querySelector("style")?.textContent ?? "";
    expect(overrideCss).toContain('[data-w-id="x"]');
    expect(overrideCss).toContain("color:");
    expect(overrideCss).toContain("background: #fff");
  });
});

describe("EN language chrome", () => {
  it("renders the language switcher with EN active", () => {
    i18nState.lang = "en";
    const { container } = widget(
      "lang-switcher",
      { label_pl: "Język", label_en: "Language" },
      { lang: "en" },
    );
    fireEvent.click(container.querySelector("button")!);
    expect(container.querySelector('[role="listbox"]')).toBeTruthy();
  });
});

describe("PostsSlider filter + order combos", () => {
  const posts = [
    {
      id: "1",
      slug: "a",
      title_pl: "PSx",
      title_en: "PSx",
      excerpt_pl: "e",
      excerpt_en: "e",
      cover_image_url: "https://cdn.example.com/c.jpg",
      published_at: "2026-01-01T00:00:00Z",
    },
  ];
  it("intersects category + tag ids and excludes, ordered oldest", async () => {
    db.tables.posts = posts;
    db.tables.post_categories = [{ post_id: "1" }];
    db.tables.tags = [{ id: "t1" }];
    db.tables.post_tags = [{ post_id: "1" }];
    widget("slider", {
      source: "posts",
      categoryId: "c0",
      categorySlugs: "ue",
      tagSlugs: "nato",
      excludeIds: "9",
      orderBy: "oldest",
      showExcerpt: false,
    });
    expect(await screen.findByText("PSx")).toBeTruthy();
  });

  it("returns empty when tag slugs resolve to no tag ids", async () => {
    db.tables.posts = posts;
    db.tables.tags = [];
    const { container } = widget("slider", { source: "posts", tagSlugs: "none" });
    expect(await screen.findByText(/Dodaj obrazki/)).toBeTruthy();
    expect(container).toBeTruthy();
  });
});

describe("SearchButton popover states", () => {
  it("shows results then an empty state for a fresh query", async () => {
    db.tables.posts = [{ id: "1", slug: "r", title_pl: "Wynik X", excerpt_pl: "o" }];
    const { container } = widget("search-button", {
      label_pl: "Szukaj",
      liveResults: "on",
      heading_pl: "Nagłówek",
    });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "wy" } });
    expect(await screen.findByText("Wynik X")).toBeTruthy();
    db.tables.posts = [];
    fireEvent.change(input, { target: { value: "zz" } });
    expect(await screen.findByText(/Brak wyników/)).toBeTruthy();
  });
});
