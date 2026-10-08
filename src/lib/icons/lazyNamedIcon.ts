import { lazy, type ComponentType } from "react";
import { createLucideIcon, HelpCircle, type IconNode, type LucideProps } from "lucide-react";
import { iconChunkIndex } from "./iconChunkIndex.js";
import { unpackIconNode } from "./iconNodePacking";

const chunks = [
  () => import("./chunks/icons-0.json"),
  () => import("./chunks/icons-1.json"),
  () => import("./chunks/icons-2.json"),
  () => import("./chunks/icons-3.json"),
];
const cache = new Map<string, ComponentType<LucideProps>>();

async function loadNode(name: string): Promise<IconNode | null> {
  const module = await chunks[iconChunkIndex(name)]();
  const registry: Record<string, unknown> = module.default;
  const node = registry[name];
  // Historical aliases point to a canonical entry instead of duplicating SVGs.
  if (typeof node === "string") return loadNode(node);
  return unpackIconNode(node);
}

/** Public content pays for one small data chunk, not the complete icon picker. */
export function lazyNamedIcon(key: string): ComponentType<LucideProps> {
  const name = key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
  let icon = cache.get(name);
  if (!icon) {
    icon = lazy(async () => {
      const node = await loadNode(name);
      return { default: node ? createLucideIcon(name, node) : HelpCircle };
    });
    cache.set(name, icon);
  }
  return icon;
}
