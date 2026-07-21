// Współdzielone, czyste pomocniki renderera bloków: bezpieczne, otypowane
// czytniki `block.data` (Json) oraz drobne funkcje prezentacyjne. Zero `any` /
// `as any` - wszędzie zawężanie z `unknown`. Wydzielone z BlocksRenderer, żeby
// warstwy atoms / molecules / organisms miały jedno źródło prawdy.

import type { Block, Json } from "@/lib/blocks/types";
import { sanitizeHtml } from "@/lib/sanitize";

// ---------------------------------------------------------------------------
// Otypowane czytniki Json (bez rzutowań na `any`)
// ---------------------------------------------------------------------------

/** Wartość `data[key]` jako string; `fallback` gdy brak / niewłaściwy typ. */
export function str(data: Record<string, Json>, key: string, fallback = ""): string {
  const v = data[key];
  return typeof v === "string" ? v : fallback;
}

/** Wartość `data[key]` jako skończona liczba; `fallback` gdy się nie da. */
export function num(data: Record<string, Json>, key: string, fallback: number): number {
  const v = data[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Wartość `data[key]` jako boolean z jawną wartością domyślną. Wzorzec
 * "domyślnie włączone" (`data.showX !== false`) uzyskuje się przez `bool(d,
 * "showX", true)`, a "domyślnie wyłączone" przez `bool(d, "showX", false)`.
 */
export function bool(data: Record<string, Json>, key: string, fallback: boolean): boolean {
  const v = data[key];
  return typeof v === "boolean" ? v : fallback;
}

/** Tablica stringów z `data[key]` (elementy nie-stringowe są pomijane). */
export function strList(data: Record<string, Json>, key: string): string[] {
  const v = data[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Surowa tablica Json z `data[key]` (lub pusta) - do przekazania widokom. */
export function jsonList(data: Record<string, Json>, key: string): Json[] {
  const v = data[key];
  return Array.isArray(v) ? v : [];
}

/**
 * Mapuje tablicę obiektów Json z `data[key]` na typ `T`. Elementy niebędące
 * obiektami (stringi, tablice, null) są pomijane.
 */
export function objList<T>(
  data: Record<string, Json>,
  key: string,
  map: (o: Record<string, Json>) => T,
): T[] {
  const v = data[key];
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) {
    if (x && typeof x === "object" && !Array.isArray(x)) out.push(map(x));
  }
  return out;
}

/** Wyciąga zagnieżdżone bloki (children / left / right) z pola Json. */
export function readBlocksArray(raw: Json | undefined): Block[] {
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && !Array.isArray(x) && "type" in x && "id" in x) {
      // Kształt bloku został już zweryfikowany przez safeParseBlocks na wejściu
      // dokumentu; tu jedynie zawężamy Json -> Block bez utraty bezpieczeństwa.
      out.push(x as unknown as Block);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pomocniki prezentacyjne
// ---------------------------------------------------------------------------

/** Klasy wyrównania bloku wg `style.align`. */
export function alignClass(block: Block): string {
  const a = block.style?.align;
  if (a === "center") return "text-center mx-auto";
  if (a === "right") return "text-right ml-auto";
  if (a === "wide") return "mx-auto w-full max-w-5xl";
  if (a === "full") return "w-full";
  return "";
}

/**
 * Jedyny sanitizer HTML dla wszystkich sinków bloków. Deleguje do wspólnego
 * `sanitizeHtml` (lib/sanitize), które - w odróżnieniu od gołego profilu
 * DOMPurify {html:true} - zabrania też iframe/form/object/embed/style oraz
 * inline-handlerów. Dzięki temu polityka HTML silnika bloków jest identyczna z
 * silnikiem buildera, a autor CMS nie przemyci phishingowego <form> ani
 * clickjackingowego <iframe> do bloku paragraph/html/spoiler.
 */
export function sanitize(html: string): string {
  return sanitizeHtml(html);
}

/** Slug do kotwic nagłówków (deterministyczny, ASCII). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
