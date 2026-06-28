// Cross-widget guarantees for the typography mapping defined in
// `WidgetView.tsx`. The contract this test pins:
//
//   1. Typography size for title/description is ONE source of truth: the
//      widget's `style.typography.fontSize` / `descriptionFontSize`. There is
//      no per-widget "size" field for those any more.
//   2. When the user does NOT set a size, the renderer emits NO override for
//      `.cms-post-title` / `.cms-post-excerpt` - the public page inherits the
//      global Theme Design size.
//   3. When the user DOES set a size, the wrapper emits exactly one rule
//      per class, scoped to that widget's `[data-w-id]` selector with
//      `!important` so it wins over Theme Design defaults.
//   4. The exact same selectors are produced for every widget that renders
//      post-style titles/excerpts (slider, post-list, rated-list,
//      podcast-latest) so the mapping is uniform across widgets.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type { WidgetNode, WidgetType, CommonStyle } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
}));

const POST_WIDGETS: WidgetType[] = ["slider", "post-list", "rated-list", "podcast-latest"];

function widgetCss(type: WidgetType, style?: CommonStyle): string {
  const node: WidgetNode = {
    id: `tm-${type}`,
    kind: "widget",
    type,
    content: {},
    style,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" />
    </QueryClientProvider>,
  );
  const wrap = container.querySelector(`[data-w-id="${node.id}"]`);
  const style$ = wrap?.querySelector("style");
  return style$?.innerHTML ?? "";
}

function countMatches(haystack: string, needle: string): number {
  let i = 0;
  let n = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

afterEach(cleanup);

describe("typography mapping is single-sourced and uniform across widgets", () => {
  it("emits no .cms-post-title / .cms-post-excerpt overrides when the user sets nothing", () => {
    for (const type of POST_WIDGETS) {
      const css = widgetCss(type);
      expect(css, `${type} should not override post title size by default`).not.toMatch(
        /\.cms-post-title\s*\{[^}]*font-size/,
      );
      expect(css, `${type} should not override post excerpt size by default`).not.toMatch(
        /\.cms-post-excerpt\s*\{[^}]*font-size/,
      );
    }
  });

  it("title fontSize maps to exactly one scoped `.cms-post-title{font-size:..!important}` rule per widget", () => {
    for (const type of POST_WIDGETS) {
      const css = widgetCss(type, { typography: { fontSize: { desktop: "22px" } } });
      const scoped = `[data-w-id="tm-${type}"][data-w-id] .cms-post-title`;
      // Exactly one override of .cms-post-title font-size, scoped to this widget.
      expect(countMatches(css, scoped), `${type}: one .cms-post-title rule`).toBe(1);
      expect(css).toContain(`${scoped}{font-size:22px !important;}`);
      // No accidental excerpt override when only the title is configured.
      expect(css).not.toMatch(/\.cms-post-excerpt\s*\{[^}]*font-size/);
    }
  });

  it("description fontSize maps to exactly one scoped `.cms-post-excerpt{font-size:..!important}` rule per widget", () => {
    for (const type of POST_WIDGETS) {
      const css = widgetCss(type, {
        typography: { descriptionFontSize: { desktop: "13px" } },
      });
      const scoped = `[data-w-id="tm-${type}"][data-w-id] .cms-post-excerpt`;
      expect(countMatches(css, scoped), `${type}: one .cms-post-excerpt rule`).toBe(1);
      expect(css).toContain(`${scoped}{font-size:13px !important;}`);
    }
  });

  it("setting both sizes produces both overrides without duplicating either selector", () => {
    for (const type of POST_WIDGETS) {
      const css = widgetCss(type, {
        typography: {
          fontSize: { desktop: "22px" },
          descriptionFontSize: { desktop: "13px" },
        },
      });
      expect(countMatches(css, `[data-w-id="tm-${type}"][data-w-id] .cms-post-title`)).toBe(1);
      expect(countMatches(css, `[data-w-id="tm-${type}"][data-w-id] .cms-post-excerpt`)).toBe(1);
    }
  });

  it("renders identical title/excerpt CSS shape across all post-style widgets (modulo the widget id)", () => {
    const sample = (type: WidgetType) =>
      widgetCss(type, {
        typography: {
          fontSize: { desktop: "20px" },
          descriptionFontSize: { desktop: "14px" },
        },
      })
        .split("\n")
        .map((l) => l.replace(/\[data-w-id="tm-[^"]+"\](?:\[data-w-id\])?/g, "[W]"))
        .sort();

    const reference = sample(POST_WIDGETS[0]);
    // Sanity-check the reference shape contains the key mapping lines.
    expect(reference).toContain(`[W] .cms-post-title{font-size:20px !important;}`);
    expect(reference).toContain(`[W] .cms-post-excerpt{font-size:14px !important;}`);
    for (const type of POST_WIDGETS.slice(1)) {
      expect(sample(type), `${type} should generate the same shape as ${POST_WIDGETS[0]}`).toEqual(
        reference,
      );
    }
  });

  it("responsive device fallback: a tablet-only value cascades down to desktop", () => {
    // Mirrors `pickResponsiveValue` cascade (desktop ← tablet ← mobile).
    const css = widgetCss("slider", {
      typography: { fontSize: { tablet: "19px" } },
    });
    expect(css).toContain(`[data-w-id="tm-slider"][data-w-id] .cms-post-title{font-size:19px !important;}`);
  });
});
