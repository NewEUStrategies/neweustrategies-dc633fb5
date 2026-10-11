// Pure page-hierarchy builder for the public HTML site map (/sitemap). Turns
// flat `pages` rows (id/parent_id) into an ordered tree with canonical paths,
// mirroring the URL rule used everywhere else (path = parent path + slug).
// Framework-free and unit-tested; the route only feeds it query rows.
import { isTestContentSlug } from "./testContent";

export interface PageTreeRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  parent_id: string | null;
  menu_order: number;
}

export interface PageTreeNode extends PageTreeRow {
  /** Canonical unprefixed path ("/sekcja/podstrona"). */
  path: string;
  children: PageTreeNode[];
}

function sortSiblings(nodes: PageTreeNode[]): void {
  nodes.sort(
    (a, b) =>
      a.menu_order - b.menu_order ||
      (a.title_pl || a.title_en).localeCompare(b.title_pl || b.title_en, "pl"),
  );
  for (const node of nodes) sortSiblings(node.children);
}

/**
 * Build the ordered page tree. A row whose parent is absent from the input
 * (unpublished/excluded parent) is DROPPED together with its whole subtree.
 *
 * DLACZEGO NIE PROMOCJA DO KORZENIA (2026-10 audyt mapy HTML). Publiczny
 * `resolve_path` schodzi od korzenia segment po segmencie i wymaga strony
 * opublikowanej na KAŻDYM poziomie, więc strona bez opublikowanego rodzica
 * nie ma żadnego działającego adresu. Promocja wymyślała jej adres
 * `/<slug>` - pięć stron `test-*` pod nieopublikowanym rodzicem dawało tak
 * 10 linków (PL+EN) prowadzących na 404. Tej samej zasady pilnuje mapa
 * XML (`reachablePageIds` w `lib/server/publishedPagePaths.server.ts`).
 *
 * Cykl w `parent_id` (baza go nie blokuje) nie dochodzi do żadnego korzenia,
 * więc wypada tą samą drogą - bez pętli.
 */
export function buildPageTree(rows: readonly PageTreeRow[]): PageTreeNode[] {
  const nodes = new Map<string, PageTreeNode>();
  for (const row of rows) {
    // Strona TESTOWA (`test-*`/`e2e-*`) nie trafia do mapy; jej poddrzewo
    // wypada tą samą drogą co pod nieopublikowanym rodzicem (2026-10 audyt:
    // `/test-e2e-zakup`) - reguła w `lib/seo/testContent.ts`.
    if (isTestContentSlug(row.slug)) continue;
    nodes.set(row.id, { ...row, path: `/${row.slug}`, children: [] });
  }

  const roots: PageTreeNode[] = [];
  for (const node of nodes.values()) {
    if (!node.parent_id) {
      roots.push(node);
      continue;
    }
    // Rodzic spoza opublikowanych = strona nieosiągalna; nie linkujemy jej.
    nodes.get(node.parent_id)?.children.push(node);
  }

  // Paths depend on the final parent chain - resolve after linking.
  const assignPaths = (list: PageTreeNode[], base: string): void => {
    for (const node of list) {
      node.path = `${base}/${node.slug}`.replace(/\/{2,}/g, "/");
      assignPaths(node.children, node.path);
    }
  };
  assignPaths(roots, "");
  sortSiblings(roots);
  return roots;
}

/**
 * Id -> canonical path for EVERY node of the tree, including nodes the view
 * later hides (homepage, pages shadowed by code routes). Posts live under any
 * published page, so their canonical URL needs the full lookup.
 */
export function pageTreePaths(nodes: readonly PageTreeNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: readonly PageTreeNode[]): void => {
    for (const node of list) {
      out.set(node.id, node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Copy of the tree without the nodes matching `hide`. A hidden node's
 * children take its place among its siblings, with their paths UNCHANGED -
 * the URL of a page still runs through its parent's slug (`/main/podstrona`),
 * only the list entry of the parent disappears.
 *
 * PO CO. Strona główna (`main`) jest serwowana pod `/` i ma w mapie własny
 * link „Strona główna"; strona CMS pod adresem trasy kodowej (`/blog`,
 * `/contribute`) nie jest w ogóle renderowana, bo trasa statyczna wygrywa
 * z trasą uniwersalną. Wycięcie takiego węzła razem z poddrzewem zabrałoby
 * mapie podstrony, które działają.
 */
export function withoutPageTreeNodes(
  nodes: readonly PageTreeNode[],
  hide: (node: PageTreeNode) => boolean,
): PageTreeNode[] {
  const out: PageTreeNode[] = [];
  for (const node of nodes) {
    const children = withoutPageTreeNodes(node.children, hide);
    if (hide(node)) out.push(...children);
    else out.push({ ...node, children });
  }
  return out;
}

/**
 * Canonical path of a post: parent page path + post slug - the same rule as
 * the XML `posts` section (`lib/server/sitemapEntries.server.ts`) and the
 * legacy `/post/<slug>` 301 (`lib/routing/legacyPostPath.ts`). `null` when the
 * parent is not in the lookup (unpublished, noindex, or outside the query
 * window) - the caller then falls back to the `/post/<slug>` alias.
 */
export function postCanonicalPath(
  paths: ReadonlyMap<string, string>,
  post: { slug: string; parent_page_id: string | null | undefined },
): string | null {
  if (!post.slug || !post.parent_page_id) return null;
  const parent = paths.get(post.parent_page_id);
  return parent ? `${parent}/${post.slug}` : null;
}

export interface SiteMapPlanInput {
  /** Id strony serwowanej pod `/` (`configuredHomepagePageId`) albo `null`. */
  homepageId: string | null;
  /** Adresy tras KODOWYCH linkowanych w mapie wprost, w kolejności renderu. */
  staticHrefs: readonly string[];
  /**
   * Trasy kodowe, które serwis przekierowuje 301 na stronę CMS
   * (`"/events" -> "/wydarzenia"`). Reguła działa tylko wtedy, gdy strona
   * docelowa jest w drzewie opublikowanych - inaczej link trasy zostaje.
   */
  legacyRedirects?: Readonly<Record<string, string>>;
  /**
   * Ścieżki tras kodowych z bezwarunkowym `noindex` (`NOINDEX_CODE_ROUTE_PATHS`):
   * strona CMS pod takim adresem znika z drzewa (dzieci zostają), bo renderuje
   * się tam trasa, której wyszukiwarka nie ma indeksować.
   */
  noindexPaths?: ReadonlySet<string>;
}

export interface SiteMapPlan {
  /** Drzewo do wyrenderowania: bez strony głównej i stron przesłoniętych trasami kodowymi. */
  tree: PageTreeNode[];
  /** Id -> ścieżka po PEŁNYM drzewie (z węzłami ukrytymi) - adresy wpisów. */
  paths: Map<string, string>;
  /** Linki statyczne, które zostają w mapie (bez zdublowanych i przekierowanych). */
  staticHrefs: Set<string>;
}

/**
 * Jeden adres = jeden wpis mapy HTML. Scala linki tras kodowych z drzewem stron.
 *
 * PO CO (2026-10 audyt mapy HTML). Mapa zlewała dwa niezależne źródła bez
 * żadnej deduplikacji: `/blog` i `/contribute` stały raz jako link trasy
 * i drugi raz jako strona CMS o tym samym slugu, strona główna (`main`) jako
 * „Strona główna" pod `/` i drugi raz pod `/main`, a „Wydarzenia" jako
 * `/events` (301 na `/wydarzenia`) obok samej strony `/wydarzenia`.
 *
 * Reguły, w tej kolejności:
 *   1. trasa z `legacyRedirects`, której cel jest opublikowaną stroną, ZNIKA -
 *      link prowadziłby przez 301 na adres, który mapa ma już w drzewie;
 *      z drzewa znika też strona CMS pod takim adresem (dzieci zostają),
 *      bo middleware przekierowuje adres, zanim dojdzie do routera;
 *   2. strona CMS pod adresem trasy kodowej znika z drzewa (jej dzieci
 *      zostają) - trasa statyczna wygrywa z uniwersalną, więc pod tym
 *      adresem i tak renderuje się trasa, a nie strona;
 *   3. strona główna znika z drzewa (dzieci zostają) - ma link `/`;
 *   4. adres trasy kodowej z bezwarunkowym `noindex` (`/login`, `/club`,
 *      `/people`) znika z mapy: z linków tras i z drzewa (strona CMS pod nim
 *      znika, dzieci zostają) - mapa nie może linkować adresu, który każe
 *      wyszukiwarce go pominąć.
 */
export function planSiteMap(rows: readonly PageTreeRow[], input: SiteMapPlanInput): SiteMapPlan {
  const full = buildPageTree(rows);
  const paths = pageTreePaths(full);
  const published = new Set(paths.values());
  // Źródła reguł, które naprawdę działają (cel opublikowany). Liczone po
  // WSZYSTKICH regułach, nie tylko po linkach tras: recenzja 2026-10 - strona
  // CMS o slugu `statut` przy opublikowanej `/o-nas` zostawała w drzewie jako
  // link na 301, bo reguła 2 widziała już zbiór linków BEZ `/statut`.
  const redirected = new Set<string>();
  for (const [source, target] of Object.entries(input.legacyRedirects ?? {})) {
    if (published.has(target)) redirected.add(source);
  }
  const staticHrefs = new Set<string>();
  for (const href of input.staticHrefs) {
    // Reguła 4 obejmuje też linki tras: `/people` (katalog osób) odpowiada
    // `noindex, nofollow`, więc nie ma go w mapie, tak jak strony CMS pod nim.
    if (!redirected.has(href) && !(input.noindexPaths?.has(href) ?? false)) staticHrefs.add(href);
  }
  const tree = withoutPageTreeNodes(
    full,
    (node) =>
      node.id === input.homepageId ||
      staticHrefs.has(node.path) ||
      redirected.has(node.path) ||
      (input.noindexPaths?.has(node.path) ?? false),
  );
  return { tree, paths, staticHrefs };
}

/** Total node count (used by the site map heading counters). */
export function countPageTreeNodes(nodes: readonly PageTreeNode[]): number {
  let count = 0;
  for (const node of nodes) count += 1 + countPageTreeNodes(node.children);
  return count;
}
