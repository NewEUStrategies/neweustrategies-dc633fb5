// Pure page-hierarchy builder for the public HTML site map (/sitemap). Turns
// flat `pages` rows (id/parent_id) into an ordered tree with canonical paths,
// mirroring the URL rule used everywhere else (path = parent path + slug).
// Framework-free and unit-tested; the route only feeds it query rows.

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
 * (unpublished/excluded parent) is promoted to a root - its subtree stays
 * discoverable instead of silently disappearing from the site map.
 */
export function buildPageTree(rows: readonly PageTreeRow[]): PageTreeNode[] {
  const nodes = new Map<string, PageTreeNode>();
  for (const row of rows) nodes.set(row.id, { ...row, path: `/${row.slug}`, children: [] });

  const roots: PageTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
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

/** Total node count (used by the site map heading counters). */
export function countPageTreeNodes(nodes: readonly PageTreeNode[]): number {
  let count = 0;
  for (const node of nodes) count += 1 + countPageTreeNodes(node.children);
  return count;
}
