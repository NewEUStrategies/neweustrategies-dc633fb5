// Pomocnik testów: każda flaga z `clipPath` ma WŁASNY id, a jej ścieżka wskazuje
// właśnie ten id (`url(#...)`). Stały id (`uj-diag`) dublował się w dokumencie,
// gdy przełącznik języka stał w headerze i w szufladzie (Nu: „Duplicate ID").
import { expect } from "vitest";

export function expectOwnClipPaths(root: ParentNode, count: number): void {
  const svgs = [...root.querySelectorAll("svg")].filter((svg) => svg.querySelector("defs [id]"));
  expect(svgs).toHaveLength(count);
  const ids = svgs.map((svg) => {
    const id = svg.querySelector("defs [id]")!.getAttribute("id")!;
    // Znaki bezpieczne w `url(#...)` i w selektorze (useId Reacta 19.2: `_R_..._`).
    expect(id).toMatch(/^uj[A-Za-z0-9_-]+$/);
    expect(svg.querySelector("[clip-path]")?.getAttribute("clip-path")).toBe(`url(#${id})`);
    return id;
  });
  expect(new Set(ids).size).toBe(count);
}
