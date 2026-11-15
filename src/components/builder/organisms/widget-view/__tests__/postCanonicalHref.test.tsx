// ADRES WPISU W KARTACH I SLAJDACH: KANONICZNY, NIE `/post/<slug>`.
//
// CO BYŁO. `PostListView` (10 miejsc) i `PostsSliderWidget` składały odnośnik
// jako `/post/<slug>`. Ten adres odpowiada 301 na `/<ścieżka rodzica>/<slug>`,
// więc każde kliknięcie z karty strony głównej płaciło dodatkowy dokument
// i dwa odczyty bazy, a ten sam wpis miał na stronie dwa adresy (archiwa
// linkują `/blog/<slug>`).
//
// CO TEN PLIK PRZYPINA.
//  1. KAŻDY wariant listy i karuzela linkują adresem z `postHref(wiersz)`:
//     `/<rodzic>/<slug>` dla rodzica najwyższego poziomu.
//  2. ZAPAS: wiersz bez rodzica (starszy wpis cache, odczyt bez osadzenia),
//     z rodzicem zagnieżdżonym albo niewidocznym zostaje przy `/post/<slug>`.
//  3. HTML SERWERA = STRONA PO HYDRATACJI: adres pochodzi z wiersza w stanie
//     odwodnionym, więc hydratacja nie zgłasza rozjazdu ani nie zmienia `href`.
//  4. Prefiks języka: widok podaje adres bez prefiksu, jak dla `/post/<slug>`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "gte", "lte"])
      b[m] = () => b;
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: { from: (t: string) => makeBuilder(t), rpc: async () => ({ data: [], error: null }) },
  };
});

vi.mock("@/hooks/usePrefersReducedMotion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));
vi.mock("@/lib/builder/contentRefs", () => ({ useResolvedPostRefs: () => new Map() }));

import { PostListView } from "../PostListView";
import { PostsSliderWidget } from "../PostsSliderWidget";
import { postListQueryOptions, type PostRow } from "@/lib/builder/postListQuery";
import type { PostParentPage } from "@/lib/routing/postHref";
import type { WidgetContent } from "@/lib/builder/types";

const BLOG: PostParentPage = { slug: "blog", parent_id: null };

function post(n: number, parentPage?: PostParentPage | null): Record<string, unknown> {
  return {
    id: `p${n}`,
    slug: `wpis-${n}`,
    title_pl: `Tytuł ${n}`,
    title_en: `Title ${n}`,
    excerpt_pl: `Zajawka ${n}`,
    excerpt_en: `Excerpt ${n}`,
    cover_image_url: `https://cdn.example.com/${n}.jpg`,
    published_at: "2026-01-01T00:00:00Z",
    post_format: null,
    author_id: null,
    ...(parentPage === undefined ? {} : { parent_page: parentPage }),
  };
}

function wrap(ui: ReactElement, qc = new QueryClient()) {
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function hrefsOf(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll("a[href]"), (a) => a.getAttribute("href") ?? "");
}

const VARIANTS = [
  "card",
  "minimal",
  "overlay",
  "list",
  "numbered",
  "ranked",
  "classic",
  "flex-grid",
  "boxed-grid",
  "boxed-list",
] as const;

beforeEach(() => {
  db.tables = {};
});
afterEach(cleanup);

describe("PostListView - adres kanoniczny w każdym wariancie", () => {
  it.each(VARIANTS)("wariant %s: karty linkują /<rodzic>/<slug>, bez /post/", async (variant) => {
    db.tables.posts = [post(1, BLOG), post(2, BLOG), post(3, BLOG), post(4, BLOG)];
    const { container } = render(wrap(<PostListView c={{ variant, limit: 4 }} lang="pl" />));

    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));
    const hrefs = hrefsOf(container);
    expect(new Set(hrefs)).toEqual(
      new Set(["/blog/wpis-1", "/blog/wpis-2", "/blog/wpis-3", "/blog/wpis-4"]),
    );
    expect(container.innerHTML).not.toContain('href="/post/');
  });

  it("karuzela: te same adresy kanoniczne", async () => {
    db.tables.posts = [post(1, BLOG), post(2, { slug: "analizy", parent_id: null })];
    const { container } = render(wrap(<PostListView c={{ variant: "card" }} lang="pl" carousel />));

    await waitFor(() => expect(hrefsOf(container).length).toBeGreaterThan(0));
    expect(new Set(hrefsOf(container))).toEqual(new Set(["/blog/wpis-1", "/analizy/wpis-2"]));
  });

  it("zapas: wiersz bez rodzica, z rodzicem zagnieżdżonym albo niewidocznym zostaje przy /post/", async () => {
    db.tables.posts = [
      // Starszy wpis cache / odczyt zapasowy bez osadzenia.
      post(1),
      // Rodzic zagnieżdżony - pełną ścieżkę policzy 301.
      post(2, { slug: "energetyka", parent_id: "pg-analizy" }),
      // Rodzic niewidoczny dla gościa (szkic, kosz).
      post(3, null),
      post(4, BLOG),
    ];
    const { container } = render(
      wrap(<PostListView c={{ variant: "list", limit: 4 }} lang="pl" />),
    );

    await waitFor(() => expect(hrefsOf(container)).toHaveLength(4));
    expect(hrefsOf(container)).toEqual([
      "/post/wpis-1",
      "/post/wpis-2",
      "/post/wpis-3",
      "/blog/wpis-4",
    ]);
  });

  it("strona EN: adres bez prefiksu języka, dokładnie jak dotąd dla /post/<slug>", async () => {
    db.tables.posts = [post(1, BLOG)];
    const { container } = render(wrap(<PostListView c={{ variant: "list" }} lang="en" />));

    await waitFor(() => expect(hrefsOf(container)).toHaveLength(1));
    expect(hrefsOf(container)).toEqual(["/blog/wpis-1"]);
  });
});

describe("PostListView - HTML serwera równy stronie po hydratacji", () => {
  it("adres z wiersza w stanie odwodnionym: hydratacja bez rozjazdu i bez zmiany href", async () => {
    const content: WidgetContent = { variant: "list", limit: 3 };
    const rows = [
      post(1, BLOG),
      post(2, { slug: "energetyka", parent_id: "pg-analizy" }),
      post(3, BLOG),
    ] as unknown as PostRow[];
    // Serwer: zapytanie rozstrzygnięte przed renderem (prefetch sekcji).
    const serverClient = new QueryClient();
    serverClient.setQueryData(postListQueryOptions(content, "pl", "list").queryKey, rows);
    const element = <PostListView c={content} lang="pl" />;
    const html = renderToString(wrap(element, serverClient));
    expect(html).toContain('href="/blog/wpis-1"');
    expect(html).toContain('href="/post/wpis-2"');

    // Klient: ten sam stan po odwodnieniu i nawodnieniu.
    const clientClient = new QueryClient();
    hydrate(clientClient, dehydrate(serverClient));
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const serverHrefs = hrefsOf(container);
    const errors: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(container, wrap(element, clientClient), {
        onRecoverableError: (error) => errors.push(error),
      });
    });

    expect(errors).toEqual([]);
    expect(hrefsOf(container)).toEqual(serverHrefs);
    expect(serverHrefs).toEqual(["/blog/wpis-1", "/post/wpis-2", "/blog/wpis-3"]);
    await act(async () => root.unmount());
    container.remove();
  });
});

describe("PostsSliderWidget - slajd linkuje adresem kanonicznym", () => {
  async function renderSlider(posts: Array<Record<string, unknown>>) {
    db.tables.posts = posts;
    const view = render(
      wrap(<PostsSliderWidget c={{ source: "posts", variant: "editorial-hero" }} lang="pl" />),
    );
    // `SliderRender` jest leniwym chunkiem - pierwszy render w pliku płaci za import.
    await waitFor(() => expect(view.container.querySelector(".eh-slider")).not.toBeNull(), {
      timeout: 15_000,
    });
    await waitFor(() => expect(hrefsOf(view.container).length).toBeGreaterThan(0));
    return view;
  }

  it("rodzic najwyższego poziomu: /<rodzic>/<slug>", async () => {
    const { container } = await renderSlider([post(1, BLOG)]);

    expect(new Set(hrefsOf(container))).toEqual(new Set(["/blog/wpis-1"]));
    expect(container.innerHTML).not.toContain('href="/post/');
  });

  it("wiersz bez rodzica: adres zapasowy /post/<slug>", async () => {
    const { container } = await renderSlider([post(1)]);

    expect(new Set(hrefsOf(container))).toEqual(new Set(["/post/wpis-1"]));
  });
});
