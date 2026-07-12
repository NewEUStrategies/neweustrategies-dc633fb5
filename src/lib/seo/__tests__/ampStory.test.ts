import { describe, expect, it } from "vitest";
import {
  buildAmpStoryHtml,
  canBuildAmpStory,
  htmlEscape,
  resolvePosterPortrait,
  type AmpStoryInput,
} from "@/lib/seo/ampStory";
import { StoryPageSchema } from "@/lib/web-stories/types";

function page(over: Partial<Parameters<typeof StoryPageSchema.parse>[0]> = {}) {
  return StoryPageSchema.parse({ id: "p1", ...over });
}

function input(over: Partial<AmpStoryInput["story"]> = {}): AmpStoryInput {
  return {
    story: {
      slug: "moja-historia",
      title_pl: "Tytuł <PL>",
      title_en: "Title EN",
      description_pl: "Opis",
      description_en: "",
      cover_url: "https://cdn.example.org/cover.jpg",
      pages: [
        page({ id: "p1", media_url: "https://cdn.example.org/1.jpg", title_pl: "Strona 1" }),
        page({ id: "p2", background: "color", color: "#112233", caption_pl: "Podpis" }),
      ],
      published_at: "2026-07-01T10:00:00Z",
      updated_at: "2026-07-02T10:00:00Z",
      ...over,
    },
    lang: "pl",
    origin: "https://example.org",
    publisherName: "New European Strategies",
    publisherLogoUrl: "https://cdn.example.org/logo.png",
  };
}

describe("buildAmpStoryHtml", () => {
  it("emits a standalone amp-story with required publisher/poster attributes", () => {
    const html = buildAmpStoryHtml(input());
    expect(html).toContain("<html amp");
    expect(html).toContain('<script async src="https://cdn.ampproject.org/v0.js">');
    expect(html).toContain('custom-element="amp-story"');
    expect(html).toContain("<style amp-boilerplate>");
    expect(html).toContain('<amp-story standalone title="Tytuł &lt;PL&gt;"');
    expect(html).toContain('publisher="New European Strategies"');
    expect(html).toContain('publisher-logo-src="https://cdn.example.org/logo.png"');
    expect(html).toContain('poster-portrait-src="https://cdn.example.org/cover.jpg"');
    expect(html).toContain(
      '<link rel="canonical" href="https://example.org/web-stories/moja-historia">',
    );
  });

  it("renders image pages as fill layers and color pages via amp-custom classes", () => {
    const html = buildAmpStoryHtml(input());
    expect(html).toContain('<amp-img src="https://cdn.example.org/1.jpg"');
    expect(html).toContain(".bg-1{background-color:#112233;}");
    expect(html).toContain('class="bg bg-1"');
    expect(html).not.toContain("amp-video-0.1.js");
  });

  it("includes the amp-video runtime only when a video page exists", () => {
    const html = buildAmpStoryHtml(
      input({
        pages: [
          page({ id: "v1", background: "video", media_url: "https://cdn.example.org/v.mp4" }),
        ],
      }),
    );
    expect(html).toContain("amp-video-0.1.js");
    expect(html).toContain('<source src="https://cdn.example.org/v.mp4" type="video/mp4"/>');
  });

  it("carries Article JSON-LD with the canonical as mainEntityOfPage", () => {
    const html = buildAmpStoryHtml(input());
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"mainEntityOfPage":"https://example.org/web-stories/moja-historia"');
  });
});

describe("canBuildAmpStory / resolvePosterPortrait", () => {
  it("requires at least one page and some poster source", () => {
    expect(canBuildAmpStory(input())).toBe(true);
    expect(canBuildAmpStory(input({ pages: [] }))).toBe(false);
    expect(
      canBuildAmpStory(
        input({ cover_url: null, pages: [page({ background: "color", media_url: "" })] }),
      ),
    ).toBe(false);
  });

  it("falls back to the first media page when the cover is missing", () => {
    const i = input({
      cover_url: null,
      pages: [
        page({ background: "color" }),
        page({ id: "p9", media_url: "https://cdn.example.org/9.jpg" }),
      ],
    });
    expect(resolvePosterPortrait(i)).toBe("https://cdn.example.org/9.jpg");
  });
});

describe("htmlEscape", () => {
  it("escapes AMP-breaking characters", () => {
    expect(htmlEscape(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
