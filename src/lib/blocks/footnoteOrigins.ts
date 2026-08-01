// Adresowanie i mutacja pojedynczych przypisów `[fn]…[/fn]` w BlocksDoc.
//
// `precomputeFootnotes` odpowiada tylko za render (mapa: klucz pola → HTML z
// markerami). Do edycji z panelu „Przypisy źródłowe" potrzebujemy ODWROTNEJ
// operacji: znaleźć w źródłowej treści bloków dokładnie N-te wystąpienie
// `[fn]…[/fn]` w danym polu i podmienić jego wnętrze - bez ruszania reszty
// dokumentu, klasy pól obsługiwane 1:1 jak w rendererze.
//
// Zasięg pól świadomie odzwierciedla `precomputeFootnotes`:
//   paragraph/html/spoiler: data.html
//   heading:                data.text
//   quote:                  data.text, data.cite
//   list:                   data.items[i]  (string)
//   table:                  data.rows[r][c] (string)
//   kontenery (columns/group/row/stack/grid): rekurencyjnie po dzieciach
//
// Origin.path jest w pełni serializowalny (JSON) - segment po segmencie
// prowadzi do STRINGU pola, w którym siedzi marker. `occurrence` (0-based)
// wskazuje, które wystąpienie `[fn]…[/fn]` w tym stringu edytujemy.

import type { Block, BlocksDoc } from "./types";

export type PathSegment = string | number;

export interface FootnoteOrigin {
  /** Ścieżka do pola-stringa wewnątrz `doc.blocks` (bez `blocks` na początku). */
  path: PathSegment[];
  /** 0-based indeks wystąpienia `[fn]…[/fn]` w polu spod `path`. */
  occurrence: number;
}

export interface FootnoteEntry {
  /** Ciągły numer w kolejności dokumentowej (1-based). Zgodny z rendererem. */
  id: number;
  /** Aktualna treść (surowa, między `[fn]` a `[/fn]`). */
  html: string;
  origin: FootnoteOrigin;
}

const FN_RE = /\[fn\]([\s\S]*?)\[\/fn\]/g;

// -------------------- collect --------------------

interface Ctx {
  out: FootnoteEntry[];
  counter: { n: number };
}

function scanField(ctx: Ctx, value: unknown, path: PathSegment[]): void {
  if (typeof value !== "string" || !value.includes("[fn]")) return;
  let occurrence = 0;
  // FN_RE ma flagę `g`, ale używamy `replace` z funkcją, więc `lastIndex`
  // nie wycieka między wywołaniami - dokładnie jak w silniku `expandFootnotes`.
  value.replace(FN_RE, (_m, inner: string) => {
    const html = String(inner ?? "");
    if (html.trim().length === 0) return ""; // puste są dropowane w silniku
    ctx.out.push({
      id: ++ctx.counter.n,
      html,
      origin: { path: [...path], occurrence },
    });
    occurrence++;
    return "";
  });
}

function scanBlocks(ctx: Ctx, blocks: readonly Block[], prefix: PathSegment[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const base: PathSegment[] = [...prefix, i, "data"];
    if (b.type === "paragraph" || b.type === "html" || b.type === "spoiler") {
      scanField(ctx, (b.data as { html?: unknown }).html, [...base, "html"]);
    } else if (b.type === "heading") {
      scanField(ctx, (b.data as { text?: unknown }).text, [...base, "text"]);
    } else if (b.type === "quote") {
      scanField(ctx, (b.data as { text?: unknown }).text, [...base, "text"]);
      scanField(ctx, (b.data as { cite?: unknown }).cite, [...base, "cite"]);
    } else if (b.type === "list") {
      const items = (b.data as { items?: unknown }).items;
      if (Array.isArray(items)) {
        items.forEach((it, idx) => scanField(ctx, it, [...base, "items", idx]));
      }
    } else if (b.type === "table") {
      const rows = (b.data as { rows?: unknown }).rows;
      if (Array.isArray(rows)) {
        rows.forEach((row, ri) => {
          if (!Array.isArray(row)) return;
          row.forEach((cell, ci) => scanField(ctx, cell, [...base, "rows", ri, ci]));
        });
      }
    } else if (b.type === "columns") {
      const left = (b.data as { left?: unknown }).left;
      const right = (b.data as { right?: unknown }).right;
      if (Array.isArray(left)) scanBlocks(ctx, left as Block[], [...base, "left"]);
      if (Array.isArray(right)) scanBlocks(ctx, right as Block[], [...base, "right"]);
    } else if (b.type === "group" || b.type === "row" || b.type === "stack" || b.type === "grid") {
      const children = (b.data as { children?: unknown }).children;
      if (Array.isArray(children)) {
        scanBlocks(ctx, children as Block[], [...base, "children"]);
      }
    }
  }
}

/**
 * Zbiera wszystkie przypisy z dokumentu w kolejności renderowania, wraz z
 * origin-em (ścieżka do pola + numer wystąpienia). Numeracja `id` jest ciągła
 * i identyczna z tym, co wyprodukuje `precomputeFootnotes` na TYM samym
 * dokumencie - puste `[fn][/fn]` nie zużywają numeru.
 */
export function collectFootnoteOrigins(doc: BlocksDoc | null | undefined): FootnoteEntry[] {
  if (!doc?.blocks?.length) return [];
  const ctx: Ctx = { out: [], counter: { n: 0 } };
  scanBlocks(ctx, doc.blocks, []);
  return ctx.out;
}

// -------------------- update --------------------

type MutableRecord = { [k: string]: unknown };

/**
 * Immutable "set at path" - zwraca kopię `root` z podmienionym liściem.
 * Kopiujemy tylko strukturę na ścieżce; reszta pozostaje współdzielona
 * referencyjnie (tanio dla dużych dokumentów).
 */
function setAtPath<T>(root: T, path: PathSegment[], value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const arr = Array.isArray(root) ? (root as unknown[]).slice() : [];
    arr[head] = setAtPath(arr[head], rest, value);
    return arr as unknown as T;
  }
  const obj: MutableRecord = { ...(root as unknown as MutableRecord) };
  obj[head] = setAtPath(obj[head], rest, value);
  return obj as unknown as T;
}

function getAtPath(root: unknown, path: PathSegment[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = (cur as MutableRecord | unknown[])[seg as never];
  }
  return cur;
}

/**
 * Podmienia N-te wystąpienie `[fn]…[/fn]` w polu spod `origin.path` na
 * nową treść. Zwraca nowy `BlocksDoc` (immutable). Puste `newHtml` (po trim)
 * usuwa cały marker - to zgadza się z semantyką silnika, który puste
 * `[fn][/fn]` po prostu dropuje.
 */
export function updateFootnoteAtOrigin(
  doc: BlocksDoc,
  origin: FootnoteOrigin,
  newHtml: string,
): BlocksDoc {
  const fieldPath: PathSegment[] = ["blocks", ...origin.path];
  const source = getAtPath(doc, fieldPath);
  if (typeof source !== "string") return doc;

  const trimmed = newHtml.trim();
  let seen = 0;
  const replaced = source.replace(FN_RE, (match, inner: string) => {
    if (String(inner ?? "").trim().length === 0) return match; // silnik dropuje puste - nie liczą się
    const isTarget = seen === origin.occurrence;
    seen++;
    if (!isTarget) return match;
    if (trimmed.length === 0) return "";
    return `[fn]${newHtml}[/fn]`;
  });

  if (replaced === source) return doc;
  return setAtPath(doc, fieldPath, replaced);
}
