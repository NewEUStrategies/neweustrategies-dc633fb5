// Regression: the heading widget editor MUST render a light+dark preview
// panel that visibly surfaces the Theme Design fallback for fontWeight AND
// line-height whenever those fields are left empty. Without the preview
// the author has to save + reload the page to see whether "domyślna" really
// picks up `--td-pt-weight` / `--td-pt-lh`.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HeadingFallbackPreview } from "../HeadingFallbackPreview";

describe("HeadingFallbackPreview - visible TD fallbacks", () => {
  it("empty weights → shows both var(--td-pt-weight) and var(--td-pe-weight)", () => {
    const html = renderToStaticMarkup(
      <HeadingFallbackPreview
        titleWeight=""
        subtitleWeight=""
        sizePx={0}
        subtitleSizePx={0}
        sizePreset=""
        titleSample="Tytuł"
        subtitleSample="Podtytuł"
      />,
    );
    expect(html).toMatch(/font-weight\s*:\s*var\(--td-pt-weight/);
    expect(html).toMatch(/font-weight\s*:\s*var\(--td-pe-weight/);
  });

  it("empty sizes → shows both var(--td-pt-lh) and var(--td-pe-lh)", () => {
    const html = renderToStaticMarkup(
      <HeadingFallbackPreview
        titleWeight=""
        subtitleWeight=""
        sizePx={0}
        subtitleSizePx={0}
        sizePreset=""
        titleSample="T"
        subtitleSample="S"
      />,
    );
    expect(html).toMatch(/line-height\s*:\s*var\(--td-pt-lh/);
    expect(html).toMatch(/line-height\s*:\s*var\(--td-pe-lh/);
  });

  it("renders BOTH light and dark preview cards side by side", () => {
    const html = renderToStaticMarkup(
      <HeadingFallbackPreview
        titleWeight=""
        subtitleWeight=""
        sizePx={0}
        subtitleSizePx={0}
        sizePreset=""
        titleSample="T"
        subtitleSample="S"
      />,
    );
    // Author must see the contrast between modes; a single-mode preview
    // silently hides dark-mode regressions.
    expect(html).toMatch(/tryb Jasny/);
    expect(html).toMatch(/tryb Ciemny/);
    // Dark card carries the dark background so light-on-light color bugs
    // are visible without switching the whole app theme.
    expect(html).toMatch(/background:\s*#0f0f11/);
  });

  it("explicit widget-level weight overrides the TD fallback", () => {
    const html = renderToStaticMarkup(
      <HeadingFallbackPreview
        titleWeight="900"
        subtitleWeight="700"
        sizePx={0}
        subtitleSizePx={0}
        sizePreset=""
        titleSample="T"
        subtitleSample="S"
      />,
    );
    expect(html).not.toMatch(/font-weight\s*:\s*var\(--td-pt-weight/);
    expect(html).not.toMatch(/font-weight\s*:\s*var\(--td-pe-weight/);
    expect(html).toMatch(/font-weight\s*:\s*900/);
    expect(html).toMatch(/font-weight\s*:\s*700/);
  });

  it("explicit sizePx overrides the TD size + line-height fallback for the title", () => {
    const html = renderToStaticMarkup(
      <HeadingFallbackPreview
        titleWeight=""
        subtitleWeight=""
        sizePx={48}
        subtitleSizePx={20}
        sizePreset=""
        titleSample="T"
        subtitleSample="S"
      />,
    );
    // Title switches to px + local lh; subtitle keeps its own px + local lh.
    expect(html).toMatch(/font-size\s*:\s*48px/);
    expect(html).toMatch(/font-size\s*:\s*20px/);
    expect(html).not.toMatch(/font-size\s*:\s*var\(--td-pt-size/);
    expect(html).not.toMatch(/font-size\s*:\s*var\(--td-pe-size/);
  });
});
