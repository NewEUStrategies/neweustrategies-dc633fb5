// Organizmy renderera: kontenery rekurencyjne (kolumny / grupa / wiersz /
// stos / siatka) oraz adaptery bloków dynamicznych i kontekstu wpisu.
//
// Co dowodzimy i dlaczego:
//   * kontenery renderują dzieci przez PEŁNEGO dyspozytora (ukryte dziecko
//     znika, kolejność zostaje), a odstęp / kolumny są przycinane do zakresów;
//   * bloki dynamiczne nie montują widoku bez wymaganych danych (live blog bez
//     `postId`, ankieta bez identyfikatora) - inaczej subskrypcja realtime albo
//     zapytanie poleciałyby z pustym kluczem;
//   * wartości wyliczeniowe (`layout`, `strategy`, `direction`, `variant`…)
//     spoza zbioru opcji wracają do domyślnych, liczby są przycinane, a źródło
//     autora (inline vs profil) wybiera DOKŁADNIE jedno z dwóch wejść widoku.
//
// Granice: widoki danych (każdy czyta swoje zapytania i ma własne testy)
// zastępujemy rejestratorami propsów - test nie dotyka Supabase ani
// react-query. Dyspozytor, atomy-dzieci i i18n są prawdziwe.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Block, Json } from "@/lib/blocks/types";

const seen = vi.hoisted(() => {
  const calls = new Map<string, Record<string, unknown>>();
  const stub = (name: string) => (props: Record<string, unknown>) => {
    calls.set(name, props);
    return null;
  };
  const stubs = (...names: string[]) => Object.fromEntries(names.map((n) => [n, stub(n)]));
  return { calls, stubs };
});

vi.mock("../../ContextBlockViews", () =>
  seen.stubs(
    "PostTitleView",
    "PostDateView",
    "PostAuthorView",
    "PostExcerptView",
    "PostFeaturedImageView",
    "PostTermsView",
    "SiteTitleView",
    "SiteTaglineView",
    "SiteLogoView",
  ),
);
vi.mock("../../NavLoopViews", () =>
  seen.stubs("NavigationView", "PostNavigationLinkView", "QueryLoopView"),
);
vi.mock("../../PostUtilityViews", () =>
  seen.stubs("BreadcrumbsView", "ReadingTimeView", "ShareButtonsView", "PostViewsView"),
);
vi.mock("../../PostContextViews", () => seen.stubs("AuthorBioView", "RelatedPostsView"));
vi.mock("../../FoxizExtraViews", () =>
  seen.stubs("PostStatsView", "PostRatingView", "LoginOutView", "MorePostsView"),
);
vi.mock("../../LatestPostsView", () => seen.stubs("LatestPostsView"));
vi.mock("../../TaxonomyListView", () => seen.stubs("TaxonomyListView"));
vi.mock("../../TagCloudView", () => seen.stubs("TagCloudView"));
vi.mock("../lazyBlockViews", () =>
  seen.stubs(
    "LiveBlogBlock",
    "PollBlockView",
    "CalendarView",
    "ChartBlockView",
    "DataMapBlockView",
    "NewsletterForm",
    "ContactFormView",
    "LoginFormView",
    "RegisterFormView",
    "LostPasswordFormView",
    "ResetPasswordFormView",
  ),
);

import { BlockView } from "../registry";

function draw(type: string, data: Record<string, Json>, postId?: string) {
  const block = { id: "b1", type, data } as Block;
  return render(
    <BlockView block={block} fnHtml={new Map()} lang="en" postId={postId} allBlocks={[block]} />,
  );
}

function propsOf(type: string, data: Record<string, Json>, view: string, postId?: string) {
  draw(type, data, postId);
  const props = seen.calls.get(view);
  if (!props) throw new Error(`widok ${view} nie został wyrenderowany dla bloku ${type}`);
  return props;
}

const para = (id: string, text: string, hidden = false): Json => ({
  id,
  type: "paragraph",
  data: { html: `<p>${text}</p>` },
  ...(hidden ? { style: { hidden: true } } : {}),
});

beforeEach(() => {
  seen.calls.clear();
});

describe("kontenery", () => {
  it("kolumny renderują lewą i prawą stronę w kolejności, bez ukrytych dzieci", () => {
    const { container } = draw("columns", {
      left: [para("l1", "Lewa A"), para("l2", "Lewa B")],
      right: [para("r1", "Ukryta", true), para("r2", "Prawa"), "nie-blok"],
    });
    const [left, right] = Array.from(container.firstElementChild?.children ?? []);
    expect(left.textContent).toBe("Lewa ALewa B");
    expect(right.textContent).toBe("Prawa");
  });

  it("grupa przycina odstęp do 0-120 px, ustawia tło i renderuje dzieci", () => {
    const { container, unmount } = draw("group", {
      background: "#f5f5f5",
      padding: 500,
      layout: "row",
      children: [para("c1", "Dziecko")],
    });
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.padding).toBe("120px");
    expect(box.style.backgroundColor).toBe("#f5f5f5");
    expect(box.textContent).toBe("Dziecko");
    unmount();

    const neg = draw("group", { padding: -3, layout: "grid" });
    const negBox = neg.container.firstElementChild as HTMLElement;
    expect(negBox.style.padding).toBe("0px");
    expect(negBox.style.backgroundColor).toBe("");
  });

  it("wiersz / stos nie ustawiają zerowego odstępu i renderują dzieci w kolejności", () => {
    for (const type of ["row", "stack"]) {
      const { container, unmount } = draw(type, {
        children: [para("a", "Pierwszy"), para("b", "Drugi")],
      });
      const box = container.firstElementChild as HTMLElement;
      expect(box.getAttribute("style")).toBeNull();
      expect(box.textContent).toBe("PierwszyDrugi");
      unmount();
    }
    const padded = draw("stack", { padding: 24, background: "#000" });
    expect((padded.container.firstElementChild as HTMLElement).style.padding).toBe("24px");
  });

  it("NAPRAWIONE 2026-10-18: siatka dostaje literalną klasę kolumn 1-6, także dla ułamka", () => {
    // Klasa `lg:grid-cols-N` JEST tu kontraktem układu: Tailwind generuje tylko
    // literały widoczne w źródle. Przed poprawką „2.5" dawało nieistniejącą
    // klasę `lg:grid-cols-2.5` (siatka spadała do 2 kolumn).
    const cols = (columns: Json) => {
      const { container, unmount } = draw("grid", { columns });
      const token = (container.firstElementChild?.className ?? "")
        .split(/\s+/)
        .find((c) => c.startsWith("lg:grid-cols-"));
      unmount();
      return token;
    };
    expect([cols(2.5), cols(99), cols(0), cols("4"), cols("x")]).toEqual([
      "lg:grid-cols-3",
      "lg:grid-cols-6",
      "lg:grid-cols-1",
      "lg:grid-cols-4",
      "lg:grid-cols-3",
    ]);
  });
});

describe("bloki dynamiczne nie startują bez wymaganych danych", () => {
  it("live blog bez `postId` nie montuje widoku; z nim przekazuje opcje i blok", () => {
    draw("liveblog", { title: "Relacja" });
    expect(seen.calls.has("LiveBlogBlock")).toBe(false);
    expect(propsOf("liveblog", { title: "" }, "LiveBlogBlock", "post-9")).toMatchObject({
      postId: "post-9",
      blockId: "b1",
      lang: "en",
      title: undefined,
      reverseChronological: true,
      autoRefresh: true,
    });
    expect(
      propsOf(
        "liveblog",
        { reverseChronological: false, autoRefresh: false },
        "LiveBlogBlock",
        "p",
      ),
    ).toMatchObject({ reverseChronological: false, autoRefresh: false });
  });

  it("ankieta przycina identyfikator i bez niego nie montuje widoku", () => {
    draw("poll", { pollId: "   " });
    expect(seen.calls.has("PollBlockView")).toBe(false);
    expect(propsOf("poll", { pollId: "  poll-1 " }, "PollBlockView")).toEqual({
      pollId: "poll-1",
      lang: "en",
    });
  });
});

describe("adaptery list treści i taksonomii", () => {
  it("najnowsze wpisy: liczba przycięta do 1-50, układ list|grid", () => {
    expect(
      propsOf("latest-posts", { count: 500, layout: "grid" }, "LatestPostsView"),
    ).toMatchObject({
      count: 50,
      layout: "grid",
      showImage: true,
      showExcerpt: false,
      category: "",
    });
    expect(
      propsOf("latest-posts", { count: -1, layout: "kafelki" }, "LatestPostsView"),
    ).toMatchObject({ count: 1, layout: "list" });
  });

  it("chmura tagów, kategorie, archiwa i kalendarz dostają opcje z bloku", () => {
    expect(propsOf("tag-cloud", { count: "12", showCount: true }, "TagCloudView")).toEqual({
      count: 12,
      showCount: true,
      lang: "en",
    });
    expect(propsOf("categories-list", { layout: "dropdown" }, "TaxonomyListView")).toMatchObject({
      kind: "categories",
      layout: "dropdown",
      showCount: false,
    });
    expect(
      propsOf("archives", { layout: "accordion", showCount: true }, "TaxonomyListView"),
    ).toMatchObject({ kind: "archives", layout: "list", showCount: true });
    expect(propsOf("calendar", { month: "2026-10" }, "CalendarView")).toEqual({
      month: "2026-10",
      lang: "en",
    });
  });

  it("pętla zapytania i powiązane / kolejne wpisy normalizują układ i strategię", () => {
    expect(
      propsOf("query-loop", { layout: "masonry", orderBy: "views", limit: "9" }, "QueryLoopView"),
    ).toMatchObject({ layout: "grid", orderBy: "date", limit: 9, showExcerpt: true });
    expect(
      propsOf("query-loop", { layout: "list", orderBy: "title" }, "QueryLoopView"),
    ).toMatchObject({ layout: "list", orderBy: "title" });
    expect(
      propsOf("related-posts", { strategy: "random", layout: "carousel" }, "RelatedPostsView"),
    ).toMatchObject({ strategy: "category", layout: "grid", limit: 3 });
    for (const strategy of ["tag", "author", "latest"]) {
      expect(propsOf("related-posts", { strategy }, "RelatedPostsView").strategy).toBe(strategy);
    }
    for (const layout of ["list", "compact"]) {
      expect(propsOf("related-posts", { layout }, "RelatedPostsView").layout).toBe(layout);
    }
    expect(propsOf("more-posts", { strategy: "popular" }, "MorePostsView")).toMatchObject({
      strategy: "latest",
      limit: 4,
    });
    for (const strategy of ["trending", "category"]) {
      expect(propsOf("more-posts", { strategy }, "MorePostsView").strategy).toBe(strategy);
    }
  });
});

describe("adaptery kontekstu wpisu i witryny", () => {
  it("biografia autora: źródło inline wymaga nazwy, inaczej idzie identyfikator profilu", () => {
    const inline = { name: "Anna Nowak", bio: "Analityczka" };
    const viaInline = propsOf(
      "author-bio",
      { authorSource: "inline", inlineAuthor: inline, authorId: "u-1" },
      "AuthorBioView",
    );
    expect(viaInline).toMatchObject({ authorOverride: inline, authorId: undefined });

    const noName = propsOf(
      "author-bio",
      { authorSource: "inline", inlineAuthor: { bio: "bez nazwy" }, authorId: "u-1" },
      "AuthorBioView",
    );
    expect(noName).toMatchObject({ authorOverride: undefined, authorId: "u-1" });

    const arrayAuthor = propsOf(
      "author-bio",
      { authorSource: "inline", inlineAuthor: ["Anna"], authorId: "" },
      "AuthorBioView",
    );
    expect(arrayAuthor).toMatchObject({ authorOverride: undefined, authorId: undefined });
  });

  it("biografia autora: wariant spoza zbioru -> card; styl profilu tylko dla „profile”", () => {
    expect(propsOf("author-bio", { variant: "hero" }, "AuthorBioView")).toMatchObject({
      variant: "card",
      profileStyle: undefined,
      showAvatar: true,
      showSocial: true,
      showPostsCount: true,
    });
    for (const variant of ["inline", "minimal", "split"]) {
      expect(propsOf("author-bio", { variant }, "AuthorBioView").variant).toBe(variant);
    }
    const profile = propsOf(
      "author-bio",
      { variant: "profile", socialStyle: "outline" },
      "AuthorBioView",
    );
    expect(profile.variant).toBe("profile");
    expect(profile.profileStyle).toMatchObject({ socialStyle: "outline" });
  });

  it("udostępnianie: lista sieci tylko z tablicy, wariant spoza zbioru -> filled", () => {
    expect(propsOf("share-buttons", { networks: "x,linkedin" }, "ShareButtonsView")).toMatchObject({
      networks: undefined,
      variant: "filled",
    });
    expect(
      propsOf(
        "share-buttons",
        { networks: ["x", 5, "linkedin"], variant: "ghost" },
        "ShareButtonsView",
      ),
    ).toMatchObject({ networks: ["x", "linkedin"], variant: "ghost" });
    expect(propsOf("share-buttons", { variant: "outline" }, "ShareButtonsView").variant).toBe(
      "outline",
    );
  });

  it("nawigacja wpisu, terminy i statystyki normalizują kierunek, taksonomię i pozycje", () => {
    expect(
      propsOf("post-navigation-link", { direction: "up" }, "PostNavigationLinkView"),
    ).toMatchObject({ direction: "next", showTitle: true });
    expect(
      propsOf("post-navigation-link", { direction: "prev" }, "PostNavigationLinkView").direction,
    ).toBe("prev");
    expect(propsOf("post-terms", { taxonomy: "authors" }, "PostTermsView").taxonomy).toBe(
      "categories",
    );
    expect(propsOf("post-terms", { taxonomy: "tags" }, "PostTermsView").taxonomy).toBe("tags");
    expect(propsOf("post-stats", { items: "views" }, "PostStatsView")).toMatchObject({
      items: undefined,
      separator: "•",
    });
    expect(
      propsOf("post-stats", { items: ["views", null, "date"] }, "PostStatsView").items,
    ).toEqual(["views", "date"]);
  });

  it("pozostałe bloki kontekstu dostają domyślne wartości z bloku i język", () => {
    expect(propsOf("post-title", {}, "PostTitleView")).toMatchObject({ level: 1, lang: "en" });
    expect(propsOf("post-date", { showUpdated: true }, "PostDateView")).toMatchObject({
      format: "long",
      showUpdated: true,
    });
    expect(propsOf("post-author", {}, "PostAuthorView")).toMatchObject({
      showAvatar: true,
      showBio: false,
    });
    expect(propsOf("post-excerpt", { showMore: true }, "PostExcerptView").showMore).toBe(true);
    expect(propsOf("post-featured-image", {}, "PostFeaturedImageView")).toMatchObject({
      aspect: "16/9",
      rounded: true,
    });
    expect(propsOf("site-title", { level: "2" }, "SiteTitleView").level).toBe(2);
    expect(propsOf("site-tagline", {}, "SiteTaglineView")).toHaveProperty("cls");
    expect(propsOf("site-logo", { width: "abc" }, "SiteLogoView").width).toBe(120);
    expect(propsOf("navigation", {}, "NavigationView")).toMatchObject({
      menuKey: "primary",
      layout: "horizontal",
    });
    expect(propsOf("breadcrumbs", { showHome: false }, "BreadcrumbsView")).toMatchObject({
      separator: "/",
      showHome: false,
    });
    expect(propsOf("reading-time", { wpm: "300" }, "ReadingTimeView")).toMatchObject({
      wpm: 300,
      prefix: "",
    });
    expect(propsOf("post-views", { suffix: "odsłon" }, "PostViewsView").suffix).toBe("odsłon");
    expect(propsOf("post-rating", { max: 10 }, "PostRatingView")).toMatchObject({
      max: 10,
      label: "",
    });
    expect(propsOf("loginout", {}, "LoginOutView")).toMatchObject({
      loginHref: "/auth",
      showAvatar: true,
    });
  });
});
