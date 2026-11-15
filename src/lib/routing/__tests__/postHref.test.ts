// Adres wpisu liczony z wiersza (`postHref`) - co dowodzi ten plik.
//
// 1. ZGODNOŚĆ Z BAZĄ. Adres kanoniczny to `/<page_full_path(rodzic)>/<slug>`.
//    Funkcja SQL (migracja 20260831160000) skleja slugi od korzenia do strony;
//    dla strony BEZ rodzica wynik to sam jej `slug`. Tylko ten przypadek liczy
//    się z jednego osadzonego wiersza i tylko on daje tu adres kanoniczny.
// 2. BEZPIECZNY ZAPAS. Wszystko inne - rodzic zagnieżdżony, rodzic niewidoczny
//    dla gościa (`null`), wiersz bez pola (starszy wpis cache, odczyt zapasowy
//    bez osadzenia), nieoczekiwany kształt - daje `/post/<slug>`, czyli adres,
//    pod którym trasa `/post/$slug` policzy ścieżkę w bazie i odpowie 301.
//    Zły adres kanoniczny to 404 na karcie strony głównej; zapas to najwyżej
//    jeden skok więcej.
// 3. KSZTAŁT OSADZENIA. Literał `select` wskazuje klucz obcy po nazwie i niesie
//    DOKŁADNIE dwa pola, z których `postHref` czyta adres.
import { describe, expect, it } from "vitest";
import {
  POST_PARENT_PAGE_EMBED,
  postColumnsWithParentPage,
  postHref,
  type PostHrefSource,
} from "../postHref";

describe("postHref", () => {
  it("rodzic najwyższego poziomu: /<slug rodzica>/<slug wpisu>", () => {
    expect(postHref({ slug: "atom", parent_page: { slug: "blog", parent_id: null } })).toBe(
      "/blog/atom",
    );
    expect(
      postHref({ slug: "raport-2026", parent_page: { slug: "analizy", parent_id: null } }),
    ).toBe("/analizy/raport-2026");
  });

  it("rodzic zagnieżdżony: zapas (pełnej ścieżki nie da się policzyć z jednego wiersza)", () => {
    expect(
      postHref({ slug: "atom", parent_page: { slug: "energetyka", parent_id: "page-analizy" } }),
    ).toBe("/post/atom");
  });

  it("rodzic niewidoczny dla gościa (osadzenie oddało null): zapas", () => {
    expect(postHref({ slug: "atom", parent_page: null })).toBe("/post/atom");
  });

  it("wiersz bez pola (starszy wpis cache, odczyt bez osadzenia): zapas", () => {
    expect(postHref({ slug: "atom" })).toBe("/post/atom");
  });

  it.each<[string, unknown]>([
    ["parent_id nieobecne (osadzenie bez tej kolumny)", { slug: "blog" }],
    ["parent_id undefined", { slug: "blog", parent_id: undefined }],
    ["pusty slug rodzica", { slug: "", parent_id: null }],
    ["slug rodzica nie jest napisem", { slug: 7, parent_id: null }],
    ["tablica zamiast obiektu", [{ slug: "blog", parent_id: null }]],
    ["napis zamiast obiektu", "blog"],
  ])("nieoczekiwany kształt rodzica (%s): zapas, nigdy zgadywany adres", (_label, parent) => {
    const row = { slug: "atom", parent_page: parent } as unknown as PostHrefSource;
    expect(postHref(row)).toBe("/post/atom");
  });

  it("nie dokłada prefiksu języka - to sprawa wołającego", () => {
    expect(postHref({ slug: "atom", parent_page: { slug: "blog", parent_id: null } })).not.toMatch(
      /^\/(pl|en)\//,
    );
  });

  it("czyta wyłącznie `slug` i `parent_page` - reszta wiersza nie ma wpływu", () => {
    const row = {
      id: "p1",
      slug: "atom",
      title_pl: "Atom",
      parent_page_id: "page-blog",
      parent_page: { slug: "blog", parent_id: null },
    };
    expect(postHref(row)).toBe("/blog/atom");
  });
});

describe("POST_PARENT_PAGE_EMBED", () => {
  it("osadza `pages` po kluczu obcym wpisu, pod kluczem `parent_page`, z polami adresu", () => {
    // Literówka w nazwie osadzenia nie jest błędem kompilacji (patrz uwaga
    // w `lib/queries/taxonomyPivot.ts`) - jedyną obroną jest dosłowny napis.
    expect(POST_PARENT_PAGE_EMBED).toBe(
      "parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)",
    );
  });
});

describe("postColumnsWithParentPage", () => {
  it("dokleja osadzenie jako OSTATNIĄ pozycję `select`, po przecinku i spacji", () => {
    // Dosłowny napis: to jest `select`, który idzie do PostgREST z każdego
    // zapytania korzystającego z pomocnika.
    expect(postColumnsWithParentPage("id, slug, title_pl")).toBe(
      "id, slug, title_pl, parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)",
    );
  });

  it("kolumn wołającego nie zmienia (osadzenia w nawiasach też nie)", () => {
    const columns = "id, slug, post_categories!inner(category_id)";
    expect(postColumnsWithParentPage(columns)).toBe(`${columns}, ${POST_PARENT_PAGE_EMBED}`);
  });
});
