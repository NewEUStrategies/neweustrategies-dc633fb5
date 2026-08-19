// PostListView: warianty układu, których gałęzie nie były domknięte -
// classic (okładka + tytuł + zajawka w pionie), flex-grid (duży lead +
// kompaktowe wiersze z numeracją przy braku okładki), boxed-list (karta
// pozioma z/bez okładki), overlay (byline w tonie onDark), tryb etykiety
// autora ("Autor: X"), typografia współdzielona tytułu/zajawki oraz
// globalne przełączniki showTitle/showExcerpt/showCover.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

// Rejestr leniwych widgetow -> lustro eager: `post-list` jedzie przez React.lazy
// od 2026-08-15, wiec bez podmiany warianty renderuja fallback Suspense.
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

// Podział kodu (React.lazy) zamieniony na importy statyczne. Bez tego pierwszy
// render widgetu z rejestru pokazuje fallback Suspense, który na stronie
// publicznej jest `null` - test widzi PUSTKĘ i uznaje każde ustawienie za
// martwe. Ten sam mock mają siostrzane pliki (np. `widgetBehavior.test.tsx`);
// tutaj zabrakło go po przeniesieniu widgetów do rejestru leniwego (01253dc).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

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
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { PostListView } from "../PostListView";
import type { WidgetContent } from "@/lib/builder/types";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Wiersze niosą author_display_name wprost (dla wariantów bez bylines
// zapytanie nie dociąga profili, a AuthorMeta renderuje to, co dostanie).
const post = (over: Record<string, unknown> = {}) => ({
  id: `p-${Math.random().toString(36).slice(2, 8)}`,
  slug: "wpis",
  title_pl: "Tytuł PL",
  title_en: "Title EN",
  excerpt_pl: "Zajawka PL",
  excerpt_en: "Excerpt EN",
  cover_image_url: "https://cdn.example.com/cover.jpg",
  published_at: "2026-01-01T00:00:00Z",
  post_format: null,
  author_id: "a1",
  author_display_name: "Anna Autorka",
  author_avatar_url: null,
  author_slug: "anna",
  ...over,
});

function renderList(c: WidgetContent, extra: { lang?: "pl" | "en"; typography?: object } = {}) {
  return wrap(
    <PostListView c={c} lang={extra.lang ?? "pl"} typography={extra.typography as never} />,
  );
}

beforeEach(() => {
  db.tables = {};
});
afterEach(cleanup);

describe("PostListView - wariant classic", () => {
  it("stacks cover, headline, excerpt and byline vertically", async () => {
    db.tables.posts = [post({ id: "c1" }), post({ id: "c2", cover_image_url: null })];
    const { container } = renderList({ variant: "classic" });

    expect(await screen.findAllByText("Tytuł PL")).toHaveLength(2);
    expect(screen.getAllByText("Zajawka PL")).toHaveLength(2);
    expect(screen.getAllByText("Anna Autorka")).toHaveLength(2);
    // Placeholder avatara (brak author_avatar_url) - kwadracik bg-muted.
    expect(container.querySelectorAll("span[aria-hidden].bg-muted").length).toBeGreaterThan(0);
  });
});

describe("PostListView - wariant flex-grid", () => {
  it("renders the lead with cover and numbers the coverless side rows", async () => {
    db.tables.posts = [
      post({ id: "f1", title_pl: "Lead artykuł" }),
      post({ id: "f2", title_pl: "Boczny z okładką" }),
      post({ id: "f3", title_pl: "Boczny bez okładki", cover_image_url: null }),
    ];
    const { container } = renderList({ variant: "flex-grid" });

    expect(await screen.findByText("Lead artykuł")).toBeInTheDocument();
    expect(screen.getByText("Boczny z okładką")).toBeInTheDocument();
    // Wiersz bez okładki dostaje numer porządkowy 02.
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(container.querySelector("ol")).not.toBeNull();
  });

  it("renders a coverless lead without the media frame", async () => {
    db.tables.posts = [post({ id: "f4", title_pl: "Goły lead", cover_image_url: null })];
    const { container } = renderList({ variant: "flex-grid" });
    expect(await screen.findByText("Goły lead")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("PostListView - wariant boxed-list", () => {
  it("renders horizontal cards with and without covers in a grid", async () => {
    db.tables.posts = [
      post({ id: "b1", title_pl: "Karta z okładką" }),
      post({ id: "b2", title_pl: "Karta bez okładki", cover_image_url: null }),
    ];
    const { container } = renderList({
      variant: "boxed-list",
      columns: 2,
      mobileHorizontalScroll: "1",
    });

    expect(await screen.findByText("Karta z okładką")).toBeInTheDocument();
    expect(screen.getByText("Karta bez okładki")).toBeInTheDocument();
    const grid = container.querySelector("[data-widget-grid]") as HTMLElement;
    expect(grid.className).toContain("cms-mobile-hscroll");
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });
});

describe("PostListView - overlay i tryby autora", () => {
  it("renders the onDark byline with the author label mode", async () => {
    db.tables.posts = [post({ id: "o1" })];
    const { container } = renderList({
      variant: "overlay",
      authorDisplay: "label",
      authorLabel_pl: "Autorka",
    });

    expect(await screen.findByText("Anna Autorka")).toBeInTheDocument();
    // Tryb label: prefiks "Autorka:" zamiast avatara, ton onDark.
    expect(screen.getByText("Autorka:")).toBeInTheDocument();
    expect(screen.getByText("Autorka:").className).toContain("text-white/70");
    expect(container.querySelector("img[width='20']")).toBeNull();
  });

  it("legacy showAuthorAvatar=0/showAuthorLabel=0 hides the byline entirely", async () => {
    db.tables.posts = [post({ id: "o2" })];
    renderList({ variant: "list", showAuthorAvatar: "0", showAuthorLabel: "0" });
    expect(await screen.findByText("Tytuł PL")).toBeInTheDocument();
    expect(screen.queryByText("Anna Autorka")).not.toBeInTheDocument();
  });

  it("renders the author avatar image when the row carries one", async () => {
    db.tables.posts = [post({ id: "o3", author_avatar_url: "https://cdn.example.com/anna.png" })];
    const { container } = renderList({ variant: "list" });
    await screen.findByText("Anna Autorka");
    expect(container.querySelector('img[src="https://cdn.example.com/anna.png"]')).not.toBeNull();
  });
});

describe("PostListView - globalne przełączniki i typografia", () => {
  it("hides titles, excerpts and covers when the global switches are off", async () => {
    db.tables.posts = [post({ id: "g1" })];
    const { container } = renderList({
      variant: "card",
      showTitle: "0",
      showExcerpt: "0",
      showCover: "0",
    });

    await waitFor(() => expect(container.querySelector("a")).not.toBeNull());
    expect(screen.queryByText("Tytuł PL")).not.toBeInTheDocument();
    expect(screen.queryByText("Zajawka PL")).not.toBeInTheDocument();
    expect(container.querySelector("img[src*='cover']")).toBeNull();
  });

  it("applies shared typography plus per-part weights to title and excerpt", async () => {
    db.tables.posts = [post({ id: "t1" })];
    renderList(
      { variant: "minimal", titleWeight: "900", excerptWeight: "300" },
      {
        typography: {
          fontFamily: "Georgia",
          fontStyle: "italic",
          textAlign: "center",
          textTransform: "uppercase",
          textDecoration: "underline",
          lineHeight: 1.4,
          letterSpacing: "0.05em",
          fontWeight: 500,
          titleDescriptionGapPx: 12,
        },
      },
    );

    // Tytuł jedzie w <TitleSpan> WEWNĄTRZ <h4 class="cms-post-title">, a
    // typografia współdzielona siedzi na tym <h4> (span dziedziczy ją
    // kaskadą). `findByText` zwraca najgłębszy element z tekstem, czyli
    // span - stąd odczyt stylu z nagłówka, nie z trafienia po tekście.
    const titleSpan = await screen.findByText("Tytuł PL");
    const title = titleSpan.closest("h4") as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.style.fontFamily).toBe("Georgia");
    expect(title.style.fontStyle).toBe("italic");
    expect(title.style.textTransform).toBe("uppercase");
    // Waga per-part wygrywa nad typografią współdzieloną.
    expect(title!.style.fontWeight).toBe("900");
    const excerpt = screen.getByText("Zajawka PL");
    expect(excerpt.style.fontWeight).toBe("300");
    expect(excerpt.style.marginTop).toBe("12px");
  });

  it("falls back to the untitled placeholder when both titles are empty (EN)", async () => {
    db.tables.posts = [post({ id: "u1", title_pl: null, title_en: null, excerpt_en: null })];
    renderList({ variant: "list" }, { lang: "en" });
    expect(await screen.findByText("(untitled)")).toBeInTheDocument();
  });
});

describe("PostListView - ranked/numbered dodatkowe osie", () => {
  it("ranked: left-side middle-aligned index with explicit opacity", async () => {
    db.tables.posts = [post({ id: "r1" })];
    db.tables.profiles_public = [
      { id: "a1", display_name: "Anna Autorka", avatar_url: null, slug: "anna" },
    ];
    const { container } = renderList({
      variant: "ranked",
      indexSide: "left",
      indexVAlign: "middle",
      indexOpacity: 0.5,
      indexColor: "#101010",
      indexColorDark: "#efefef",
      indexWeight: "700",
    });

    await screen.findByText("Tytuł PL");
    const idx = container.querySelector(".post-list-numbered-index") as HTMLElement;
    expect(idx.style.left).toBe("0px");
    expect(idx.style.top).toBe("50%");
    const shell = container.querySelector(
      ".post-list-numbered-shell + *, .post-list-numbered-shell > div.relative",
    ) as HTMLElement;
    expect(shell.className).toContain("pl-10");
  });

  it("numbered: bottom-aligned index and hidden excerpt", async () => {
    db.tables.posts = [post({ id: "n1" })];
    db.tables.profiles_public = [
      { id: "a1", display_name: "Anna Autorka", avatar_url: null, slug: "anna" },
    ];
    const { container } = renderList({
      variant: "numbered",
      indexVAlign: "bottom",
      showExcerpt: "0",
    });

    await screen.findByText("Tytuł PL");
    const idx = container.querySelector(".post-list-numbered-index") as HTMLElement;
    expect(idx.style.bottom).toBe("0px");
    expect(screen.queryByText("Zajawka PL")).not.toBeInTheDocument();
  });
});
