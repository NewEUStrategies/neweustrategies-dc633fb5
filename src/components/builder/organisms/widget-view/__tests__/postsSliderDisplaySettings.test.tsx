// PostsSliderWidget (tryb "posts"): sekcja "Wyświetlanie" panelu musi realnie
// zmieniać wyrenderowany DOM strony publicznej i kanwy.
//
// Regresje przypięte tutaj (wszystkie były martwymi ustawieniami):
//  1. `showTitle` nie było przekazywane do SliderRender - tytuł zawsze widoczny.
//  2. przekazywany był wyłącznie boolean `showAuthor`, więc tryb
//     `authorDisplay="label"` renderował się jak avatar, a etykiety
//     `authorLabel_pl` / `authorLabel_en` nie docierały nigdzie.
//  3. `authorSizePx` / `authorAvatarSizePx` działały WYŁĄCZNIE w podglądzie
//     edytora - kanwa i strona publiczna miały sztywne 12 px / 20 px.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "gte", "lte"])
      b[m] = () => b;
    b.maybeSingle = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: { from: (t: string) => makeBuilder(t), rpc: async () => ({ data: [], error: null }) },
  };
});

vi.mock("@/lib/builder/contentRefs", () => ({ useResolvedPostRefs: () => new Map() }));

import { PostsSliderWidget } from "../PostsSliderWidget";

const POSTS = [
  {
    id: "p1",
    slug: "pierwszy",
    title_pl: "Pierwszy wpis",
    title_en: "First post",
    excerpt_pl: "Zajawka pierwszego",
    excerpt_en: "First excerpt",
    cover_image_url: "https://cdn.example.com/c1.jpg",
    published_at: "2026-01-02T00:00:00Z",
    author_id: "a1",
  },
];

const PROFILES = [
  {
    id: "a1",
    display_name: "Jan Kowalski",
    first_name: null,
    last_name: null,
    avatar_url: "https://cdn.example.com/jan.png",
    slug: null,
  },
];

async function renderPostsSlider(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <PostsSliderWidget
        c={{ source: "posts", variant: "editorial-hero", ...content }}
        lang={lang}
      />
    </QueryClientProvider>,
  );
  // SliderRender jest ładowany leniwie (lazyWidgets), a autorzy dociągani
  // osobnym zapytaniem - czekamy na w pełni złożony slajd.
  await waitFor(() => expect(view.container.querySelector(".eh-slider")).not.toBeNull());
  return view;
}

const authorBadge = (root: HTMLElement): HTMLElement | null =>
  root.querySelector<HTMLElement>("[data-author-byline]");
const authorAvatar = (root: HTMLElement): HTMLImageElement | null =>
  root.querySelector<HTMLImageElement>("[data-author-byline] img");

beforeEach(() => {
  // Autorzy jadą z `profiles_public` - widoku zawężonego do `public_tenant_id()`.
  // Slider NIE czyta już tabeli `profiles`, więc obszar roboczy jednej firmy nie
  // ma jak wciągnąć profilu z obszaru innej.
  db.tables = { posts: POSTS, profiles_public: PROFILES };
});
afterEach(cleanup);

describe("PostsSliderWidget - tytuł slajdu", () => {
  it("renders the post title by default", async () => {
    const { container } = await renderPostsSlider({});
    await waitFor(() => expect(container.textContent).toContain("Pierwszy wpis"));
    expect(container.querySelectorAll("h3.cms-post-title").length).toBeGreaterThan(0);
  });

  it("hides the title heading when showTitle=false", async () => {
    const { container } = await renderPostsSlider({ showTitle: false });
    await waitFor(() =>
      expect(container.querySelector(".eh-slider")?.getAttribute("data-show-title")).toBe("false"),
    );
    expect(container.querySelectorAll("h3.cms-post-title")).toHaveLength(0);
    expect(container.textContent).not.toContain("Pierwszy wpis");
  });

  it('treats the legacy string "0" as false', async () => {
    const { container } = await renderPostsSlider({ showTitle: "0" });
    await waitFor(() =>
      expect(container.querySelector(".eh-slider")?.getAttribute("data-show-title")).toBe("false"),
    );
    expect(container.querySelectorAll("h3.cms-post-title")).toHaveLength(0);
  });
});

describe("PostsSliderWidget - tryb prezentacji autora", () => {
  it("renders the avatar and the plain name by default", async () => {
    const { container } = await renderPostsSlider({});
    await waitFor(() => expect(authorAvatar(container)).not.toBeNull());
    expect(container.textContent).toContain("Jan Kowalski");
    expect(container.textContent).not.toContain("Autor:");
  });

  it("renders the label mode without an avatar", async () => {
    const { container } = await renderPostsSlider({ authorDisplay: "label" });
    await waitFor(() => expect(container.textContent).toContain("Autor: Jan Kowalski"));
    expect(authorAvatar(container)).toBeNull();
    expect(authorBadge(container)?.getAttribute("data-author-byline")).toBe("label");
  });

  it("passes the PL label override through to the rendered text", async () => {
    const { container } = await renderPostsSlider({
      authorDisplay: "label",
      authorLabel_pl: "Redakcja",
      authorLabel_en: "Newsroom",
    });
    await waitFor(() => expect(container.textContent).toContain("Redakcja: Jan Kowalski"));
  });

  it("passes the EN label override when rendering in English", async () => {
    const { container } = await renderPostsSlider(
      { authorDisplay: "label", authorLabel_pl: "Redakcja", authorLabel_en: "Newsroom" },
      "en",
    );
    await waitFor(() => expect(container.textContent).toContain("Newsroom: Jan Kowalski"));
    expect(container.textContent).not.toContain("Redakcja");
  });

  it("hides the author completely in none mode", async () => {
    const { container } = await renderPostsSlider({ authorDisplay: "none" });
    await waitFor(() => expect(container.textContent).toContain("Pierwszy wpis"));
    expect(authorBadge(container)).toBeNull();
    expect(container.textContent).not.toContain("Jan Kowalski");
  });

  it("keeps honouring the legacy showAuthor=false flag", async () => {
    const { container } = await renderPostsSlider({ showAuthor: false });
    await waitFor(() => expect(container.textContent).toContain("Pierwszy wpis"));
    expect(authorBadge(container)).toBeNull();
  });
});

describe("PostsSliderWidget - rozmiary metadanych autora", () => {
  it("keeps the 12px / 20px defaults", async () => {
    const { container } = await renderPostsSlider({});
    await waitFor(() => expect(authorAvatar(container)).not.toBeNull());
    expect(authorAvatar(container)?.getAttribute("width")).toBe("20");
    expect(authorBadge(container)?.style.fontSize).toBe("12px");
  });

  it("applies authorSizePx and authorAvatarSizePx on the canvas / public page", async () => {
    const { container } = await renderPostsSlider({ authorSizePx: 19, authorAvatarSizePx: 41 });
    await waitFor(() => expect(authorAvatar(container)).not.toBeNull());
    expect(authorAvatar(container)?.getAttribute("width")).toBe("41");
    expect(authorAvatar(container)?.style.height).toBe("41px");
    expect(authorBadge(container)?.style.fontSize).toBe("19px");
  });

  it("accepts numeric strings and clamps them", async () => {
    const { container } = await renderPostsSlider({ authorSizePx: "7", authorAvatarSizePx: "33" });
    await waitFor(() => expect(authorAvatar(container)).not.toBeNull());
    expect(authorAvatar(container)?.getAttribute("width")).toBe("33");
    expect(authorBadge(container)?.style.fontSize).toBe("8px");
  });
});

describe("PostsSliderWidget - okładka i zajawka", () => {
  it("marks the slider as cover-less when showCover=false", async () => {
    const { container } = await renderPostsSlider({ showCover: false });
    await waitFor(() =>
      expect(container.querySelector(".eh-slider")?.getAttribute("data-hide-cover")).toBe("true"),
    );
  });

  it("drops the excerpt when showExcerpt=false", async () => {
    const { container } = await renderPostsSlider({ showExcerpt: false });
    await waitFor(() => expect(container.textContent).toContain("Pierwszy wpis"));
    expect(container.textContent).not.toContain("Zajawka pierwszego");
    expect(container.querySelector(".cms-post-excerpt")).toBeNull();
  });

  it("keeps the excerpt visible by default", async () => {
    const { container } = await renderPostsSlider({});
    await waitFor(() => expect(container.textContent).toContain("Zajawka pierwszego"));
  });
});

describe("PostsSliderWidget - granica leniwego chunka", () => {
  it("reads the slider option catalogs from the data-only module", async () => {
    // Renderer slidera (~53 KB) jedzie leniwie przez lazyWidgets. Import stałych
    // wprost z `sliderVariants` wciągnąłby go z powrotem do głównego bundla,
    // więc zawężanie wariantów korzysta z lekkiego `sliderOptions`.
    //
    // Bramka pilnowała `mediaWidgets.tsx`, ale slider wyprowadzono stamtąd do
    // osobnego modułu (podział po typie, 01253dc) - plik nie ma już ani jednego
    // z tych importów, więc asercja przestała cokolwiek chronić i padała na
    // mainie. Sprawdzamy plik, w którym slider faktycznie jest.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      // PostsSlider wyjechal z `mediaWidgets.tsx` do wlasnego leniwego chunka -
      // straznik musi czytac plik, ktory FAKTYCZNIE zawiera zawezanie wariantow.
      resolve(process.cwd(), "src/components/builder/organisms/widget-view/PostsSliderWidget.tsx"),
      "utf8",
    );
    expect(src).toContain('from "@/lib/builder/sliderOptions"');
    const runtimeSliderImport = /import\s+(?!type)[^;]*from\s+"@\/lib\/builder\/sliderVariants"/s;
    expect(runtimeSliderImport.test(src)).toBe(false);
  });
});
