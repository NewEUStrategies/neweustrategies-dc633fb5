// Operacje na dzieciach bloków kontenerowych (group/row/stack/grid: `children`,
// columns: `left`/`right`). Kształt danych jest IDENTYCZNY z tym, co czyta
// renderer publiczny (`readBlocksArray`), więc front renderuje zagnieżdżenia
// bez żadnej migracji. Czyste funkcje - testowalne bez DOM.

import type { Block, Json } from "./types";
import { toJson } from "@/lib/content-model/json";

/** Bezpieczny odczyt tablicy bloków z pola data kontenera. */
export function readChildBlocks(data: Record<string, Json>, key: string): Block[] {
  const raw = data[key];
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && !Array.isArray(x) && "type" in x && "id" in x) {
      out.push(x as unknown as Block);
    }
  }
  return out;
}

/** Nowy blok kontenera z podmienioną tablicą dzieci pod wskazanym kluczem. */
export function withChildBlocks(block: Block, key: string, children: Block[]): Block {
  return { ...block, data: { ...block.data, [key]: toJson(children) } };
}

export function insertChildAt(children: readonly Block[], idx: number, child: Block): Block[] {
  const at = Math.min(Math.max(idx, 0), children.length);
  const next = [...children];
  next.splice(at, 0, child);
  return next;
}

export function removeChildAt(children: readonly Block[], idx: number): Block[] {
  return children.filter((_, i) => i !== idx);
}

export function moveChild(children: readonly Block[], from: number, to: number): Block[] {
  if (from === to || from < 0 || from >= children.length) return [...children];
  const bounded = Math.min(Math.max(to, 0), children.length - 1);
  const next = [...children];
  const [moved] = next.splice(from, 1);
  next.splice(bounded, 0, moved);
  return next;
}

export function updateChild(children: readonly Block[], id: string, child: Block): Block[] {
  return children.map((b) => (b.id === id ? child : b));
}

/** Podmienia dziecko o `id` na jeden LUB wiele bloków (transformacje). */
export function replaceChildWith(
  children: readonly Block[],
  id: string,
  replacement: readonly Block[],
): Block[] {
  const idx = children.findIndex((b) => b.id === id);
  if (idx < 0) return [...children];
  const next = [...children];
  next.splice(idx, 1, ...replacement);
  return next;
}
