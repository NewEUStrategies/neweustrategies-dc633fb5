/**
 * Pure helpers for the virtual folder path model used by the media manager.
 *
 * Paths are always absolute and slash-delimited, opening and closing with a
 * "/" ("/", "/press/", "/press/2026/"). These mirror the server-side
 * normalisation in lib/media.functions.ts so the client and server agree on
 * what a folder key looks like.
 */

/** Collapses, trims and canonicalises a path to the `/a/b/` form. */
export function normalizePath(input: string): string {
  let s = input.trim();
  if (!s.startsWith("/")) s = "/" + s;
  if (!s.endsWith("/")) s = s + "/";
  return s.replace(/\/+/g, "/");
}

/** Returns the parent folder path, or "/" for the root. */
export function parentOf(path: string): string {
  const n = normalizePath(path);
  if (n === "/") return "/";
  const parts = n.slice(1, -1).split("/");
  parts.pop();
  return parts.length ? "/" + parts.join("/") + "/" : "/";
}

/** Returns the last segment (display name) of a folder path. */
export function folderName(path: string): string {
  const n = normalizePath(path);
  if (n === "/") return "/";
  const parts = n.slice(1, -1).split("/");
  return parts[parts.length - 1] ?? "/";
}

/** Nesting depth: root is 0, "/a/" is 1, "/a/b/" is 2. */
export function folderDepth(path: string): number {
  const n = normalizePath(path);
  return n === "/" ? 0 : n.slice(1, -1).split("/").length;
}

/** A breadcrumb trail from the root down to (and including) `currentPath`. */
export function buildBreadcrumbs(currentPath: string): Array<{ label: string; path: string }> {
  const n = normalizePath(currentPath);
  const parts = n.slice(1, -1).split("/").filter(Boolean);
  const out: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let acc = "/";
  for (const p of parts) {
    acc = acc + p + "/";
    out.push({ label: p, path: acc });
  }
  return out;
}

/** True when `path` is `ancestor` itself or nested beneath it. */
export function isWithin(path: string, ancestor: string): boolean {
  return normalizePath(path).startsWith(normalizePath(ancestor));
}

/**
 * Immediate child folder segments of `currentPath`, derived from the union of
 * explicit folder rows and folders implied by media locations. Returns the
 * fully-qualified child paths, sorted.
 */
export function directChildFolders(
  currentPath: string,
  folderPaths: readonly string[],
  mediaFolderPaths: readonly string[],
): string[] {
  const base = normalizePath(currentPath);
  const set = new Set<string>();
  const collect = (candidate: string): void => {
    if (candidate.startsWith(base) && candidate !== base) {
      const rest = candidate.slice(base.length);
      const seg = rest.split("/")[0];
      if (seg) set.add(base + seg + "/");
    }
  };
  for (const p of folderPaths) collect(p);
  for (const p of mediaFolderPaths) collect(p);
  return Array.from(set).sort();
}
