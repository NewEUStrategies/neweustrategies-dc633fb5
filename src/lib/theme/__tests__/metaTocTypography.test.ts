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
    const widget = read("src/components/builder/organisms/widget-view/TocWidget.tsx");
    for (const hard of [
      "text-[13px]",
      "text-[14px]",
      "text-[12px] text-muted-foreground",
      "text-[11px]",
      "text-[10px]",
    ]) {
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

describe("post title + lead inherit full theme typography", () => {
  it("header/overlay title classes carry weight, letter-spacing and transform tokens", () => {
    // Rozmiar niesie --header/--overlay-title-* (postLayouts.ts), ale charakter
    // pisma (grubość, tracking, wielkość liter) musi zawsze płynąć z sekcji H1
    // w Admin -> Opcje motywu -> Rozmiary czcionek.
    for (const cls of [".header-title-typography", ".overlay-title-typography"]) {
      const block = css.split(cls)[1]?.split("}")[0] ?? "";
      expect(block).toContain("font-weight: var(--fw-h1");
      expect(block).toContain("letter-spacing: var(--ls-h1");
      expect(block).toContain("text-transform: var(--tt-h1");
    }
  });

  it("post title h1 no longer hardcodes font-bold over the theme weight", () => {
    const renderer = read("src/components/PostLayoutRenderer.tsx");
    expect(renderer).not.toContain("header-title-typography font-display font-bold");
    expect(renderer).not.toContain("overlay-title-typography font-display font-bold");

    const scaffold = read("src/components/admin/blocks/LayoutScaffold.tsx");
    expect(scaffold).not.toContain("header-title-typography font-bold");
    expect(scaffold).not.toContain("header-title-typography font-display font-bold");
    expect(scaffold).not.toContain("overlay-title-typography font-display font-bold");
  });

  it("overlay meta row uses the theme small-token scale instead of text-[10px]", () => {
    expect(css).toContain(".overlay-meta-typography");
    expect(css).toMatch(/\.overlay-meta-typography\s*\{\s*font-size: calc\(var\(--fs-small/);
    const renderer = read("src/components/PostLayoutRenderer.tsx");
    expect(renderer).toContain("overlay-meta-typography");
    expect(renderer).not.toContain("text-[10px] md:text-[11px]");
    const scaffold = read("src/components/admin/blocks/LayoutScaffold.tsx");
    expect(scaffold).toContain("overlay-meta-typography");
    expect(scaffold).not.toContain("text-[10px] md:text-[11px]");
  });

  it("static page title consumes the theme H1 tokens", () => {
    const block = css.split(".page-title-typography")[1]?.split("}")[0] ?? "";
    expect(block).toContain("font-size: var(--fs-h1");
    expect(block).toContain("line-height: var(--lh-h1");
    const route = read("src/routes/$.tsx");
    expect(route).toContain("page-title-typography");
    expect(route).not.toContain('className="font-display text-4xl lg:text-5xl mb-4"');
  });
});

describe("post sidebar widgets inherit theme font sizes", () => {
  it("declares the cms-widget-* scale bound to --fs-small", () => {
    for (const cls of [
      ".cms-widget-title.cms-widget-title",
      ".cms-widget-label.cms-widget-label",
      ".cms-widget-kicker.cms-widget-kicker",
      ".cms-widget-note.cms-widget-note",
    ]) {
      expect(css).toContain(cls);
    }
    expect(css).toMatch(
      /\.cms-widget-title\.cms-widget-title\s*\{\s*font-size: calc\(var\(--fs-small/,
    );
  });

  it("floating share bar (SPIS TREŚCI + UDOSTĘPNIJ) drops hardcoded px sizes", () => {
    const bar = read("src/components/share/FloatingShareBar.tsx");
    for (const hard of [
      "text-[12.5px]",
      "text-[13.5px]",
      "text-[11px]",
      "text-[12px]",
      "text-[10px]",
    ]) {
      expect(bar).not.toContain(hard);
    }
    expect(bar).toContain("cms-toc-item");
    expect(bar).toContain("cms-toc-index");
    expect(bar).toContain("cms-widget-kicker");
    expect(bar).toContain("cms-widget-note");
  });

  it("author card (name, role, links) reads the theme scale", () => {
    const card = read("src/components/post/AuthorBusinessCard.tsx");
    expect(card).toContain("cms-widget-title");
    expect(card).toContain("cms-widget-label");
    expect(card).not.toContain("text-sm font-semibold leading-tight");
    expect(card).not.toContain("text-[11px]");
    expect(card).not.toMatch(/text-xs text-muted-foreground/);
  });

  it("listen card (POSŁUCHAJ ARTYKUŁU) reads the theme scale", () => {
    const listen = read("src/components/audio/SidebarListenCard.tsx");
    expect(listen).toContain("cms-widget-note");
    expect(listen).toContain("cms-widget-label");
    expect(listen).not.toContain("text-[10px]");
    expect(listen).not.toContain("text-[11px]");
  });

  it("sidebar tags widget and AKTUALIZACJA badge read the theme scale", () => {
    const sidebar = read("src/components/post/PostSidebarRenderer.tsx");
    expect(sidebar).toContain("cms-widget-kicker");
    expect(sidebar).not.toContain("text-[11px]");

    const bar = read("src/components/post/QuickViewInfoBar.tsx");
    expect(bar).toContain("cms-widget-note");
    expect(bar).not.toContain("text-[10px]");
  });
});
