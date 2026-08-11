// Regresja: meta wpisu (autor, data, czas czytania) oraz spis treści muszą
// czytać rozmiar z Admin -> Opcje motywu -> Rozmiary czcionek (token "mały
// tekst"), zamiast twardych klas text-sm / text-[13px].
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const read = (p: string) => readFileSync(p, "utf8");

describe("meta + TOC typography inherits theme font sizes", () => {
  it("meta classes fall back to --fs-small / --lh-small", () => {
    expect(css).toContain("font-size: var(--td-meta-size, var(--fs-small, 13px));");
    expect(css).toContain("line-height: var(--td-meta-lh, var(--lh-small, 1.4));");
  });

  it("declares TOC typography utilities bound to --fs-small", () => {
    for (const cls of [
      ".cms-toc-heading.cms-toc-heading",
      ".cms-toc-kicker.cms-toc-kicker",
      ".cms-toc-item.cms-toc-item",
      ".cms-toc-sub.cms-toc-sub",
      ".cms-toc-index.cms-toc-index",
    ]) {
      expect(css).toContain(cls);
    }
    expect(css).toMatch(/\.cms-toc-item\.cms-toc-item\s*\{\s*font-size: var\(--fs-small/);
  });

  it("reading time, views and byline use .cms-meta instead of text-sm", () => {
    const utils = read("src/components/blocks/PostUtilityViews.tsx");
    expect(utils).not.toMatch(/inline-flex items-center gap-1\.5 text-sm text-muted-foreground/);
    expect(utils).toContain("cms-meta inline-flex items-center gap-1.5");

    const foxiz = read("src/components/blocks/FoxizExtraViews.tsx");
    expect(foxiz).toContain("cms-meta flex flex-wrap items-center gap-x-2");
  });

  it("TOC views no longer hardcode font sizes", () => {
    const widget = read(
      "src/components/admin/builder/ui/organisms/widget-view/TocWidget.tsx",
    );
    for (const hard of ["text-[13px]", "text-[14px]", "text-[12px] text-muted-foreground"]) {
      expect(widget).not.toContain(hard);
    }
    expect(widget).toContain("cms-toc-item");
    expect(widget).toContain("cms-toc-index");

    const block = read("src/components/blocks/TocBlockView.tsx");
    expect(block).toContain("cms-toc-item");
    expect(block).toContain("cms-toc-kicker");
    expect(block).not.toContain("text-[10px] uppercase");
  });
});
