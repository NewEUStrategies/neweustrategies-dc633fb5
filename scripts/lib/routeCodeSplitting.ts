type SplitNode = "loader" | "component" | "errorComponent" | "notFoundComponent";

/** Reading routes keep their current startup path. Loaders for unrelated pages
 * are imported on navigation instead of joining every homepage boot bundle.
 * beforeLoad/auth guards remain in their route modules.
 */
export function routeSplitBehavior({ routeId }: { routeId: string }): SplitNode[][] | undefined {
  if (
    routeId === "__root__" ||
    routeId === "/" ||
    routeId === "/$" ||
    /^\/(?:en(?:\/|$)|blog(?:\/|$)|post\/|category\/|tag\/|author\/)/.test(routeId)
  )
    return undefined;
  return [["loader"], ["component"], ["errorComponent"], ["notFoundComponent"]];
}
