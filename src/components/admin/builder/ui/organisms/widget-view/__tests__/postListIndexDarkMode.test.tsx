// Regression tests: dark-mode color of the big post-list index numeral.
//
// Guards two independent contracts that together decide the numeral's color:
//
// 1. Runtime (React): PostListView must emit inline CSS custom properties
//    (`--pl-num-light`, `--pl-num-dark`, `--pl-num-opacity`) on the wrapper
//    of BOTH `numbered` and `ranked` variants, sourced from CMS fields
//    `indexColor` / `indexColorDark` / `indexOpacity`. Without them the
//    fallback to Theme Design tokens (`--td-li-*`) never kicks in either.
//
// 2. Stylesheet (styles.css): the `.dark` override for
//    `.post-list-numbered-index` must have specificity greater than or equal
//    to the base rule (which uses the triple-class specificity hack). Prior
//    regression: `.dark .post-list-numbered-index` (2 classes) lost against
//    `.post-list-numbered-index.post-list-numbered-index.post-list-numbered-index`
//    (3 classes), so changing "Kolor (dark)" in the CMS had no effect at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const mk = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "in", "not", "gte", "lte", "order", "range", "limit", "ilike"]) {
      b[m] = () => b;
    }
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
    Link: ({ to, children, ...rest }: { to?: unknown; children?: unknown } & Record<string, unknown>) => (
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

const seedPosts = () => {
  db.tables.posts = [
    {
      id: "1",
      slug: "a",
      title_pl: "Tytul A",
      title_en: "Title A",
      cover_image_url: null,
      published_at: "2026-01-01T00:00:00Z",
      post_format: "standard",
      author_id: "u1",
    },
  ];
  db.tables.profiles = [{ id: "u1", display_name: "Autor" }];
};

beforeEach(() => {
  db.tables = {};
  seedPosts();
});
afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────
// (1) Runtime: CMS overrides land on inline CSS variables
// ─────────────────────────────────────────────────────────────────────────────
describe("PostListView index color - CMS overrides propagate to CSS variables", () => {
  const CMS = {
    indexColor: "#111111",
    indexColorDark: "#eeeeee",
    indexOpacity: 0.42,
    indexSizePx: 60,
    indexWeight: "900",
    indexSide: "right",
  } as const;

  const findWrapper = (num: HTMLElement) => {
    // The <span class="post-list-numbered-index"> sits inside the per-row
    // relative box, whose parent is the AppLink, whose parent is the flex
    // column that carries the inline CSS variables.
    const link = num.closest("a");
    expect(link).not.toBeNull();
    const w = link!.parentElement as HTMLElement | null;
    expect(w).not.toBeNull();
    return w!;
  };

  for (const variant of ["numbered", "ranked"] as const) {
    it(`${variant}: writes --pl-num-light / --pl-num-dark / --pl-num-opacity from CMS fields`, async () => {
      wrap(<PostListView c={{ variant, ...CMS }} lang="pl" />);
      const nums = await screen.findAllByText("01");
      const w = findWrapper(nums[0]);
      expect(w.style.getPropertyValue("--pl-num-light").trim()).toBe("#111111");
      expect(w.style.getPropertyValue("--pl-num-dark").trim()).toBe("#eeeeee");
      expect(w.style.getPropertyValue("--pl-num-opacity").trim()).toBe("0.42");
    });

    it(`${variant}: empty CMS color falls back to Theme Design token (--td-li-*)`, async () => {
      wrap(<PostListView c={{ variant, indexOpacity: -1 }} lang="pl" />);
      const nums = await screen.findAllByText("01");
      const w = findWrapper(nums[0]);
      // Fallback must be a CSS var(...) reference, NOT a hardcoded color -
      // otherwise Theme Design "Numeracja list" settings become dead controls.
      expect(w.style.getPropertyValue("--pl-num-light")).toMatch(/var\(--td-li-light/);
      expect(w.style.getPropertyValue("--pl-num-dark")).toMatch(/var\(--td-li-dark/);
      expect(w.style.getPropertyValue("--pl-num-opacity")).toMatch(/var\(--td-li-opacity/);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) Stylesheet: the `.dark` override wins over the base triple-class rule
// ─────────────────────────────────────────────────────────────────────────────
describe("styles.css - dark mode index color rule has adequate specificity", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  it("bumps `.dark .post-list-numbered-index` to match the base triple-class rule", () => {
    // The base rule intentionally triples the class name to raise specificity.
    // The dark override MUST triple it too, otherwise `--pl-num-dark` is set
    // but never read (regression: CMS "Kolor (dark)" had zero visible effect).
    const darkRule = /\.dark\s+\.post-list-numbered-index\.post-list-numbered-index\.post-list-numbered-index\s*\{[^}]*color\s*:\s*var\(--pl-num-dark\)/;
    expect(darkRule.test(css)).toBe(true);
  });

  it("still exposes the base light-mode rule using --pl-num-light", () => {
    const baseRule = /\.post-list-numbered-index\.post-list-numbered-index\.post-list-numbered-index\s*\{[^}]*color\s*:\s*var\(--pl-num-light\)/;
    expect(baseRule.test(css)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (3) RatedListView shares the SAME Theme Design fallback (`--td-li-*`)
// ─────────────────────────────────────────────────────────────────────────────
describe("RatedListView index color - fallback synced with PostListView", () => {
  it("emits a `color: var(--td-li-light, ...)` rule when no widget-level color is set", () => {
    const { container } = wrap(
      <RatedListView
        c={{
          source: "manual",
          items: [{ title_pl: "X", author: "A", rating: 5 }],
        }}
        lang="pl"
      />,
    );
    const css = Array.from(container.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    // Both light + dark rules must reference the shared Theme Design tokens,
    // otherwise "Numeracja list" in Theme Design silently stops governing
    // rated / ranked widgets and users have to touch every widget by hand.
    expect(css).toMatch(/\.rl-wrap \.rl-num\s*\{\s*color\s*:\s*var\(--td-li-light/);
    expect(css).toMatch(/\.dark \.rl-wrap \.rl-num\s*\{\s*color\s*:\s*var\(--td-li-dark/);
  });

  it("still honors explicit widget overrides (`numberColor` / `numberColorDark`)", () => {
    const { container } = wrap(
      <RatedListView
        c={{
          source: "manual",
          items: [{ title_pl: "X", author: "A", rating: 5 }],
          numberColor: "#123456",
          numberColorDark: "#abcdef",
        }}
        lang="pl"
      />,
    );
    const css = Array.from(container.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    expect(css).toContain(".rl-wrap .rl-num{color:#123456;}");
    expect(css).toContain(".dark .rl-wrap .rl-num{color:#abcdef;}");
  });
});
