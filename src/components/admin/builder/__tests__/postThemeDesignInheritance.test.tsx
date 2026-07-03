// Ujednolicenie: WSZYSTKIE post-title/post-excerpt w widgetach dziedziczą
// globalne tokeny Theme Design (superadmin). Konflikt specyficzności
// (Tailwind `leading-snug`, `text-sm` = [0,1,0] vs `.cms-post-title` = [0,1,0])
// jest teraz rozwiązany przez podwójny selektor `.cms-post-title.cms-post-title`
// w `src/styles.css`, a widgety NIE dokładają już twardych klas rozmiaru/leading
// obok `.cms-post-*`.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("globalne tokeny Theme Design: `.cms-post-*` mają pierwszeństwo nad utility Tailwind", () => {
  it("styles.css: `.cms-post-title.cms-post-title` (podwojona specyficzność) referuje --td-pt-*", () => {
    const css = read("src/styles.css");
    expect(css).toMatch(/\.cms-post-title\.cms-post-title\s*\{[^}]*font-size:\s*var\(--td-pt-size/);
    expect(css).toMatch(
      /\.cms-post-title\.cms-post-title\s*\{[^}]*font-weight:\s*var\(--td-pt-weight/,
    );
    expect(css).toMatch(/\.cms-post-title\.cms-post-title\s*\{[^}]*line-height:\s*var\(--td-pt-lh/);
  });

  it("styles.css: `.cms-post-excerpt.cms-post-excerpt` (podwojona specyficzność) referuje --td-pe-*", () => {
    const css = read("src/styles.css");
    expect(css).toMatch(
      /\.cms-post-excerpt\.cms-post-excerpt\s*\{[^}]*font-size:\s*var\(--td-pe-size/,
    );
    expect(css).toMatch(
      /\.cms-post-excerpt\.cms-post-excerpt\s*\{[^}]*font-weight:\s*var\(--td-pe-weight/,
    );
    expect(css).toMatch(
      /\.cms-post-excerpt\.cms-post-excerpt\s*\{[^}]*line-height:\s*var\(--td-pe-lh/,
    );
  });

  it("styles.css: klasa `.cms-meta` daje globalny --td-meta-size (dla meta/caption/breadcrumb)", () => {
    const css = read("src/styles.css");
    expect(css).toMatch(/\.cms-meta\.cms-meta\s*\{[^}]*font-size:\s*var\(--td-meta-size/);
  });

  const OFFENDING =
    /\b(?:leading-(?:none|tight|snug|normal|relaxed|loose)|text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl))\b/;
  const FILES = [
    "src/components/admin/builder/ui/organisms/widget-view/PostListView.tsx",
    "src/components/admin/builder/ui/organisms/widget-view/PodcastLatestView.tsx",
    "src/components/admin/builder/ui/organisms/widget-view/DynamicTagWidgets.tsx",
    "src/components/admin/builder/ui/organisms/widget-view/WebStoriesCarouselView.tsx",
    "src/lib/builder/sliderVariants.tsx",
    "src/lib/builder/animatedHeadingVariants.tsx",
  ];

  for (const rel of FILES) {
    it(`${rel}: żadna linia z .cms-post-title/.cms-post-excerpt nie zawiera Tailwind text-*/leading-*`, () => {
      const src = read(rel);
      const offenders = src
        .split("\n")
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(({ l }) => /(cms-post-title|cms-post-excerpt)/.test(l))
        .filter(({ l }) => {
          // Pattern szuka klasy w className zawierającej cms-post-*.
          const m = l.match(/className="([^"]*(?:cms-post-title|cms-post-excerpt)[^"]*)"/);
          if (!m) return false;
          return OFFENDING.test(m[1]);
        });
      expect(
        offenders,
        `Znaleziono twarde klasy Tailwind: ${JSON.stringify(offenders.map((o) => `${o.i}: ${o.l.trim()}`))}`,
      ).toEqual([]);
    });
  }
});
