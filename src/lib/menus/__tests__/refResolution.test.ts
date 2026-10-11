// Pozycje menu rozstrzygane po referencji - publiczny odczyt i ostrzeżenie panelu.
//
// PO CO (2026-10 audyt SEO): `/category/ekonomia` w menu głównym dawało 404, bo
// pozycja menu kopiowała adres w chwili dodania, a `ref_id` nikt nie czytał.
//
// CO MA TU DOWÓD:
//   1. pozycja z `ref_id` dostaje BIEŻĄCY adres wskazanego wiersza (strona:
//      pełna ścieżka, wpis: ścieżka rodzica + slug, kategoria, tag),
//   2. wiersz nieistniejący albo niepubliczny - także strona pod
//      nieopublikowanym przodkiem (łańcuch anon urwany) - daje `ref_broken`,
//   3. własny link `/category/<slug>` do kategorii, której nie ma, też,
//   4. JEDNO zapytanie na typ (bez N+1), zero zapytań dla menu z samymi
//      własnymi linkami, a awaria odczytu typu zostawia jego pozycje bez zmian,
//   5. flaga przechodzi przez projekcję przesyłki i ukrywa pozycję (z
//      poddrzewem) w publicznym menu.
import { describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import { DEFAULT_MEGA_CONFIG, type MenuItemRow } from "../types";
import {
  applyMenuRefs,
  categorySlugFromHref,
  collectMenuRefs,
  resolveMenuRefs,
  type MenuRefClient,
} from "../refResolution";
import { filterMenuItemsForViewer } from "../visibility";

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

const { compactMenuWithItems, fetchMenuWithItems } = await import("../menu.functions");
const { expandMenuWithItems } = await import("../queries");

const CAT_EKONOMIA = "8d03c162-82a5-45bc-a0bd-6c1eef1b6257";
const CAT_NOWA = "8d03c162-82a5-45bc-a0bd-6c1eef1b6258";
const PAGE_ZESPOL = "11111111-1111-4111-8111-111111111111";
const PAGE_POD_SZKICEM = "11111111-1111-4111-8111-111111111112";
const PAGE_SZKIC = "11111111-1111-4111-8111-111111111113";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const TAG_ID = "33333333-3333-4333-8333-333333333333";

function item(over: Partial<MenuItemRow> & Pick<MenuItemRow, "id">): MenuItemRow {
  return {
    menu_id: "menu-1",
    parent_id: null,
    position: 0,
    item_type: "custom",
    ref_id: null,
    label_pl: over.id,
    label_en: "",
    href: "",
    target: "_self",
    css_class: "",
    visibility: "all",
    icon: "",
    mega_enabled: false,
    mega_config: DEFAULT_MEGA_CONFIG,
    ...over,
  };
}

interface Scene {
  categories?: SupabaseResult;
  tags?: SupabaseResult;
  posts?: SupabaseResult;
  /** Wiersze `pages` po slugu (kontrola najwyższego przodka). */
  pageTops?: SupabaseResult;
  /** page_id -> pełna ścieżka widoczna dla anon. */
  paths?: Record<string, string>;
  pathsError?: boolean;
}

function client(scene: Scene = {}) {
  const db = supabaseFromStub();
  db.setResponse("categories", scene.categories ?? ok([]));
  db.setResponse("tags", scene.tags ?? ok([]));
  db.setResponse("posts", scene.posts ?? ok([]));
  db.setResponse("pages", scene.pageTops ?? ok([]));
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const rpc = async (fn: string, args: { _page_ids?: string[] }) => {
    rpcCalls.push({ fn, args });
    if (fn !== "page_full_paths") return fail(`nieoczekiwane RPC ${fn}`);
    if (scene.pathsError) return fail("rpc down");
    const ids = args._page_ids ?? [];
    return ok(
      ids
        .filter((id) => scene.paths?.[id])
        .map((id) => ({ page_id: id, full_path: scene.paths?.[id] ?? null })),
    );
  };
  return { db, rpcCalls, sb: { from: db.from, rpc } as unknown as MenuRefClient };
}

describe("categorySlugFromHref", () => {
  it.each([
    ["/category/ekonomia", "ekonomia"],
    ["/category/ekonomia/", "ekonomia"],
    ["/en/category/ekonomia?x=1", "ekonomia"],
    ["/category/Ekonomia#top", "ekonomia"],
  ])("%s -> %s", (href, slug) => expect(categorySlugFromHref(href)).toBe(slug));

  it.each(["/blog", "/category/a/b", "https://x.test/category/a", "", "/categoryx/a"])(
    "%s nie jest adresem archiwum kategorii",
    (href) => expect(categorySlugFromHref(href)).toBeNull(),
  );
});

describe("collectMenuRefs", () => {
  it("zbiera identyfikatory per typ i slugi własnych linków do kategorii", () => {
    const request = collectMenuRefs([
      item({ id: "a", item_type: "category", ref_id: CAT_EKONOMIA, href: "/category/ekonomia" }),
      item({ id: "b", item_type: "page", ref_id: PAGE_ZESPOL, href: "/zespol" }),
      item({ id: "c", item_type: "custom", href: "/category/obronnosc" }),
      item({ id: "d", item_type: "custom", href: "/category/%E2%9C%93" }),
      item({ id: "e", item_type: "custom", href: "/blog" }),
      item({ id: "f", item_type: "tag", ref_id: "nie-uuid", href: "/tag/x" }),
    ]);
    expect(request).toEqual({
      pageIds: [PAGE_ZESPOL],
      postIds: [],
      categoryIds: [CAT_EKONOMIA],
      tagIds: [],
      categorySlugs: ["obronnosc"],
    });
  });
});

describe("resolveMenuRefs", () => {
  it("menu z samymi zwykłymi linkami nie płaci ani jednego zapytania", async () => {
    const { db, rpcCalls, sb } = client();
    const items = [item({ id: "blog", href: "/blog" }), item({ id: "o-nas", href: "/o-nas" })];
    expect(await resolveMenuRefs(items, sb)).toEqual(items);
    expect(db.chains).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("kategoria po ref_id dostaje BIEŻĄCY slug; skasowana - flagę (przypadek /category/ekonomia)", async () => {
    const { db, sb } = client({ categories: ok([{ id: CAT_NOWA, slug: "gospodarka" }]) });
    const out = await resolveMenuRefs(
      [
        item({ id: "nowa", item_type: "category", ref_id: CAT_NOWA, href: "/category/stary" }),
        item({
          id: "eko",
          item_type: "category",
          ref_id: CAT_EKONOMIA,
          href: "/category/ekonomia",
        }),
      ],
      sb,
    );
    expect(out.map((i) => [i.id, i.href, i.ref_broken ?? false])).toEqual([
      ["nowa", "/category/gospodarka", false],
      ["eko", "/category/ekonomia", true],
    ]);
    // JEDNO zapytanie o kategorie dla wszystkich pozycji.
    expect(db.chainsFor("categories")).toHaveLength(1);
    expect(db.lastChain("categories")?.argsOf("in")).toEqual(["id", [CAT_NOWA, CAT_EKONOMIA]]);
  });

  it("własny link /category/<slug> do nieistniejącej kategorii jest martwy; referencje i slugi idą JEDNYM zapytaniem", async () => {
    const { db, sb } = client({
      categories: ok([
        { id: CAT_NOWA, slug: "gospodarka" },
        { id: "inna", slug: "obronnosc" },
      ]),
    });
    const out = await resolveMenuRefs(
      [
        item({ id: "ref", item_type: "category", ref_id: CAT_NOWA }),
        item({ id: "zywy", href: "/category/obronnosc" }),
        item({ id: "martwy", href: "/en/category/ekonomia" }),
      ],
      sb,
    );
    expect(out.map((i) => [i.id, i.ref_broken ?? false])).toEqual([
      ["ref", false],
      ["zywy", false],
      ["martwy", true],
    ]);
    expect(db.chainsFor("categories")).toHaveLength(1);
    expect(db.lastChain("categories")?.argsOf("or")).toEqual([
      `id.in.(${CAT_NOWA}),slug.in.(obronnosc,ekonomia)`,
    ]);
  });

  it("strona: pełna ścieżka; strona pod NIEOPUBLIKOWANYM przodkiem i szkic są martwe", async () => {
    const { db, rpcCalls, sb } = client({
      // Pod RLS anon łańcuch urywa się na szkicu: `pod-szkicem` widzi tylko siebie.
      paths: { [PAGE_ZESPOL]: "o-nas/zespol", [PAGE_POD_SZKICEM]: "agenda" },
      pageTops: ok([
        { slug: "o-nas", parent_id: null },
        { slug: "agenda", parent_id: PAGE_SZKIC },
      ]),
    });
    const out = await resolveMenuRefs(
      [
        item({ id: "zespol", item_type: "page", ref_id: PAGE_ZESPOL, href: "/zespol" }),
        item({ id: "pod", item_type: "page", ref_id: PAGE_POD_SZKICEM, href: "/szkic/agenda" }),
        item({ id: "szkic", item_type: "page", ref_id: PAGE_SZKIC, href: "/szkic" }),
      ],
      sb,
    );
    expect(out.map((i) => [i.id, i.href, i.ref_broken ?? false])).toEqual([
      ["zespol", "/o-nas/zespol", false],
      ["pod", "/szkic/agenda", true],
      ["szkic", "/szkic", true],
    ]);
    expect(rpcCalls).toEqual([
      { fn: "page_full_paths", args: { _page_ids: [PAGE_ZESPOL, PAGE_POD_SZKICEM, PAGE_SZKIC] } },
    ]);
    expect(db.chainsFor("pages")).toHaveLength(1);
    expect(db.lastChain("pages")?.argsOf("in")).toEqual(["slug", ["o-nas", "agenda"]]);
  });

  it("wpis: ścieżka rodzica + slug; tag: /tag/<slug>", async () => {
    const PARENT = "44444444-4444-4444-8444-444444444444";
    const { db, sb } = client({
      posts: ok([{ id: POST_ID, slug: "raport-2026", parent_page_id: PARENT }]),
      tags: ok([{ id: TAG_ID, slug: "nato" }]),
      paths: { [PARENT]: "analizy" },
      pageTops: ok([{ slug: "analizy", parent_id: null }]),
    });
    const out = await resolveMenuRefs(
      [
        item({ id: "wpis", item_type: "post", ref_id: POST_ID, href: "/post/raport-2026" }),
        item({ id: "tag", item_type: "tag", ref_id: TAG_ID, href: "/tag/stary" }),
      ],
      sb,
    );
    expect(out.map((i) => [i.id, i.href, i.ref_broken ?? false])).toEqual([
      ["wpis", "/analizy/raport-2026", false],
      ["tag", "/tag/nato", false],
    ]);
    expect(db.chainsFor("posts")).toHaveLength(1);
    expect(db.chainsFor("tags")).toHaveLength(1);
  });

  it("awaria odczytu typu zostawia jego pozycje BEZ ZMIAN (bez flagi), reszta działa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sb } = client({
      categories: fail("categories down"),
      pathsError: true,
      tags: ok([{ id: TAG_ID, slug: "nato" }]),
    });
    const items = [
      item({ id: "kat", item_type: "category", ref_id: CAT_EKONOMIA, href: "/category/ekonomia" }),
      item({ id: "link", href: "/category/brak" }),
      item({ id: "strona", item_type: "page", ref_id: PAGE_ZESPOL, href: "/zespol" }),
      item({ id: "tag", item_type: "tag", ref_id: TAG_ID, href: "/tag/x" }),
    ];
    const out = await resolveMenuRefs(items, sb);
    expect(out.slice(0, 3)).toEqual(items.slice(0, 3));
    expect(out[3]).toMatchObject({ href: "/tag/nato" });
    expect(out.some((i) => i.ref_broken)).toBe(false);
    warn.mockRestore();
  });
});

describe("applyMenuRefs", () => {
  it("pozycja bez zmian wraca w tej samej referencji", () => {
    const zywa = item({ id: "a", item_type: "category", ref_id: CAT_NOWA, href: "/category/x" });
    const [out] = applyMenuRefs([zywa], {
      paths: new Map([[CAT_NOWA, "/category/x"]]),
      categorySlugs: new Set(),
      failed: new Set(),
    });
    expect(out).toBe(zywa);
  });

  const BRAK = {
    paths: new Map<string, string>(),
    categorySlugs: new Set<string>(),
    failed: new Set<never>(),
  };

  it("niepubliczna strona pod adresem TRASY KODOWEJ (/pricing, /club) NIE jest martwym linkiem", () => {
    // Produkcja: „Subskrypcja" -> /pricing, „Kluby dyskusyjne" -> /club to
    // pozycje typu `page`, a pod tymi adresami odpowiada komponent, nie CMS.
    const out = applyMenuRefs(
      [
        item({ id: "cennik", item_type: "page", ref_id: PAGE_ZESPOL, href: "/pricing" }),
        item({ id: "kluby", item_type: "page", ref_id: PAGE_SZKIC, href: "/en/club/" }),
        item({ id: "cms", item_type: "page", ref_id: PAGE_POD_SZKICEM, href: "/blog/analiza" }),
        item({ id: "wpis", item_type: "post", ref_id: POST_ID, href: "/blog" }),
      ],
      BRAK,
    );
    expect(out.map((i) => [i.id, i.ref_broken ?? false])).toEqual([
      ["cennik", false],
      ["kluby", false],
      ["cms", true],
      // Wyjątek dotyczy stron - adres wpisu zawsze zależy od wiersza wpisu.
      ["wpis", true],
    ]);
  });

  it("link `/` do strony głównej zostaje `/`, choć strona ma własną ścieżkę", () => {
    const [out] = applyMenuRefs(
      [item({ id: "start", item_type: "page", ref_id: PAGE_ZESPOL, href: "/" })],
      { ...BRAK, paths: new Map([[PAGE_ZESPOL, "/main"]]) },
    );
    expect(out.href).toBe("/");
    expect(out.ref_broken).toBeUndefined();
  });
});

describe("fetchMenuWithItems + przesyłka + publiczny filtr", () => {
  it("odczyt menu rozstrzyga referencje, a flaga przechodzi przez projekcję i ukrywa poddrzewo", async () => {
    const { db, sb } = client({ categories: ok([{ id: CAT_NOWA, slug: "gospodarka" }]) });
    db.setResponse(
      "menus",
      ok({
        id: "menu-1",
        key: "main",
        name: "Główne",
        menu_items: [
          { ...item({ id: "analizy", href: "/analizy" }), icon: null },
          {
            ...item({
              id: "eko",
              parent_id: "analizy",
              item_type: "category",
              ref_id: CAT_EKONOMIA,
              href: "/category/ekonomia",
            }),
          },
          { ...item({ id: "pod-eko", parent_id: "eko", href: "/blog" }) },
          {
            ...item({
              id: "gosp",
              parent_id: "analizy",
              item_type: "category",
              ref_id: CAT_NOWA,
              href: "/category/stary",
            }),
          },
        ],
      }),
    );
    const menu = await fetchMenuWithItems("main", sb);
    expect(menu?.items.map((i) => [i.id, i.href, i.ref_broken ?? false])).toEqual([
      ["analizy", "/analizy", false],
      ["eko", "/category/ekonomia", true],
      ["pod-eko", "/blog", false],
      ["gosp", "/category/gospodarka", false],
    ]);

    // Przesyłka: flaga tylko na martwej pozycji; rozwinięcie odtwarza wiersz.
    const wire = compactMenuWithItems(menu);
    expect(wire?.items.filter((i) => i.ref_broken).map((i) => i.id)).toEqual(["eko"]);
    const expanded = expandMenuWithItems(wire);
    expect(expanded?.items.find((i) => i.id === "eko")?.ref_broken).toBe(true);
    expect(expanded?.items.find((i) => i.id === "gosp")).not.toHaveProperty("ref_broken");

    // Front: martwa pozycja znika RAZEM z poddrzewem (dziecko nie wraca na górę).
    const visible = filterMenuItemsForViewer(expanded?.items ?? [], false).map((i) => i.id);
    expect(visible).toEqual(["analizy", "gosp"]);
  });
});
