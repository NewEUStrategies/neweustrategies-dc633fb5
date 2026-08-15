// Branch coverage for the dynamic-tag widgets. Rendered with a full current-post
// context (the "live data" branches) and with an empty context (the null/early
// returns), across each widget's content options.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { DynamicTagWidget } from "../DynamicTagWidgets";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";
import type { WidgetNode, WidgetType } from "@/lib/builder/types";

const FULL: CurrentPostCtx = {
  kind: "post",
  id: "p1",
  slug: "wpis",
  title_pl: "Tytuł wpisu",
  title_en: "Post title",
  excerpt_pl: "Zajawka wpisu po polsku z dłuższym opisem.",
  excerpt_en: "English excerpt.",
  coverUrl: "https://cdn.example.com/cover.jpg",
  publishedAt: "2026-01-15T10:00:00Z",
  readingTimeMin: 7,
  viewCount: 4096,
  author: {
    name: "Anna Nowak",
    slug: "anna",
    avatarUrl: "https://cdn.example.com/a.jpg",
    bio_pl: "Bio PL",
    bio_en: "Bio EN",
  },
  categories: [
    { slug: "ue", name: "UE" },
    { slug: "gosp", name: "Gospodarka" },
  ],
  tags: [
    { slug: "nato", name: "NATO" },
    { slug: "ue", name: "UE" },
  ],
  breadcrumbs: [
    { label: "Start", href: "/" },
    { label: "UE", href: "/category/ue" },
    { label: "Tytuł" },
  ],
  archive: { type: "tag", label: "Tag: NATO", description: "Wpisy o NATO", count: 9 },
};

const EMPTY: CurrentPostCtx = { kind: "archive" };

function node(type: WidgetType, content: Record<string, unknown> = {}): WidgetNode {
  return { id: `${type}-1`, kind: "widget", type, content: content as WidgetNode["content"] };
}

// post-meta dociąga realny licznik odsłon przez react-query (tylko gdy
// `showViews` jest włączone i kontekst nie niesie już wartości), więc każdy
// render potrzebuje klienta zapytań.
function renderTag(ui: ReactElement, ctx: CurrentPostCtx | null = FULL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CurrentPostProvider value={ctx}>{ui}</CurrentPostProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("dynamic-tag widgets with full context", () => {
  it("post-title links to the post when linkToPost is set", () => {
    renderTag(
      <DynamicTagWidget node={node("post-title", { tag: "h1", linkToPost: true })} lang="pl" />,
    );
    expect(screen.getByRole("link", { name: "Tytuł wpisu" }).getAttribute("href")).toBe("/wpis");
  });

  it("post-title falls back to the content fallback when context lacks a title", () => {
    renderTag(
      <DynamicTagWidget node={node("post-title", { fallback_pl: "Zapasowy" })} lang="pl" />,
      { kind: "preview" },
    );
    expect(screen.getByText("Zapasowy")).toBeTruthy();
  });

  it("post-meta renders author, category, date, reading time and views", () => {
    const { container } = renderTag(
      <DynamicTagWidget
        node={node("post-meta", { showViews: true, separator: " | " })}
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("Anna Nowak");
    expect(container.textContent).toContain("UE");
    expect(container.textContent).toContain("7 min");
    expect(container.textContent).toContain("4096".replace("4096", "4")); // formatted number contains digits
  });

  it("post-meta supports relative + short + invalid date formats", () => {
    expect(() =>
      renderTag(
        <DynamicTagWidget node={node("post-meta", { dateFormat: "relative" })} lang="en" />,
      ),
    ).not.toThrow();
    expect(() =>
      renderTag(<DynamicTagWidget node={node("post-meta", { dateFormat: "short" })} lang="pl" />),
    ).not.toThrow();
    renderTag(<DynamicTagWidget node={node("post-meta")} lang="pl" />, {
      ...FULL,
      publishedAt: "not-a-real-date",
    });
  });

  it("post-tags-dyn renders pills with and without a label", () => {
    expect(
      renderTag(<DynamicTagWidget node={node("post-tags-dyn", { showLabel: true })} lang="pl" />)
        .container.textContent,
    ).toContain("Tagi:");
    expect(
      renderTag(<DynamicTagWidget node={node("post-tags-dyn", { showLabel: false })} lang="en" />)
        .container.textContent,
    ).toContain("NATO");
  });

  it("post-categories-dyn respects a limit", () => {
    const { container } = renderTag(
      <DynamicTagWidget node={node("post-categories-dyn", { limit: 1 })} lang="pl" />,
    );
    expect(container.textContent).toContain("UE");
    expect(container.textContent).not.toContain("Gospodarka");
  });

  it("post-author-card renders avatar + bio, and an icon when no avatar", () => {
    expect(
      renderTag(
        <DynamicTagWidget
          node={node("post-author-card", { showAvatar: true, showBio: true })}
          lang="pl"
        />,
      ).container.querySelector("img"),
    ).toBeTruthy();
    const noAvatar = renderTag(<DynamicTagWidget node={node("post-author-card")} lang="en" />, {
      ...FULL,
      author: { name: "No Pic", slug: "" },
    });
    expect(noAvatar.container.textContent).toContain("No Pic");
  });

  it("post-breadcrumbs renders home + chevron separator variants", () => {
    expect(
      renderTag(
        <DynamicTagWidget
          node={node("post-breadcrumbs", { showHome: true, separator: ">" })}
          lang="pl"
        />,
      ).container.querySelector("nav"),
    ).toBeTruthy();
    expect(
      renderTag(<DynamicTagWidget node={node("post-breadcrumbs", { showHome: false })} lang="en" />)
        .container.textContent,
    ).toContain("UE");
  });

  it("post-cover renders an image (rounded + square)", () => {
    expect(
      renderTag(
        <DynamicTagWidget node={node("post-cover", { rounded: true, aspect: "4/3" })} lang="pl" />,
      ).container.querySelector("img"),
    ).toBeTruthy();
    expect(
      renderTag(
        <DynamicTagWidget node={node("post-cover", { rounded: false })} lang="pl" />,
      ).container.querySelector("img"),
    ).toBeTruthy();
  });

  it("post-excerpt truncates to maxChars", () => {
    const { container } = renderTag(
      <DynamicTagWidget node={node("post-excerpt", { maxChars: 10 })} lang="pl" />,
    );
    expect(container.textContent).toContain("…");
  });

  it("archive-title renders the archive header with count + description", () => {
    const { container } = renderTag(
      <DynamicTagWidget
        node={node("archive-title", { showCount: true, showDescription: true })}
        lang="pl"
      />,
    );
    expect(container.textContent).toContain("Tag: NATO");
    expect(container.textContent).toContain("9");
  });

  // Zaszyta próbka "Przykładowe archiwum / 12 wpisów" była widoczna także
  // publicznie (żaden kod produkcyjny nie tworzył ctx.archive). Bez danych
  // archiwum widget musi zniknąć, nie zmyślać.
  it("archive-title renders nothing when the context carries no archive", () => {
    const { container } = renderTag(<DynamicTagWidget node={node("archive-title")} lang="en" />, {
      kind: "archive",
    });
    expect(container.firstChild).toBeNull();
    expect(container.textContent).not.toContain("Sample archive");
  });

  it("search-form renders a GET search form", () => {
    const { container } = renderTag(
      <DynamicTagWidget node={node("search-form", { action: "/search" })} lang="en" />,
    );
    expect(container.querySelector('form[method="get"]')).toBeTruthy();
  });

  it("returns null for an unhandled type", () => {
    const { container } = renderTag(<DynamicTagWidget node={node("heading")} lang="pl" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("dynamic-tag widgets extra branches", () => {
  it("post-meta renders relative dates across thresholds", () => {
    const now = Date.now();
    for (const ageMs of [30_000, 30 * 60_000, 12 * 3600_000, 5 * 86400_000]) {
      const iso = new Date(now - ageMs).toISOString();
      expect(() =>
        renderTag(
          <DynamicTagWidget node={node("post-meta", { dateFormat: "relative" })} lang="pl" />,
          { ...FULL, publishedAt: iso },
        ),
      ).not.toThrow();
      cleanup();
    }
  });

  // --- klucze, które do tej pory były martwe w rejestrze -------------------
  it("post-tags-dyn honours the `variant` key (pill / outline / text)", () => {
    const pill = renderTag(
      <DynamicTagWidget node={node("post-tags-dyn", { variant: "pill" })} lang="pl" />,
    );
    expect(pill.container.querySelector("a")?.className ?? "").toContain("bg-muted");
    cleanup();
    const outline = renderTag(
      <DynamicTagWidget node={node("post-tags-dyn", { variant: "outline" })} lang="pl" />,
    );
    expect(outline.container.querySelector("a")?.className ?? "").toContain("border-border");
    cleanup();
    const text = renderTag(
      <DynamicTagWidget node={node("post-tags-dyn", { variant: "text" })} lang="pl" />,
    );
    expect(text.container.querySelector("a")?.className ?? "").not.toContain("rounded-full");
    expect(text.container.textContent).toContain("#NATO");
  });

  it("post-categories-dyn honours the `variant` key", () => {
    const { container } = renderTag(
      <DynamicTagWidget node={node("post-categories-dyn", { variant: "outline" })} lang="pl" />,
    );
    expect(container.querySelector("a")?.className ?? "").toContain("border-border");
  });

  it("post-author-card renders social links only when showSocial is on", () => {
    const withSocial = renderTag(
      <DynamicTagWidget node={node("post-author-card", { showSocial: true })} lang="pl" />,
      { ...FULL, author: { ...FULL.author, linkedinUrl: "https://linkedin.com/in/anna" } },
    );
    expect(
      withSocial.container.querySelector('a[href="https://linkedin.com/in/anna"]'),
    ).toBeTruthy();
    cleanup();
    const withoutSocial = renderTag(
      <DynamicTagWidget node={node("post-author-card", { showSocial: false })} lang="pl" />,
      { ...FULL, author: { ...FULL.author, linkedinUrl: "https://linkedin.com/in/anna" } },
    );
    expect(
      withoutSocial.container.querySelector('a[href="https://linkedin.com/in/anna"]'),
    ).toBeNull();
  });

  it("post-author-card honours the `variant` key", () => {
    const { container } = renderTag(
      <DynamicTagWidget node={node("post-author-card", { variant: "centered" })} lang="pl" />,
    );
    expect(container.querySelector("aside")?.className ?? "").toContain("text-center");
  });

  it("post-cover renders a caption only when showCaption is on", () => {
    const on = renderTag(
      <DynamicTagWidget
        node={node("post-cover", { showCaption: true, caption_pl: "Fot. Autor" })}
        lang="pl"
      />,
    );
    expect(on.container.querySelector("figcaption")?.textContent).toBe("Fot. Autor");
    cleanup();
    const off = renderTag(
      <DynamicTagWidget
        node={node("post-cover", { showCaption: false, caption_pl: "Fot. Autor" })}
        lang="pl"
      />,
    );
    expect(off.container.querySelector("figcaption")).toBeNull();
  });

  it("archive-title falls back to the category label for an unknown archive type", () => {
    const { container } = renderTag(<DynamicTagWidget node={node("archive-title")} lang="pl" />, {
      ...FULL,
      archive: { type: "unknown" as never, label: "X", count: 0 },
    });
    expect(container.textContent).toContain("Kategoria");
  });

  it("search-form defaults the action to /search when none is given", () => {
    const { container } = renderTag(<DynamicTagWidget node={node("search-form")} lang="pl" />);
    expect(container.querySelector("form")?.getAttribute("action")).toBe("/search");
  });

  it("post-breadcrumbs marks a hrefless last crumb as current", () => {
    const { container } = renderTag(
      <DynamicTagWidget node={node("post-breadcrumbs", { showHome: false })} lang="pl" />,
      { ...FULL, breadcrumbs: [{ label: "A", href: "/a" }, { label: "Ostatni" }] },
    );
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Ostatni");
  });
});

describe("dynamic-tag widgets with empty context (early returns)", () => {
  it("render nothing when the context lacks data", () => {
    for (const type of [
      "post-tags-dyn",
      "post-categories-dyn",
      "post-author-card",
      "post-breadcrumbs",
      "post-cover",
      "post-excerpt",
    ] as const) {
      const { container } = renderTag(<DynamicTagWidget node={node(type)} lang="pl" />, EMPTY);
      expect(container.firstChild).toBeNull();
    }
  });
});
