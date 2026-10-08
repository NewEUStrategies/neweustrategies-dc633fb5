// Format of `chunks/icons-N.json` (written by scripts/generate-icon-chunks.mjs):
// each part is a `[tag, attrs]` tuple without a React key, or - for a `<path>`
// whose only attribute is `d` - the bare path string. This rebuilds exactly the
// node the chunks used to carry: same tags, same attributes in the same order
// and the index key `String(i)` last, so SSR and client SVG markup is unchanged.
import type { IconNode } from "lucide-react";

const SVG_TAGS = ["circle", "ellipse", "g", "line", "path", "polygon", "polyline", "rect"];

/** The icon node stored in a chunk, or `null` when the entry has an unknown shape. */
export function unpackIconNode(value: unknown): IconNode | null {
  if (!Array.isArray(value)) return null;
  const node: IconNode = [];
  for (const [index, part] of value.entries()) {
    const key = String(index);
    if (typeof part === "string") {
      node.push(["path", { d: part, key }]);
    } else if (
      Array.isArray(part) &&
      part.length === 2 &&
      SVG_TAGS.includes(part[0]) &&
      part[1] !== null &&
      typeof part[1] === "object"
    ) {
      node.push([part[0], { ...part[1], key }]);
    } else {
      return null;
    }
  }
  return node;
}
