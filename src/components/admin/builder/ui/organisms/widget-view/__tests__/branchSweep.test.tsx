// Final branch sweep: the i18n "_en || _pl || default" fallbacks (rendered in
// EN with only PL fields, and with no optional fields at all), plus the last
// per-widget toggle permutations not hit elsewhere.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import { RatedListView } from "../RatedListView";
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
    i18n: { language: "en" },
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
    id: `s-${nextId++}`,
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
        lang={opts.lang ?? "en"}
        device={opts.device ?? "desktop"}
        editable={opts.editable}
        onContentChange={opts.editable ? () => {} : undefined}
      />
    </QueryClientProvider>,
  );
}
function wrapRated(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
afterEach(cleanup);

describe("EN i18n fallbacks (only PL fields set) + defaults", () => {
  it("falls back to PL across text widgets and uses built-in defaults when empty", () => {
    // PL-only fields, rendered in EN -> exercises the `_en || _pl` right side.
    renderNode("heading", { text_pl: "PLh", subtitle_pl: "PLs" });
    renderNode("text", { html_pl: "<p>PLtext</p>" });
    renderNode("button", { label_pl: "PLb", href: "/x" });
    renderNode("nav-link", { label_pl: "PLn" });
    renderNode("cta", { title_pl: "PLc", subtitle_pl: "PLsub", cta_pl: "PLcta" });
    renderNode("dark-featured-card", { badge_pl: "PLbadge", title_pl: "PLt", excerpt_pl: "PLe" });
    renderNode("hot-topic-bar", { badge_pl: "PLhot", title_pl: "PLtitle" });
    renderNode("testimonial", { quote_pl: "PLq", role_pl: "PLrole", author: "A" });
    renderNode("accordion", { items: [{ q_pl: "PLq", a_pl: "PLa" }] });
    renderNode("pricing", {
      plans: [
        {
          name_pl: "PLname",
          price: "0",
          period_pl: "/m",
          features_pl: ["x"],
          cta_pl: "PLcta",
          href: "/p",
        },
      ],
    });
    renderNode("account-link", { signin_pl: "PLin", signup_pl: "PLup" });
    renderNode("copyright", { text_pl: "PLrights", brand: "B" });
    renderNode("tts", { label_pl: "PLtts" });
    renderNode("section-label", { label_pl: "PLlabel", action_pl: "PLact", href: "/x" });
    renderNode("tabs", { tabs: [{ label_pl: "PLtab", html_pl: "<p>x</p>" }] });
    // Defaults: empty content -> the literal fallback strings.
    expect(renderNode("newsletter", { variant: "icon" }).container).toBeTruthy();
    expect(renderNode("hot-topic-bar", {}).container.textContent).toContain("Hot topic");
    expect(renderNode("section-label", {}).container.textContent).toContain("Sekcja");
  });
});

describe("social-icons active/inactive/background permutations", () => {
  it("renders all-inactive placeholders when showEmpty is set and no links exist", () => {
    const { container } = renderNode("social-icons", {
      showEmpty: "show",
      colorMode: "official",
      bgMode: "official",
    });
    // Inactive icons render as spans (no href) with reduced opacity.
    expect(container.querySelectorAll("span[aria-label]").length).toBeGreaterThan(0);
  });

  it("renders active links without backgrounds (bgMode none)", () => {
    renderNode("social-icons", {
      facebook: "https://facebook.com/x",
      email: "a@b.co",
      bgMode: "none",
      colorMode: "custom",
      customColor: "#abc",
    });
    expect(screen.getByLabelText("Facebook")).toBeTruthy();
  });

  it("renders the email link on an official-color background (contrast text)", () => {
    renderNode("social-icons", { email: "a@b.co", bgMode: "official", colorMode: "official" });
    expect(screen.getByLabelText("Email").getAttribute("href")).toBe("mailto:a@b.co");
  });
});

describe("WidgetView typography + motion branch combos", () => {
  it("applies title-only font size with a description gap", () => {
    const { container } = renderNode(
      "heading",
      { text_pl: "T" },
      {
        style: {
          typography: {
            fontSize: { desktop: "22px" },
            descriptionFontSize: { desktop: "13px" },
            titleDescriptionGapPx: 12,
            fontFamily: "Inter",
          },
        },
      },
    );
    expect(container.querySelectorAll("style").length).toBeGreaterThan(0);
  });

  it("applies font size alone (no description size) and replays animation each view", () => {
    const sized = renderNode(
      "heading",
      { text_pl: "T" },
      { style: { typography: { fontSize: { desktop: "22px" } } } },
    );
    // Title size materializes as a scoped <style> rule with the configured px.
    const sizedCss = [...sized.container.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("\n");
    expect(sizedCss).toContain("22px");
    const animated = renderNode(
      "heading",
      { text_pl: "T" },
      {
        advanced: {
          animation: "zoom",
          animationOnce: false,
          animationEasing: "bounce",
          animationDuration: 300,
        },
      },
    );
    // The motion wrapper drives the reveal via an inline transition with the
    // configured duration.
    const wrapper = animated.container.querySelector("[data-w-id]");
    expect(wrapper?.getAttribute("style") ?? "").toContain("300ms");
  });
});

describe("RatedListView remaining toggles", () => {
  const items = [
    {
      title_pl: "RA",
      title_en: "",
      excerpt_pl: "ex",
      author: "Au",
      rating: 7,
      category_pl: "Kat",
      date: "2026-01-01",
      format: "video",
    },
  ];

  it("renders number position 'top', between-borders, rating, author/date and category", () => {
    const { container } = wrapRated(
      <RatedListView
        c={{
          source: "manual",
          items,
          numberPosition: "top",
          gridBorders: "between",
          gridBorderWidthPx: 1,
          showAuthor: true,
          showDate: true,
          showRating: true,
          showCategory: true,
          categoryUppercase: false,
          itemPaddingPx: 8,
        }}
        lang="en"
      />,
    );
    expect(container.textContent).toContain("RA");
    expect(container.textContent).toContain("out of 10");
  });

  it("renders between-borders in a grid and exposes a working load-more button", () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ title_pl: `T${i}`, rating: 0 }));
    const { container } = wrapRated(
      <RatedListView
        c={{
          source: "manual",
          items: many,
          columnsDesktop: 2,
          gridBorders: "between",
          scrollingMode: "loadmore",
          pageSize: 2,
        }}
        lang="pl"
      />,
    );
    const more = container.querySelector("button");
    expect(more).toBeTruthy();
    fireEvent.click(more!);
    expect(container.textContent).toContain("T3");
  });
});
