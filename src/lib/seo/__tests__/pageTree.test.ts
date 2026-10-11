import { describe, expect, it } from "vitest";
import {
  buildPageTree,
  countPageTreeNodes,
  pageTreePaths,
  planSiteMap,
  postCanonicalPath,
  withoutPageTreeNodes,
  type PageTreeNode,
  type PageTreeRow,
} from "@/lib/seo/pageTree";

const row = (partial: Partial<PageTreeRow> & Pick<PageTreeRow, "id" | "slug">): PageTreeRow => ({
  title_pl: partial.slug,
  title_en: partial.slug,
  parent_id: null,
  menu_order: 0,
  ...partial,
});

describe("buildPageTree", () => {
  it("nests children and derives canonical paths from the parent chain", () => {
    const tree = buildPageTree([
      row({ id: "a", slug: "analizy" }),
      row({ id: "b", slug: "raporty", parent_id: "a" }),
      row({ id: "c", slug: "2026", parent_id: "b" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.path).toBe("/analizy");
    expect(tree[0]?.children[0]?.path).toBe("/analizy/raporty");
    expect(tree[0]?.children[0]?.children[0]?.path).toBe("/analizy/raporty/2026");
    expect(countPageTreeNodes(tree)).toBe(3);
  });

  it("orders siblings by menu_order, then by localized title", () => {
    const tree = buildPageTree([
      row({ id: "1", slug: "zeta", menu_order: 0, title_pl: "Zeta" }),
      row({ id: "2", slug: "alfa", menu_order: 0, title_pl: "Alfa" }),
      row({ id: "3", slug: "pierwsza", menu_order: -1, title_pl: "Pierwsza" }),
    ]);
    expect(tree.map((n) => n.slug)).toEqual(["pierwsza", "alfa", "zeta"]);
  });

  // ZMIANA ZACHOWANIA (2026-10 audyt mapy HTML). Ten test pilnował dawniej
  // PROMOCJI sieroty do korzenia („poddrzewo zostaje odnajdywalne"). Tyle że
  // `resolve_path` wymaga opublikowanej strony na KAŻDYM poziomie ścieżki,
  // więc sierota nie ma żadnego działającego adresu, a promocja wymyślała jej
  // `/<slug>`: pięć stron `test-*` pod nieopublikowanym rodzicem dawało na
  // produkcji 10 linków (PL+EN) na 404. Teraz sierota wypada razem z poddrzewem.
  it("drops orphans (excluded/unpublished parent) with their whole subtree", () => {
    const tree = buildPageTree([
      row({ id: "root", slug: "o-nas" }),
      row({ id: "child", slug: "test-agenda", parent_id: "missing" }),
      row({ id: "grandchild", slug: "dzien-1", parent_id: "child" }),
    ]);
    expect(tree.map((n) => n.path)).toEqual(["/o-nas"]);
    expect(countPageTreeNodes(tree)).toBe(1);
  });

  it("a parent_id cycle never reaches a root, so it is dropped without looping", () => {
    const tree = buildPageTree([
      row({ id: "a", slug: "a", parent_id: "b" }),
      row({ id: "b", slug: "b", parent_id: "a" }),
      row({ id: "self", slug: "self", parent_id: "self" }),
    ]);
    expect(tree).toEqual([]);
  });
});

describe("pageTreePaths / withoutPageTreeNodes / postCanonicalPath", () => {
  const rows = [
    row({ id: "main", slug: "main", menu_order: 0 }),
    row({ id: "intro", slug: "wstep", parent_id: "main" }),
    row({ id: "blog", slug: "blog", menu_order: 1 }),
    row({ id: "news", slug: "aktualnosci", menu_order: 2 }),
  ];

  it("lookup obejmuje KAŻDY węzeł, także ten, który widok potem ukryje", () => {
    const paths = pageTreePaths(buildPageTree(rows));
    expect(Object.fromEntries(paths)).toEqual({
      main: "/main",
      intro: "/main/wstep",
      blog: "/blog",
      news: "/aktualnosci",
    });
  });

  it("ukryty węzeł oddaje miejsce dzieciom, a ich ścieżki się NIE zmieniają", () => {
    const visible = withoutPageTreeNodes(buildPageTree(rows), (n) => n.id === "main");
    expect(visible.map((n) => n.path)).toEqual(["/main/wstep", "/blog", "/aktualnosci"]);
  });

  it("nie mutuje drzewa wejściowego", () => {
    const tree = buildPageTree(rows);
    withoutPageTreeNodes(tree, (n) => n.id === "intro");
    expect(tree[0]?.children.map((n) => n.id)).toEqual(["intro"]);
  });

  it("adres wpisu = ścieżka rodzica + slug; nieznany rodzic = null (zapas /post/<slug>)", () => {
    const paths = pageTreePaths(buildPageTree(rows));
    expect(postCanonicalPath(paths, { slug: "wpis", parent_page_id: "blog" })).toBe("/blog/wpis");
    // Wpis pod stroną główną żyje pod jej slugiem - tak składa go `page_full_path`.
    expect(postCanonicalPath(paths, { slug: "wpis", parent_page_id: "main" })).toBe("/main/wpis");
    expect(postCanonicalPath(paths, { slug: "wpis", parent_page_id: "nieopublikowana" })).toBe(
      null,
    );
    expect(postCanonicalPath(paths, { slug: "wpis", parent_page_id: null })).toBe(null);
  });
});

// Kształt danych z produkcji (2026-10-10): strona główna `main`, strony CMS
// o slugach tras kodowych (`blog`, `contribute`), strona `/wydarzenia`, na
// którą przekierowuje `/events`, i sieroty `test-*`.
describe("planSiteMap - jeden adres, jeden wpis mapy", () => {
  const rows = [
    row({ id: "main", slug: "main" }),
    row({ id: "main-sub", slug: "podstrona", parent_id: "main" }),
    row({ id: "blog", slug: "blog" }),
    row({ id: "blog-sub", slug: "archiwum", parent_id: "blog" }),
    row({ id: "contribute", slug: "contribute" }),
    row({ id: "wydarzenia", slug: "wydarzenia" }),
    row({ id: "o-nas", slug: "o-nas" }),
    row({ id: "orphan", slug: "test-agenda", parent_id: "a4d270b1-nieopublikowany" }),
  ];
  const STATIC = ["/", "/blog", "/events", "/contribute", "/statut", "/rodo"];
  const LEGACY = { "/events": "/wydarzenia", "/statut": "/o-nas" };

  function allPaths(nodes: readonly PageTreeNode[]): string[] {
    return nodes.flatMap((n) => [n.path, ...allPaths(n.children)]);
  }

  it("strona główna, strony pod trasami kodowymi i sieroty znikają z drzewa", () => {
    const plan = planSiteMap(rows, {
      homepageId: "main",
      staticHrefs: STATIC,
      legacyRedirects: LEGACY,
    });
    expect(allPaths(plan.tree).sort()).toEqual(
      ["/blog/archiwum", "/main/podstrona", "/o-nas", "/wydarzenia"].sort(),
    );
  });

  it("trasa przekierowana na OPUBLIKOWANĄ stronę wypada; reszta tras zostaje", () => {
    const plan = planSiteMap(rows, {
      homepageId: "main",
      staticHrefs: STATIC,
      legacyRedirects: LEGACY,
    });
    expect([...plan.staticHrefs]).toEqual(["/", "/blog", "/contribute", "/rodo"]);
  });

  it("żaden adres nie pojawia się dwa razy (drzewo + trasy kodowe)", () => {
    const plan = planSiteMap(rows, {
      homepageId: "main",
      staticHrefs: STATIC,
      legacyRedirects: LEGACY,
    });
    const every = [...plan.staticHrefs, ...allPaths(plan.tree)];
    expect(new Set(every).size).toBe(every.length);
    // `/main` to duplikat `/` - nie może wrócić żadną drogą.
    expect(every).not.toContain("/main");
  });

  it("strona CMS pod źródłem DZIAŁAJĄCEJ reguły znika z drzewa (dzieci zostają)", () => {
    // Middleware przekierowuje `/statut` na `/o-nas`, zanim dojdzie do routera,
    // więc strona CMS o slugu `statut` nie ma działającego adresu - jej link
    // byłby 301. Dzieci żyją pod `/statut/...`, którego reguła nie łapie.
    const plan = planSiteMap(
      [
        ...rows,
        row({ id: "statut", slug: "statut" }),
        row({ id: "statut-sub", slug: "zalaczniki", parent_id: "statut" }),
      ],
      { homepageId: "main", staticHrefs: STATIC, legacyRedirects: LEGACY },
    );
    const every = [...plan.staticHrefs, ...allPaths(plan.tree)];
    expect(every).not.toContain("/statut");
    expect(every).toContain("/statut/zalaczniki");
    // Bez celu reguła nie działa - strona CMS pod `/statut` jest wtedy
    // przesłonięta trasą kodową i ustępuje jej linkowi (reguła 2).
    const withoutTarget = planSiteMap(
      [...rows.filter((r) => r.id !== "o-nas"), row({ id: "statut", slug: "statut" })],
      { homepageId: "main", staticHrefs: STATIC, legacyRedirects: LEGACY },
    );
    expect(withoutTarget.staticHrefs.has("/statut")).toBe(true);
    expect(allPaths(withoutTarget.tree)).not.toContain("/statut");
  });

  it("bez strony docelowej przekierowanie nie działa - link trasy zostaje", () => {
    const plan = planSiteMap(
      rows.filter((r) => r.id !== "wydarzenia"),
      { homepageId: "main", staticHrefs: STATIC, legacyRedirects: LEGACY },
    );
    expect(plan.staticHrefs.has("/events")).toBe(true);
  });

  it("lookup ścieżek obejmuje ukryte węzły - wpisy pod `/blog` i `/main` mają adres", () => {
    const plan = planSiteMap(rows, {
      homepageId: "main",
      staticHrefs: STATIC,
      legacyRedirects: LEGACY,
    });
    expect(plan.paths.get("blog")).toBe("/blog");
    expect(plan.paths.get("main")).toBe("/main");
    expect(plan.paths.has("orphan")).toBe(false);
  });

  it("strona CMS pod trasą kodową z `noindex` znika z drzewa (dzieci zostają)", () => {
    // Produkcja (audyt 2026-10): strony `login` i `club` są opublikowane, ale
    // pod ich adresem renderuje się trasa z `noindex` - mapa nie może ich linkować.
    const plan = planSiteMap(
      [
        ...rows,
        row({ id: "login", slug: "login" }),
        row({ id: "club", slug: "club" }),
        row({ id: "club-sub", slug: "regulamin", parent_id: "club" }),
      ],
      {
        homepageId: "main",
        staticHrefs: STATIC,
        legacyRedirects: LEGACY,
        noindexPaths: new Set(["/login", "/club"]),
      },
    );
    const every = allPaths(plan.tree);
    expect(every).not.toContain("/login");
    expect(every).not.toContain("/club");
    expect(every).toContain("/club/regulamin");
    // Adres strony zostaje w lookupie (np. dla wpisów pod nią).
    expect(plan.paths.get("club")).toBe("/club");
  });

  it("link trasy kodowej z `noindex` (`/people`) też wypada z mapy", () => {
    const plan = planSiteMap(rows, {
      homepageId: "main",
      staticHrefs: [...STATIC, "/people"],
      legacyRedirects: LEGACY,
      noindexPaths: new Set(["/people"]),
    });
    expect(plan.staticHrefs.has("/people")).toBe(false);
    expect(plan.staticHrefs.has("/blog")).toBe(true);
  });

  it("tryb najnowszych wpisów (homepageId = null): strona `main` jest zwykłą stroną", () => {
    const plan = planSiteMap(rows, { homepageId: null, staticHrefs: STATIC });
    expect(allPaths(plan.tree)).toContain("/main");
  });
});

// Gałąź `a.title_pl || a.title_en` (pageTree.ts:25) - obie strony komparatora.
// Strona bez tytułu PL istnieje w bazie realnie: redakcja zakłada wpis od wersji
// EN. Bez prawej strony `||` takie rodzeństwo sortowałoby się po pustym stringu,
// czyli w praktyce losowo - a /sitemap jest dokumentem, po którym crawler
// odkrywa hierarchię serwisu.
describe("buildPageTree - rodzeństwo bez tytułu w języku domyślnym", () => {
  it("sortuje po tytule EN, gdy tytuł PL jest pusty po obu stronach porównania", () => {
    const tree = buildPageTree([
      row({ id: "1", slug: "b-zeta", title_pl: "", title_en: "Zeta" }),
      row({ id: "2", slug: "a-alfa", title_pl: "", title_en: "Alfa" }),
    ]);
    expect(tree.map((n) => n.slug)).toEqual(["a-alfa", "b-zeta"]);
  });

  it("porównuje tytuł EN strony bez tłumaczenia PL z tytułem PL strony przetłumaczonej", () => {
    const tree = buildPageTree([
      row({ id: "1", slug: "bez-pl", title_pl: "", title_en: "Zeta" }),
      row({ id: "2", slug: "z-pl", title_pl: "Alfa", title_en: "Alpha" }),
    ]);
    expect(tree.map((n) => n.slug)).toEqual(["z-pl", "bez-pl"]);
  });
});
