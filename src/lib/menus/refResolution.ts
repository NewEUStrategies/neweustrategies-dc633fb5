// Pozycje menu rozstrzygane PO REFERENCJI (strona, wpis, kategoria, tag).
//
// PRZYCZYNA (2026-10 audyt SEO). Menu główne linkowało `/category/ekonomia`,
// które odpowiada 404. Pozycja menu KOPIUJE adres w chwili dodania
// (`/category/${slug}` w panelu), a `ref_id` był zapisywany i nigdy nieczytany
// - więc zmiana slugu, skasowanie kategorii, przeniesienie strony pod innego
// rodzica albo zdjęcie jej z publikacji zostawiały w nagłówku KAŻDEJ strony
// martwy link, którego nikt w panelu nie widział.
//
// REGUŁA ODCZYTU:
//   * pozycja `page`/`post`/`category`/`tag` z `ref_id` dostaje BIEŻĄCY
//     adres publiczny wskazanego wiersza (strona: pełna ścieżka, wpis:
//     ścieżka rodzica + slug, kategoria: `/category/<slug>`, tag:
//     `/tag/<slug>`). Wiersz, którego nie ma albo który nie jest publiczny
//     (szkic, kosz, strona pod nieopublikowanym przodkiem), oznacza pozycję
//     `ref_broken` - publiczne menu jej nie renderuje (razem z poddrzewem,
//     jak przy widoczności), a panel pokazuje ostrzeżenie. Dwa wyjątki dla
//     stron: adres TRASY KODOWEJ (`/pricing`, `/club` - `lib/routing/codeRoutes.ts`)
//     działa bez względu na status wiersza `pages`, a link `/` do strony
//     głównej zostaje `/` (jej własna ścieżka `/main` to 301),
//   * pozycja bez `ref_id` zostaje przy zapisanym `href`; jeśli to adres
//     archiwum kategorii (`/category/<slug>`), a takiej kategorii w najemcy
//     nie ma, pozycja też jest `ref_broken`,
//   * odczyt, który się NIE powiódł, nie psuje menu: pozycje tego typu
//     zostają dokładnie takie, jak w bazie (bez nowego adresu i bez flagi).
//
// KOSZT. Jedno zapytanie zbiorcze na typ, wyłącznie dla typów obecnych
// w menu (menu z samymi własnymi linkami nie płaci nic). Strony potrzebują
// dwóch kroków: `page_full_paths` (ścieżki) i sprawdzenia, czy najwyższy
// widoczny przodek jest korzeniem - pod RLS anon łańcuch urywa się na
// nieopublikowanym przodku, więc bez tego strona pod szkicem dostałaby
// ucięty adres zamiast flagi. Wynik siedzi w tej samej migawce
// `edgeTtlCache` co samo menu, więc w stanie ustalonym koszt to zero.
//
// ZAKRES NAJEMCY I RLS. Klient to współdzielony klient anon z nagłówkiem
// hosta (`menu.functions.ts`): polityki publiczne `categories`, `tags`,
// `posts` i `pages` wpuszczają wyłącznie wiersze najemcy hosta i wyłącznie
// opublikowane - dokładnie to, co czytelnik może otworzyć.
import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isCodeRoutePath } from "@/lib/routing/codeRoutes";
import type { MenuItemRow, MenuItemType } from "./types";

/**
 * Klient odczytu menu. Typ wyprowadzony z `createClient<Database>` - DOKŁADNIE
 * ten, który buduje `menu.functions.ts` - a nie `SupabaseClient<Database>`:
 * porównanie strukturalne dwóch różnie zapisanych instancji generycznego
 * klienta kończy się w kompilatorze błędem „excessively deep" (TS2589).
 */
export type MenuRefClient = Pick<ReturnType<typeof createClient<Database>>, "from" | "rpc">;

/** Typy pozycji rozstrzygane po `ref_id`. */
export type MenuRefKind = Exclude<MenuItemType, "custom">;

/**
 * Adres archiwum kategorii w linku menu: `/category/<slug>`, także z prefiksem
 * `/en`, końcowym ukośnikiem, query albo hashem. Lustro wzorca migracji
 * 20261011090000 (`_menu_items_repair_category_links`).
 */
const CATEGORY_HREF_RE = /^(?:\/en)?\/category\/([^/?#]+)\/?(?:[?#].*)?$/;

/**
 * Slug, który wolno wstawić do filtra PostgREST bez cytowania. Slugi kategorii
 * powstają ze `slugify` (`[a-z0-9-]`); link z czymkolwiek innym nie jest
 * sprawdzany - lepiej go nie oflagować, niż zbudować filtr ze śmieci.
 */
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,199}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/` (także `/en`, z query) - link do strony głównej. */
function isRootHref(href: string | null | undefined): boolean {
  const path = (href ?? "").trim().split(/[?#]/)[0];
  return /^\/(?:en\/?)?$/.test(path);
}

/** Slug kategorii z linku menu albo `null`, gdy to nie jest adres archiwum. */
export function categorySlugFromHref(href: string | null | undefined): string | null {
  const match = CATEGORY_HREF_RE.exec((href ?? "").trim());
  if (!match) return null;
  let slug = match[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Uszkodzone kodowanie zostaje w surowej postaci - i tak nie przejdzie
    // przez `SAFE_SLUG_RE`, więc nie trafi do filtra.
  }
  return slug.toLowerCase();
}

/**
 * Typy rozstrzygane po referencji - lista ZAMKNIĘTA. Wiersz spoza niej (wartość
 * spoza enumu z importu, danych zanonimizowanych albo przyszłej wersji
 * schematu) zostaje przy zapisanym `href`: dawne `item_type !== "custom"`
 * wpuszczało go do `ids[item.item_type]` (undefined) i wyjątek wywracał odczyt
 * CAŁEGO menu.
 */
const REF_KINDS: ReadonlySet<string> = new Set<MenuRefKind>(["page", "post", "category", "tag"]);

function hasRef(item: Pick<MenuItemRow, "item_type" | "ref_id">): item is Pick<
  MenuItemRow,
  "item_type" | "ref_id"
> & {
  item_type: MenuRefKind;
  ref_id: string;
} {
  return (
    REF_KINDS.has(item.item_type) && typeof item.ref_id === "string" && UUID_RE.test(item.ref_id)
  );
}

/** Co trzeba doczytać, żeby rozstrzygnąć pozycje menu. */
export interface MenuRefRequest {
  pageIds: string[];
  postIds: string[];
  categoryIds: string[];
  tagIds: string[];
  /** Slugi z własnych linków `/category/<slug>` (pozycje bez referencji). */
  categorySlugs: string[];
}

export function collectMenuRefs(
  items: ReadonlyArray<Pick<MenuItemRow, "item_type" | "ref_id" | "href">>,
): MenuRefRequest {
  const ids: Record<MenuRefKind, Set<string>> = {
    page: new Set(),
    post: new Set(),
    category: new Set(),
    tag: new Set(),
  };
  const categorySlugs = new Set<string>();
  for (const item of items) {
    if (hasRef(item)) {
      ids[item.item_type].add(item.ref_id);
      continue;
    }
    const slug = categorySlugFromHref(item.href);
    if (slug && SAFE_SLUG_RE.test(slug)) categorySlugs.add(slug);
  }
  return {
    pageIds: [...ids.page],
    postIds: [...ids.post],
    categoryIds: [...ids.category],
    tagIds: [...ids.tag],
    categorySlugs: [...categorySlugs],
  };
}

/** Wynik doczytania: bieżące adresy publiczne i typy, których odczyt zawiódł. */
export interface MenuRefTargets {
  /** id -> adres publiczny (`/sekcja/strona`, `/category/slug`, ...). */
  paths: ReadonlyMap<string, string>;
  /** Slugi kategorii ISTNIEJĄCYCH w najemcy (spośród sprawdzanych). */
  categorySlugs: ReadonlySet<string>;
  /** Typy, których nie dało się sprawdzić - ich pozycje zostają bez zmian. */
  failed: ReadonlySet<MenuRefKind>;
}

/**
 * Nakłada rozstrzygnięcie na pozycje. Czysta funkcja - zwraca nowe wiersze,
 * a pozycje bez zmian zwraca w tej samej referencji.
 */
export function applyMenuRefs<T extends MenuItemRow>(
  items: readonly T[],
  targets: MenuRefTargets,
): T[] {
  return items.map((item) => {
    if (hasRef(item)) {
      if (targets.failed.has(item.item_type)) return item;
      const path = targets.paths.get(item.ref_id);
      if (!path) {
        // Strona pod adresem TRASY KODOWEJ (`/pricing`, `/club`) działa bez
        // względu na status wiersza `pages` - to nie jest martwy link.
        if (item.item_type === "page" && isCodeRoutePath(item.href)) return item;
        return { ...item, ref_broken: true };
      }
      // Link do strony głównej zostaje `/`: strona wskazana jako główna ma też
      // własną ścieżkę (`/main`), ale ta odpowiada 301 na `/`.
      if (item.item_type === "page" && isRootHref(item.href)) return item;
      return path === item.href ? item : { ...item, href: path };
    }
    const slug = categorySlugFromHref(item.href);
    if (!slug || !SAFE_SLUG_RE.test(slug) || targets.failed.has("category")) return item;
    return targets.categorySlugs.has(slug) ? item : { ...item, ref_broken: true };
  });
}

interface PathRow {
  page_id: string;
  full_path: string | null;
}

/** Ścieżki stron (bez wiodącego ukośnika) dla stron widocznych dla anon. */
async function fetchPagePaths(
  client: MenuRefClient,
  pageIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pageIds.length === 0) return out;
  const { data, error } = await client.rpc("page_full_paths", { _page_ids: [...pageIds] });
  if (error) throw error;
  for (const row of (data ?? []) as PathRow[]) {
    const path = typeof row.full_path === "string" ? row.full_path.replace(/^\/+|\/+$/g, "") : "";
    if (path) out.set(row.page_id, path);
  }
  return out;
}

/**
 * Ścieżki, których NAJWYŻSZY widoczny segment nie jest stroną najwyższego
 * poziomu - czyli łańcuch urwał się na przodku, którego anon nie widzi
 * (szkic, kosz). Slug strony jest unikalny w najemcy (`pages_tenant_slug_uniq`),
 * więc jedno zapytanie po slugach rozstrzyga wszystkie ścieżki naraz.
 */
async function truncatedTops(client: MenuRefClient, paths: Iterable<string>): Promise<Set<string>> {
  const tops = new Set<string>();
  for (const path of paths) tops.add(path.split("/")[0]);
  const truncated = new Set<string>();
  if (tops.size === 0) return truncated;
  const { data, error } = await client
    .from("pages")
    .select("slug, parent_id")
    .in("slug", [...tops]);
  if (error) throw error;
  const rootSlugs = new Set(
    (data ?? []).filter((row) => row.parent_id === null).map((row) => row.slug),
  );
  for (const top of tops) if (!rootSlugs.has(top)) truncated.add(top);
  return truncated;
}

/**
 * Kategorie wskazane po `ref_id` ORAZ po slugu z własnych linków - jednym
 * zapytaniem. Identyfikatory to UUID, a slugi przeszły `SAFE_SLUG_RE`, więc
 * żaden element filtra `or` nie wymaga cytowania.
 */
async function fetchCategories(
  client: MenuRefClient,
  ids: readonly string[],
  slugs: readonly string[],
): Promise<Array<{ id: string; slug: string }>> {
  if (ids.length === 0 && slugs.length === 0) return [];
  const query = client.from("categories").select("id, slug");
  const { data, error } =
    ids.length > 0 && slugs.length > 0
      ? await query.or(`id.in.(${ids.join(",")}),slug.in.(${slugs.join(",")})`)
      : ids.length > 0
        ? await query.in("id", [...ids])
        : await query.in("slug", [...slugs]);
  if (error) throw error;
  return data ?? [];
}

async function fetchTags(
  client: MenuRefClient,
  ids: readonly string[],
): Promise<Array<{ id: string; slug: string }>> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("tags")
    .select("id, slug")
    .in("id", [...ids]);
  if (error) throw error;
  return data ?? [];
}

/**
 * Doczytuje cele pozycji menu: jedno zapytanie na typ (strony: ścieżki +
 * kontrola przodków), równolegle. Awaria jednego typu nie zabiera reszty.
 */
export async function fetchMenuRefTargets(
  client: MenuRefClient,
  request: MenuRefRequest,
): Promise<MenuRefTargets> {
  const paths = new Map<string, string>();
  const categorySlugs = new Set<string>();
  const failed = new Set<MenuRefKind>();

  const categories = fetchCategories(client, request.categoryIds, request.categorySlugs).then(
    (rows) => {
      for (const row of rows) {
        categorySlugs.add(row.slug);
        paths.set(row.id, `/category/${row.slug}`);
      }
    },
    (error: unknown) => {
      console.warn("[menu] kategorie pozycji menu - odczyt nieudany", error);
      failed.add("category");
    },
  );

  const tags = fetchTags(client, request.tagIds).then(
    (rows) => {
      for (const row of rows) paths.set(row.id, `/tag/${row.slug}`);
    },
    (error: unknown) => {
      console.warn("[menu] tagi pozycji menu - odczyt nieudany", error);
      failed.add("tag");
    },
  );

  // Strony i wpisy dzielą kontrolę przodków, więc idą jednym łańcuchem:
  // ścieżki stron i rodziców wpisów równolegle, potem JEDNO sprawdzenie.
  const pagesAndPosts = (async () => {
    const [pagePaths, posts] = await Promise.all([
      fetchPagePaths(client, request.pageIds).catch((error: unknown) => {
        console.warn("[menu] strony pozycji menu - odczyt nieudany", error);
        failed.add("page");
        return new Map<string, string>();
      }),
      (async () => {
        if (request.postIds.length === 0) return null;
        const { data, error } = await client
          .from("posts")
          .select("id, slug, parent_page_id")
          .in("id", [...request.postIds]);
        if (error) throw error;
        const rows = data ?? [];
        const parentPaths = await fetchPagePaths(client, [
          ...new Set(rows.map((row) => row.parent_page_id).filter(Boolean)),
        ] as string[]);
        return { rows, parentPaths };
      })().catch((error: unknown) => {
        console.warn("[menu] wpisy pozycji menu - odczyt nieudany", error);
        failed.add("post");
        return null;
      }),
    ]);

    let truncated: Set<string>;
    try {
      truncated = await truncatedTops(client, [
        ...pagePaths.values(),
        ...(posts ? posts.parentPaths.values() : []),
      ]);
    } catch (error) {
      console.warn("[menu] przodkowie stron pozycji menu - odczyt nieudany", error);
      if (request.pageIds.length > 0) failed.add("page");
      if (request.postIds.length > 0) failed.add("post");
      return;
    }
    const reachable = (path: string) => !truncated.has(path.split("/")[0]);

    for (const [id, path] of pagePaths) if (reachable(path)) paths.set(id, `/${path}`);
    if (posts) {
      for (const row of posts.rows) {
        const parent = row.parent_page_id ? posts.parentPaths.get(row.parent_page_id) : undefined;
        if (parent && reachable(parent)) paths.set(row.id, `/${parent}/${row.slug}`);
      }
    }
  })();

  await Promise.all([categories, tags, pagesAndPosts]);
  return { paths, categorySlugs, failed };
}

/** Rozstrzyga pozycje menu po referencji - patrz nagłówek modułu. */
export async function resolveMenuRefs<T extends MenuItemRow>(
  items: readonly T[],
  client: MenuRefClient,
): Promise<T[]> {
  const request = collectMenuRefs(items);
  const nothingToResolve =
    request.pageIds.length === 0 &&
    request.postIds.length === 0 &&
    request.categoryIds.length === 0 &&
    request.tagIds.length === 0 &&
    request.categorySlugs.length === 0;
  if (nothingToResolve) return [...items];
  return applyMenuRefs(items, await fetchMenuRefTargets(client, request));
}
