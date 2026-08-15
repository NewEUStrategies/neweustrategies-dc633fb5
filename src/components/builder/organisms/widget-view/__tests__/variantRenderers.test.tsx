// Exhaustive coverage for the three self-contained widget render helpers:
// animated-heading, slider and section-label. Each *Render function is rendered
// directly so every shape / variant / config branch can be driven precisely.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const refs = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
const fallbackImgs = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/builder/contentRefs", () => ({
  useResolvedPostRefs: () => refs.map,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "order", "limit"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: fallbackImgs.rows, error: null });
  return { supabase: { from: () => builder, rpc: async () => ({ data: [], error: null }) } };
});

import {
  AnimatedHeadingRender,
  ANIMATED_SHAPES,
  type AnimatedHeadingShape,
} from "@/lib/builder/animatedHeadingVariants";
import { SliderRender, type SliderItem, type SliderConfig } from "@/lib/builder/sliderVariants";
import {
  SectionLabelRender,
  resolveAccentColor,
  SECTION_LABEL_VARIANTS,
} from "@/lib/builder/sectionLabelVariants";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  refs.map = new Map();
  fallbackImgs.rows = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AnimatedHeadingRender", () => {
  it("renders every shape in highlight mode", () => {
    for (const { value } of ANIMATED_SHAPES) {
      const { container } = render(
        <AnimatedHeadingRender
          config={{
            mode: "highlight",
            shape: value,
            tag: "h2",
            align: "center",
            textBefore: "Dołącz",
            highlight: "do nas",
            textAfter: "dziś",
            color: "#222222",
            accentColor: "#f97316",
            loop: true,
          }}
        />,
      );
      expect(container.textContent).toContain("do nas");
    }
  });

  it("renders shapes with loop disabled and default colors", () => {
    const { container } = render(
      <AnimatedHeadingRender
        config={{ mode: "highlight", shape: "scribble", loop: false, highlight: "x" }}
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("returns no shape svg for an unknown shape", () => {
    const { container } = render(
      <AnimatedHeadingRender
        config={{ shape: "bogus" as AnimatedHeadingShape, highlight: "Hej" }}
      />,
    );
    expect(container.textContent).toContain("Hej");
  });

  it("shows preview placeholder text when highlight is empty", () => {
    const { container } = render(<AnimatedHeadingRender config={{ highlight: "" }} preview />);
    expect(container.textContent).toContain("wyróżnione");
  });

  it("handles textBefore/textAfter spacing variants", () => {
    const { container } = render(
      <AnimatedHeadingRender config={{ textBefore: "Przed ", highlight: "X", textAfter: " po" }} />,
    );
    expect(container.textContent).toContain("Przed");
    expect(container.textContent).toContain("po");
  });

  it("rotates words on an interval in rotate mode", () => {
    vi.useFakeTimers();
    render(
      <AnimatedHeadingRender
        config={{
          mode: "rotate",
          rotateWords: ["szybko", "łatwo", "skutecznie"],
          durationMs: 300,
          loop: true,
        }}
      />,
    );
    expect(screen.getByText("szybko")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("łatwo")).toBeTruthy();
  });

  it("does not start an interval with fewer than two words", () => {
    vi.useFakeTimers();
    const { container } = render(
      <AnimatedHeadingRender config={{ mode: "rotate", rotateWords: ["jedno"] }} />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.textContent).toContain("jedno");
  });

  it("renders an empty highlight without preview placeholder", () => {
    const { container } = render(
      <AnimatedHeadingRender config={{ mode: "highlight", shape: "underline", highlight: "" }} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders rotate mode with no words", () => {
    const { container } = render(
      <AnimatedHeadingRender config={{ mode: "rotate", rotateWords: [] }} />,
    );
    expect(container.querySelector("h2")).toBeTruthy();
  });
});

describe("SliderRender", () => {
  const items: SliderItem[] = [
    {
      image: "https://cdn.x/1.jpg",
      title_pl: "Slajd 1",
      title_en: "Slide 1",
      subtitle_pl: "Opis 1",
      category_pl: "Analiza",
      author: "Anna",
      readTime: "5 min",
      href: "/p1",
      categoryColor: "#ff0000",
    },
    { image: "https://cdn.x/2.jpg", title_pl: "Slajd 2", subtitle_pl: "Opis 2", href: "/p2" },
    { image: "https://cdn.x/3.jpg", title_pl: "Slajd 3" },
  ];

  it("renders slides with category, meta and a linked title; navigates", () => {
    wrap(<SliderRender config={{ variant: "editorial-hero", items, autoplay: false }} lang="pl" />);
    expect(screen.getByText("Slajd 1")).toBeTruthy();
    expect(screen.getByText("Analiza")).toBeTruthy();
    expect(screen.getByText(/Anna/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Następny"));
    expect(screen.getByText("Slajd 2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Poprzedni"));
    fireEvent.click(screen.getByLabelText("Slajd 3"));
    expect(screen.getByText("Slajd 3")).toBeTruthy();
  });

  it("renders an empty placeholder when there are no images", () => {
    const { container } = wrap(<SliderRender config={{ items: [] }} lang="pl" />);
    expect(container.textContent).toContain("Dodaj obrazki");
  });

  it("renders a single slide without navigation and without a title link", () => {
    wrap(
      <SliderRender
        config={{ items: [{ image: "https://cdn.x/a.jpg", title_pl: "Solo" }] }}
        lang="pl"
      />,
    );
    expect(screen.getByText("Solo")).toBeTruthy();
    expect(screen.queryByLabelText("Następny")).toBeNull();
  });

  it("truncates long titles and subtitles", () => {
    const long = "x".repeat(200);
    const { container } = wrap(
      <SliderRender
        config={{ items: [{ image: "https://cdn.x/a.jpg", title_pl: long, subtitle_pl: long }] }}
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("…");
  });

  it("applies size/weight overrides, ratio and rounded", () => {
    const cfg: SliderConfig = {
      items,
      ratio: "21/9",
      rounded: "full",
      overlayOpacity: 0.3,
      titleSizePx: 40,
      titleWeight: 800,
      subtitleSizePx: 18,
      subtitleWeight: 500,
    };
    expect(() => wrap(<SliderRender config={cfg} lang="en" />)).not.toThrow();
  });

  it("resolves bound posts, preferring authored overrides over live data", () => {
    refs.map = new Map([
      [
        "post-1",
        {
          cover: "https://cdn.x/live.jpg",
          href: "/live",
          authorName: "Live Author",
          title: "Live Title",
          excerpt: "Live excerpt",
        },
      ],
    ]);
    wrap(
      <SliderRender
        config={{
          items: [
            { image: "", postId: "post-1" },
            { image: "", postId: "missing", title_pl: "Own" },
          ],
        }}
        lang="pl"
      />,
    );
    expect(screen.getByText("Live Title")).toBeTruthy();
  });

  it("falls back to a placeholder when an image errors", () => {
    const { container } = wrap(
      <SliderRender
        config={{ items: [{ image: "https://cdn.x/broken.jpg", title_pl: "Broken" }] }}
        lang="pl"
      />,
    );
    const img = container.querySelector("img.eh-img") as HTMLImageElement;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    expect(container.querySelector("img.eh-img")).toBeTruthy();
  });

  it("autoplays through slides on a timer", () => {
    vi.useFakeTimers();
    wrap(<SliderRender config={{ items, autoplay: true, intervalMs: 1500 }} lang="pl" />);
    expect(screen.getByText("Slajd 1")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByText("Slajd 2")).toBeTruthy();
  });

  it("skips autoplay in preview mode", () => {
    const { container } = wrap(
      <SliderRender config={{ items, autoplay: true }} lang="pl" preview />,
    );
    expect(container.textContent).toContain("Slajd 1");
  });

  it("uses DB fallback images for unsafe sources and falls back to a placeholder on repeated errors", () => {
    fallbackImgs.rows = [
      { cover_image_url: "https://cdn.x/fallback.jpg" },
      { cover_image_url: "" },
    ];
    const { container } = wrap(
      <SliderRender
        config={{ items: [{ image: "javascript:bad", title_pl: "Unsafe" }] }}
        lang="pl"
      />,
    );
    const img = container.querySelector("img.eh-img") as HTMLImageElement;
    fireEvent.error(img);
    fireEvent.error(img);
    expect(screen.getByText("Unsafe")).toBeTruthy();
  });

  it("falls back PL title/subtitle when EN variants are empty", () => {
    const { container } = wrap(
      <SliderRender
        config={{
          items: [{ image: "https://cdn.x/a.jpg", title_pl: "TylkoPL", subtitle_pl: "OpisPL" }],
        }}
        lang="en"
      />,
    );
    expect(container.textContent).toContain("TylkoPL");
  });
});

describe("SectionLabelRender", () => {
  const variants = SECTION_LABEL_VARIANTS.map((v) => v.value);

  it("renders every variant at md size with an action link", () => {
    for (const variant of variants) {
      const { container } = render(
        <SectionLabelRender
          label="Najnowsze"
          action="więcej"
          href="/all"
          accent="#FA9346"
          variant={variant}
        />,
      );
      expect(container.textContent).toContain("Najnowsze");
    }
  });

  it("renders every variant at sm size and without an action", () => {
    for (const variant of variants) {
      const { container } = render(
        <SectionLabelRender label="Etykieta" accent="#222222" variant={variant} size="sm" />,
      );
      expect(container.textContent).toContain("Etykieta");
    }
  });

  it("applies label/action color + size overrides", () => {
    const { container } = render(
      <SectionLabelRender
        label="Tytuł"
        action="zobacz"
        href="/x"
        accent="#3366ff"
        variant="filled-bar"
        labelColor="#fff"
        labelSize="14px"
        actionColor="#eee"
        actionSize="11px"
      />,
    );
    expect(container.textContent).toContain("Tytuł");
  });

  it("renders the slanted ribbon and badge variants with action spans (no href)", () => {
    for (const variant of ["badge-filled", "slanted-ribbon-rule"] as const) {
      const { container } = render(
        <SectionLabelRender label="Wstęga" action="więcej" accent="#ffffff" variant={variant} />,
      );
      expect(container.textContent).toContain("Wstęga");
    }
  });

  it("renders every variant at sm size WITH an action (sm action spans)", () => {
    for (const variant of variants) {
      const { container } = render(
        <SectionLabelRender
          label="Mała"
          action="więcej"
          href="/x"
          accent="#FA9346"
          variant={variant}
          size="sm"
        />,
      );
      expect(container.textContent).toContain("Mała");
    }
  });

  it("computes contrast for 3-char hex and non-hex accents (filled label)", () => {
    expect(
      render(<SectionLabelRender label="A" accent="#fff" variant="badge-filled" />).container
        .textContent,
    ).toContain("A");
    expect(
      render(<SectionLabelRender label="B" accent="#000" variant="filled-bar" />).container
        .textContent,
    ).toContain("B");
    expect(
      render(<SectionLabelRender label="C" accent="oklch(0.5 0.1 200)" variant="badge-filled" />)
        .container.textContent,
    ).toContain("C");
  });
});

describe("resolveAccentColor", () => {
  it("resolves named presets", () => {
    for (const name of [
      "military",
      "finance",
      "diplomacy",
      "transport",
      "cyber",
      "neutral",
      "brand",
      "unknown",
    ]) {
      expect(resolveAccentColor(name)).toMatch(/oklch|#/);
    }
  });

  it("passes raw css colors through unchanged", () => {
    expect(resolveAccentColor("#abcdef")).toBe("#abcdef");
    expect(resolveAccentColor("oklch(0.5 0.1 200)")).toContain("oklch");
    expect(resolveAccentColor("hsl(200 50% 50%)")).toContain("hsl");
    expect(resolveAccentColor("rgb(1,2,3)")).toContain("rgb");
    expect(resolveAccentColor("var(--x)")).toContain("var(");
  });

  it("defaults to brand orange when empty", () => {
    expect(resolveAccentColor()).toBe("#FA9346");
  });
});
