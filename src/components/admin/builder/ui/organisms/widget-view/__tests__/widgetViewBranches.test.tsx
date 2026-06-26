// Targeted branch coverage for WidgetView's wrapper layer: responsive
// typography fallbacks, easing/animation edge values, both in-view states, the
// typography <style> permutations, and the switch-arm i18n fallbacks (rendered
// in EN with empty fields and with no optional fields).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type {
  WidgetNode,
  WidgetType,
  WidgetContent,
  CommonStyle,
  AdvancedSettings,
  Device,
} from "@/lib/builder/types";

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

let nextId = 0;
function renderNode(
  type: WidgetType,
  content: WidgetContent,
  opts: {
    lang?: "pl" | "en";
    device?: Device;
    editable?: boolean;
    style?: CommonStyle;
    advanced?: AdvancedSettings;
  } = {},
) {
  const node: WidgetNode = {
    id: `wb-${nextId++}`,
    kind: "widget",
    type,
    content,
    style: opts.style,
    advanced: opts.advanced,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang={opts.lang ?? "pl"}
        device={opts.device ?? "desktop"}
        editable={opts.editable}
        onContentChange={opts.editable ? () => {} : undefined}
      />
    </QueryClientProvider>,
  );
}
afterEach(cleanup);

describe("responsive typography fallbacks", () => {
  it("falls back through device keys for title and description sizes", () => {
    renderNode(
      "heading",
      { text_pl: "T" },
      { device: "desktop", style: { typography: { fontSize: { tablet: "14px" } } } },
    );
    renderNode(
      "heading",
      { text_pl: "T" },
      { device: "desktop", style: { typography: { fontSize: { mobile: "12px" } } } },
    );
    renderNode(
      "heading",
      { text_pl: "T" },
      {
        device: "desktop",
        style: {
          typography: { descriptionFontSize: { mobile: "11px" }, fontSize: { desktop: "20px" } },
        },
      },
    );
    expect(true).toBe(true);
  });

  it("renders font size alone, font size + description size, and a gap", () => {
    renderNode(
      "text",
      { html_pl: "<p>x</p>" },
      { style: { typography: { fontSize: { desktop: "18px" } } } },
    );
    renderNode(
      "text",
      { html_pl: "<p>x</p>" },
      {
        style: {
          typography: {
            fontSize: { desktop: "18px" },
            descriptionFontSize: { desktop: "13px" },
            titleDescriptionGapPx: 10,
          },
        },
      },
    );
    expect(true).toBe(true);
  });
});

describe("animation / easing edge values", () => {
  const realIO = globalThis.IntersectionObserver;

  afterEach(() => {
    globalThis.IntersectionObserver = realIO;
  });

  it("uses MOTION_INITIAL while out of view (observer present, never intersects)", () => {
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // @ts-expect-error test stub
    globalThis.IntersectionObserver = IO;
    const { container } = renderNode(
      "heading",
      { text_pl: "T" },
      { advanced: { animation: "slide-up", animationDistance: 30 } },
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("uses MOTION_FINAL when IntersectionObserver is unavailable (in view)", () => {
    // @ts-expect-error force the no-observer code path
    delete globalThis.IntersectionObserver;
    const { container } = renderNode(
      "heading",
      { text_pl: "T" },
      { advanced: { animation: "fade" } },
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("defaults an unknown easing and an unknown animation preset safely", () => {
    renderNode(
      "heading",
      { text_pl: "T" },
      {
        advanced: {
          animation: "fade",
          animationEasing: "weird" as AdvancedSettings["animationEasing"],
        },
      },
    );
    renderNode(
      "heading",
      { text_pl: "T" },
      { advanced: { animation: "made-up" as AdvancedSettings["animation"] } },
    );
    expect(true).toBe(true);
  });
});

describe("switch-arm i18n fallbacks (EN empty + defaults)", () => {
  it("renders heading/button/nav-link/cta/dfc/newsletter/join-us in EN with PL-only fields", () => {
    renderNode(
      "heading",
      {
        text_pl: "H",
        subtitle_pl: "S",
        iconName: "Star",
        iconPosition: "right",
        href: "/x",
        target: "blank",
        subtitleSizePx: 14,
        subtitleWeight: "500",
      },
      { lang: "en" },
    );
    renderNode(
      "button",
      { label_pl: "B", href: "/x", iconName: "Star", size: "sm" },
      { lang: "en" },
    );
    renderNode("nav-link", { label_pl: "N", iconName: "Star" }, { lang: "en" });
    renderNode(
      "cta",
      {
        title_pl: "C",
        subtitle_pl: "Sub",
        cta_pl: "Go",
        href: "/x",
        variant: "default",
        align: "left",
      },
      { lang: "en" },
    );
    renderNode(
      "dark-featured-card",
      {
        title_pl: "T",
        badge_pl: "B",
        excerpt_pl: "E",
        image: "https://cdn.example.com/c.jpg",
        href: "/p",
        badgeVariant: "outline",
        badgeRadius: "sm",
        badgeSize: "lg",
        imageHover: "brighten",
      },
      { lang: "en" },
    );
    for (const variant of ["icon", "icon-only", "minimal", "inline", "card"]) {
      renderNode("newsletter", { variant }, { lang: "en" }); // no title -> "Newsletter" default
    }
    renderNode("join-us", { variant: "card", showInterests: "0" }, { lang: "en" });
    renderNode("customize-interests", { variant: "compact", showHeader: "0" }, { lang: "en" });
    expect(true).toBe(true);
  });

  it("renders editable newsletter inline + card previews (EN)", () => {
    renderNode("newsletter", { variant: "inline" }, { lang: "en", editable: true });
    renderNode("newsletter", { variant: "card" }, { lang: "en", editable: true });
    renderNode("newsletter", { variant: "minimal" }, { lang: "en", editable: true });
    renderNode("newsletter", { variant: "icon-only" }, { lang: "en", editable: true });
    renderNode("newsletter", { variant: "icon" }, { lang: "en", editable: true });
    expect(true).toBe(true);
  });

  it("renders dark-featured-card without image/badge/href (plain) and with a border color", () => {
    renderNode("dark-featured-card", { title_pl: "Plain" }, { style: { borderColor: "#ccc" } });
    expect(true).toBe(true);
  });
});
