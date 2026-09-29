import { lazy, type ComponentType } from "react";
import { createLucideIcon, HelpCircle, type IconNode, type LucideProps } from "lucide-react";
import { iconChunkIndex } from "./iconChunkIndex.js";

const chunks = [
  () => import("./chunks/icons-0.json"),
  () => import("./chunks/icons-1.json"),
  () => import("./chunks/icons-2.json"),
  () => import("./chunks/icons-3.json"),
  () => import("./chunks/icons-4.json"),
  () => import("./chunks/icons-5.json"),
  () => import("./chunks/icons-6.json"),
  () => import("./chunks/icons-7.json"),
  () => import("./chunks/icons-8.json"),
  () => import("./chunks/icons-9.json"),
  () => import("./chunks/icons-10.json"),
  () => import("./chunks/icons-11.json"),
  () => import("./chunks/icons-12.json"),
  () => import("./chunks/icons-13.json"),
  () => import("./chunks/icons-14.json"),
  () => import("./chunks/icons-15.json"),
];
const cache = new Map<string, ComponentType<LucideProps>>();

function isIconNode(value: unknown): value is IconNode {
  return (
    Array.isArray(value) &&
    value.every(
      (part) =>
        Array.isArray(part) &&
        part.length === 2 &&
        ["circle", "ellipse", "g", "line", "path", "polygon", "polyline", "rect"].includes(
          part[0],
        ) &&
        part[1] !== null &&
        typeof part[1] === "object",
    )
  );
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
      const module = await chunks[iconChunkIndex(name)]();
      const registry: Record<string, unknown> = module.default;
      const node = registry[name];
      return { default: isIconNode(node) ? createLucideIcon(name, node) : HelpCircle };
    });
    cache.set(name, icon);
  }
  return icon;
}
