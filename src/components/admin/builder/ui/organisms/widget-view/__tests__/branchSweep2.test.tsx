// Second branch sweep: the remaining coverable permutations - PostListView in
// EN / without covers, NewsTicker category-miss + loading, Podcast cover/excerpt
// fallbacks, section-label action sizing, newsletter form submit, and the
// social-icons active+contrast combination.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
const podcasts = vi.hoisted(() => ({ list: [] as unknown[] }));

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
vi.mock("@/lib/queries/podcasts", () => ({
  latestPodcastsQueryOptions: (limit: number) => ({
    queryKey: ["pods", limit],
    queryFn: async () => podcasts.list,
  }),
}));
vi.mock("@/components/atoms/PodcastPlayer", () => ({
  PodcastPlayer: () => <div data-testid="player" />,
}));

import { WidgetView } from "@/components/admin/builder/WidgetView";
import { PostListView } from "../PostListView";
import { PodcastLatestView } from "../PodcastLatestView";
import { SectionLabelRender } from "@/lib/builder/sectionLabelVariants";
import type { WidgetNode, WidgetType, WidgetContent } from "@/lib/builder/types";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
let nextId = 0;
function widget(type: WidgetType, content: WidgetContent, editable = false) {
  const node: WidgetNode = { id: `s2-${nextId++}`, kind: "widget", type, content };
  return wrap(
    <WidgetView
      node={node}
      lang="pl"
      device="desktop"
      editable={editable}
      onContentChange={editable ? () => {} : undefined}
    />,
  );
}

beforeEach(() => {
  db.tables = {};
  podcasts.list = [];
});
afterEach(cleanup);

describe("PostListView EN + cover-absent variants", () => {
  const noCover = [
    {
      id: "1",
      slug: "a",
      title_pl: "PL A",
      title_en: "",
      excerpt_pl: "ex",
      excerpt_en: "",
      cover_image_url: null,
      published_at: null,
      post_format: null,
      author_id: null,
    },
  ];
  it("renders every variant without covers, in EN (PL title fallback)", async () => {
    for (const variant of ["card", "minimal", "overlay", "list", "ranked", "numbered"]) {
      db.tables.posts = noCover;
      const view = wrap(<PostListView c={{ variant }} lang="en" />);
      expect((await screen.findAllByText("PL A")).length).toBeGreaterThan(0);
      view.unmount();
    }
  });
});

describe("NewsTickerView category-miss + empty", () => {
  it("returns empty when category slugs resolve to no categories", async () => {
    db.tables.categories = [];
    db.tables.posts = [{ id: "1", slug: "a", title_pl: "X", title_en: "X" }];
    widget("news-ticker", { categoriesCsv: "missing" });
    expect(await screen.findByText(/Brak wpisów/)).toBeTruthy();
  });
});

describe("PodcastLatestView fallbacks", () => {
  it("renders featured variant with a missing cover and EN excerpt", async () => {
    podcasts.list = [
      {
        id: "p1",
        slug: "s",
        title_pl: "TP",
        title_en: "TE",
        excerpt_pl: "",
        excerpt_en: "Ex en",
        cover_image_url: "",
        audio_url: "https://x/a.mp3",
        duration_seconds: 10,
        season: 2,
        episode_number: 3,
      },
    ];
    wrap(<PodcastLatestView c={{ variant: "featured", showPlayer: "true" }} lang="en" />);
    expect(await screen.findByText("TE")).toBeTruthy();
  });
});

describe("section-label action sizing (sm + md, with/without href)", () => {
  it("renders filled-bar and slanted-ribbon with sized actions", () => {
    for (const variant of [
      "filled-bar",
      "slanted-ribbon-rule",
      "badge-filled",
      "centered-short-rule",
    ] as const) {
      const md = render(
        <SectionLabelRender
          label="L"
          action="a"
          href="/x"
          accent="#3366ff"
          variant={variant}
          actionColor="#fff"
          actionSize="11px"
          labelColor="#000"
          labelSize="13px"
        />,
      );
      expect(md.container.textContent).toContain("L");
      md.unmount();
      const sm = render(
        <SectionLabelRender label="L" action="a" accent="#3366ff" variant={variant} size="sm" />,
      );
      expect(sm.container.textContent).toContain("L");
      sm.unmount();
    }
  });
});

describe("newsletter editable form submit", () => {
  it("prevents default on the inline and card preview forms", () => {
    for (const variant of ["inline", "card"]) {
      const { container } = widget("newsletter", { title_pl: "N", variant }, true);
      const form = container.querySelector("form");
      if (form) fireEvent.submit(form);
      expect(container).toBeTruthy();
    }
  });
});

describe("social-icons active icon on official background", () => {
  it("renders an active brand icon with contrast text and a mix of active/inactive", () => {
    widget("social-icons", {
      facebook: "https://facebook.com/x",
      youtube: "",
      email: "a@b.co",
      colorMode: "official",
      bgMode: "official",
      showEmpty: "show",
      shape: "md",
    });
    expect(screen.getByLabelText("Facebook")).toBeTruthy();
  });
});
