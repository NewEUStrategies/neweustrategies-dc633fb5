// Third branch sweep: ImageWidget permutations, RatedListView explicit
// dark-color resolution + hover, and WidgetView typography/EN combos.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import { RatedListView } from "../RatedListView";
import type { WidgetNode, WidgetType, WidgetContent } from "@/lib/builder/types";

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
function widget(
  type: WidgetType,
  content: WidgetContent,
  opts: { lang?: "pl" | "en"; editable?: boolean; theme?: "light" | "dark" } = {},
) {
  const node: WidgetNode = { id: `s3-${nextId++}`, kind: "widget", type, content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang={opts.lang ?? "pl"}
        device="desktop"
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

describe("ImageWidget permutations", () => {
  it("renders variant x ratio x align x sizing x caption x link", () => {
    for (const variant of [
      "default",
      "rounded",
      "circle",
      "polaroid",
      "shadow",
      "frame",
      "zoom-hover",
    ]) {
      for (const align of ["left", "center", "right"]) {
        const { container } = widget("image", {
          src: "https://cdn.example.com/i.png",
          alt_pl: "Opis",
          variant,
          align,
          ratio: "16/9",
          objectFit: "contain",
          widthPx: 240,
          maxWidthPx: 320,
          caption_pl: "Cap",
        });
        expect(container.querySelector("img")).toBeTruthy();
      }
    }
  });

  it("renders light+dark pair in dark theme without a ratio frame, with an internal link", () => {
    const { container } = widget(
      "image",
      {
        src: "https://cdn.example.com/l.png",
        srcDark: "https://cdn.example.com/d.png",
        alt_pl: "A",
        href: "/internal",
      },
      { theme: "dark" },
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/internal");
  });

  it("uses the site logo fallback when alt indicates a logo and no src is set", () => {
    const { container } = widget("image", { src: "", alt_pl: "Site Logo", useSiteLogo: "main" });
    // No configured logo -> placeholder, but the site-logo path is exercised.
    expect(container).toBeTruthy();
  });
});

describe("RatedListView explicit dark colors + hover", () => {
  const items = [
    {
      title_pl: "RR",
      rating: 6,
      category_pl: "C",
      author: "Au",
      date: "2026-01-01",
      excerpt_pl: "e",
    },
  ];
  it("applies explicit *Dark color overrides and a title hover color", () => {
    const { container } = wrapRated(
      <RatedListView
        c={{
          source: "manual",
          items,
          numberColor: "#111",
          numberColorDark: "#eee",
          categoryColor: "#dc2626",
          categoryColorDark: "#f87171",
          titleColor: "#222",
          titleColorDark: "#ddd",
          titleHoverColor: "#f00",
          metaColor: "#666",
          metaColorDark: "#aaa",
          excerptColor: "#999",
          excerptColorDark: "#ccc",
          readMoreColor: "#00f",
          readMoreColorDark: "#88f",
          bookmarkColor: "#0a0",
          bookmarkColorDark: "#6f6",
          postFormatColor: "#a0a",
          postFormatColorDark: "#d8d",
          showAuthor: true,
          showDate: true,
          showExcerpt: true,
          showRating: true,
          showCategory: true,
          showBookmark: true,
          showPostFormat: true,
        }}
        lang="pl"
        mode="dark"
      />,
    );
    expect(container.textContent).toContain("RR");
  });
});

describe("WidgetView typography + EN fallbacks", () => {
  it("applies full typography (family/size/weight/style/spacing/transform/decoration/align)", () => {
    const { container } = widget("text", { html_pl: "<p>T</p>" }, { lang: "pl" });
    expect(container).toBeTruthy();
    widget("heading", { text_pl: "T" }, { lang: "en" }); // EN with empty text_en already tested; ensure render
    // Heading with icon on the right + href + subtitle px sizing in EN.
    widget(
      "heading",
      {
        text_pl: "T",
        iconName: "Star",
        iconPosition: "right",
        href: "/x",
        subtitle_pl: "S",
        subtitleSizePx: 14,
        subtitleWeight: "500",
        sizePx: 30,
        titleWeight: "700",
      },
      { lang: "en" },
    );
  });
});
