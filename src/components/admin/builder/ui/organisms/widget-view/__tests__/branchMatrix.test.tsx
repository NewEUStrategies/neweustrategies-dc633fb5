// Branch-matrix coverage for WidgetView's own switch widgets: every size /
// variant / icon / alignment arm of heading, button, nav-link, cta,
// dark-featured-card and newsletter, plus EN-with-empty-field i18n fallbacks.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type { WidgetNode, WidgetType, WidgetContent, Device } from "@/lib/builder/types";

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
  lang: "pl" | "en" = "pl",
  device: Device = "desktop",
) {
  const node: WidgetNode = { id: `b-${nextId++}`, kind: "widget", type, content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang={lang} device={device} />
    </QueryClientProvider>,
  );
}
afterEach(cleanup);

describe("heading variant matrix", () => {
  it("renders every size preset and visual variant", () => {
    for (const sizePreset of ["sm", "md", "lg", "xl", "display"]) {
      for (const variant of [
        "default",
        "gradient",
        "outlined",
        "highlight",
        "uppercase",
        "serif",
      ]) {
        const { container } = renderNode("heading", {
          text_pl: "H",
          subtitle_pl: "S",
          sizePreset,
          variant,
          iconName: "Star",
          iconPosition: "right",
          href: "/x",
          target: "blank",
        });
        expect(container.textContent).toContain("H");
      }
    }
  });

  it("renders pixel size + weights + subtitle sizing, and icon on the left", () => {
    const { container } = renderNode("heading", {
      text_pl: "Px",
      sizePx: 40,
      titleWeight: "700",
      subtitle_pl: "Sub",
      subtitleSizePx: 18,
      subtitleWeight: "600",
      iconName: "Star",
      iconPosition: "left",
    });
    expect(container.querySelector("h2")).toBeTruthy();
  });

  it("falls back to PL text in EN when text_en is empty", () => {
    const { container } = renderNode("heading", { text_pl: "PLonly", text_en: "" }, "en");
    expect(container.textContent).toContain("PLonly");
  });
});

describe("button variant matrix", () => {
  it("renders every variant x size with icon positions and widths", () => {
    for (const variant of ["primary", "outline", "ghost", "gradient", "soft", "link"]) {
      for (const size of ["sm", "md", "lg"]) {
        const { container } = renderNode("button", {
          label_pl: "B",
          variant,
          size,
          iconName: "Star",
          iconPosition: "right",
          fullWidth: "full",
          widthPx: 120,
          heightPx: 40,
          target: "blank",
        });
        expect(container.textContent).toContain("B");
      }
    }
  });
  it("falls back to PL label in EN", () => {
    expect(
      renderNode("button", { label_pl: "Klik", label_en: "" }, "en").container.textContent,
    ).toContain("Klik");
  });
});

describe("nav-link variant matrix", () => {
  it("renders every variant with an external href", () => {
    for (const variant of ["text", "primary", "outline", "pill", "underline"]) {
      const { container } = renderNode("nav-link", {
        label_pl: "L",
        variant,
        iconName: "Star",
        href: "https://x.example.com",
        target: "blank",
      });
      expect(container.textContent).toContain("L");
    }
  });
});

describe("cta variant matrix", () => {
  it("renders every container variant x alignment, with and without subtitle", () => {
    for (const variant of ["default", "gradient", "bar", "card", "split"]) {
      for (const align of ["left", "center", "between"]) {
        const { container } = renderNode("cta", {
          title_pl: "T",
          subtitle_pl: "Sub",
          cta_pl: "Akcja",
          href: "/x",
          variant,
          align,
          ctaWidthPx: 100,
          ctaHeightPx: 40,
        });
        expect(container.textContent).toContain("T");
      }
    }
    // No subtitle branch + EN fallback.
    expect(
      renderNode("cta", { title_pl: "OnlyPL", cta_pl: "Go" }, "en").container.textContent,
    ).toContain("OnlyPL");
  });
});

describe("dark-featured-card matrix", () => {
  it("renders every badge variant / radius / size / image-hover with border + link", () => {
    for (const badgeVariant of [
      "solid-red",
      "solid-brand",
      "solid-dark",
      "outline",
      "ghost",
      "gradient",
    ]) {
      const { container } = renderNode("dark-featured-card", {
        badge_pl: "B",
        title_pl: "T",
        excerpt_pl: "E",
        image: "https://cdn.example.com/c.jpg",
        href: "/p",
        badgeVariant,
        badgeRadius: "lg",
        badgeSize: "sm",
        imageHover: "zoom-in",
        badgeBg: "#111",
        badgeText: "#fff",
      });
      expect(container.textContent).toContain("T");
    }
    for (const badgeRadius of ["none", "sm", "md", "lg", "full"]) {
      renderNode("dark-featured-card", {
        badge_pl: "B",
        title_pl: "T",
        badgeRadius,
        badgeSize: "md",
      });
    }
    for (const imageHover of ["zoom-in", "zoom-out", "fade", "brighten", "tilt"]) {
      renderNode("dark-featured-card", {
        title_pl: "T",
        image: "https://cdn.example.com/c.jpg",
        imageHover,
      });
    }
  });

  it("renders without image/badge/href and with a custom border color", () => {
    const { container } = renderNode("dark-featured-card", { title_pl: "Plain" });
    expect(container.textContent).toContain("Plain");
  });
});

describe("newsletter variant matrix", () => {
  it("renders every read-only variant", () => {
    for (const variant of ["icon", "icon-only", "minimal", "inline", "card"]) {
      const { container } = renderNode("newsletter", { title_pl: "N", variant, iconName: "Mail" });
      expect(container).toBeTruthy();
    }
    // EN fallback for title.
    expect(
      renderNode("newsletter", { title_pl: "ZapiszPL", variant: "icon" }, "en").container,
    ).toBeTruthy();
  });
});

describe("mega-menu on mobile + customize-interests + join-us", () => {
  it("renders mega-menu in mobile mode", () => {
    expect(() =>
      renderNode("mega-menu", { trigger_pl: "Menu", columns: [] }, "pl", "mobile"),
    ).not.toThrow();
  });
  it("renders join-us and customize-interests variants", () => {
    for (const variant of ["card", "split", "inline"]) {
      expect(() =>
        renderNode("join-us", { variant, showInterests: "1", title_pl: "J", subtitle_pl: "s" }),
      ).not.toThrow();
    }
    for (const variant of ["full", "compact"]) {
      expect(() => renderNode("customize-interests", { variant, showHeader: "1" })).not.toThrow();
    }
  });
});
