// Walidacja markerów `[fn]…[/fn]` w polach tekstowych bloków.
//
// Silnik renderujący (`precomputeFootnotes` + regex `\[fn\]([\s\S]*?)\[\/fn\]`)
// dopasowuje NAJKRÓTSZY blok - w praktyce toleruje pojedyncze osierocone
// `[fn]` (pomija je) i milcząco przycina zagnieżdżenia. To utrudnia autorom
// wychwycenie literówek. Ten walidator skanuje TE SAME pola co
// `collectFootnoteOrigins` i zwraca opisowe ostrzeżenia:
//
//   - UNCLOSED           : `[fn]` bez zamykającego `[/fn]`.
//   - STRAY_CLOSE        : `[/fn]` bez pary otwierającej przed nim.
//   - NESTED             : kolejny `[fn]` przed zamknięciem poprzedniego.
//   - EMPTY              : `[fn][/fn]` (silnik i tak dropuje - ostrzegamy jako
//                          "no-op", żeby autor wiedział, że nic nie doda).
//   - MALFORMED_TAG      : "podobne" tagi typu `[FN]`, `[ fn ]`, `[fn/]`,
//                          `[/fn ]`, które NIE zostaną rozpoznane przez silnik.
//
// Wszystkie ścieżki (`path`) są zgodne z `FootnoteOrigin.path` z
// `footnoteOrigins.ts`, żeby UI mógł wskazać konkretny blok/pole.

import type { Block, BlocksDoc } from "./types";
import type { PathSegment } from "./footnoteOrigins";

export type FootnoteIssueKind = "UNCLOSED" | "STRAY_CLOSE" | "NESTED" | "EMPTY" | "MALFORMED_TAG";

export interface FootnoteIssue {
  kind: FootnoteIssueKind;
  /** Ścieżka do pola-stringa (bez wiodącego "blocks"). */
  path: PathSegment[];
  /** Indeks top-level bloku, dla ludzkiej etykiety. */
  blockIndex: number;
  /** Typ top-level bloku, dla ludzkiej etykiety. */
  blockType: string;
  /** Ludzki opis (PL) - do bezpośredniego wyświetlenia w UI. */
  message: string;
  /** Fragment kontekstu z pola (max 80 znaków wokół problemu). */
  excerpt: string;
}

// -------------------- skan pola --------------------

// Rozpoznajemy DOKŁADNIE `[fn]` i `[/fn]` (case-sensitive, bez spacji) - tak
// jak silnik. Wszystko inne łapiemy oddzielnym "malformed" regexem.
const TAG_RE = /\[fn\]|\[\/fn\]/g;
const MALFORMED_RE = /\[\s*\/?\s*fn\s*\/?\s*\]/gi;

interface FieldCtx {
  path: PathSegment[];
  blockIndex: number;
  blockType: string;
  out: FootnoteIssue[];
}

function excerptAround(source: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(source.length, index + length + 20);
  const slice = source.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + slice + (end < source.length ? "…" : "");
}

function pushIssue(
  ctx: FieldCtx,
  kind: FootnoteIssueKind,
  message: string,
  index: number,
  length: number,
  source: string,
): void {
  ctx.out.push({
    kind,
    path: [...ctx.path],
    blockIndex: ctx.blockIndex,
    blockType: ctx.blockType,
    message,
    excerpt: excerptAround(source, index, length),
  });
}

function scanField(ctx: FieldCtx, value: unknown): void {
  if (typeof value !== "string" || value.length === 0) return;
  // Szybki filtr - jeśli nie ma nawet nawiasu z "fn", nie skanujemy.
  if (!/\[\/?\s*fn/i.test(value)) return;

  // 1) Malformed - warianty NIE-akceptowane przez silnik. Robimy TO pierwsze,
  //    żeby ostrzec o literówkach zanim policzymy pary "poprawnych" markerów
  //    (te literówki wtedy zawyżałyby fałszywe "UNCLOSED").
  MALFORMED_RE.lastIndex = 0;
  const seenMalformed: Array<{ text: string; index: number }> = [];
  for (let m: RegExpExecArray | null; (m = MALFORMED_RE.exec(value)) !== null;) {
    // Pomijamy dokładne, poprawne tagi.
    if (m[0] === "[fn]" || m[0] === "[/fn]") continue;
    seenMalformed.push({ text: m[0], index: m.index });
  }
  for (const it of seenMalformed) {
    pushIssue(
      ctx,
      "MALFORMED_TAG",
      `Nierozpoznany tag "${it.text}" - przypis nie zostanie utworzony. Użyj dokładnie "[fn]" oraz "[/fn]" (małe litery, bez spacji).`,
      it.index,
      it.text.length,
      value,
    );
  }

  // 2) Parowanie poprawnych markerów - stos otwartych `[fn]`.
  TAG_RE.lastIndex = 0;
  const openStack: Array<{ index: number }> = [];
  for (let m: RegExpExecArray | null; (m = TAG_RE.exec(value)) !== null;) {
    const tag = m[0];
    const at = m.index;
    if (tag === "[fn]") {
      if (openStack.length > 0) {
        pushIssue(
          ctx,
          "NESTED",
          'Zagnieżdżony przypis: znaleziono kolejne "[fn]" przed zamknięciem poprzedniego. Zamknij wcześniejszy "[/fn]" lub usuń zagnieżdżenie.',
          at,
          tag.length,
          value,
        );
      }
      openStack.push({ index: at });
    } else {
      // `[/fn]`
      const opened = openStack.pop();
      if (!opened) {
        pushIssue(
          ctx,
          "STRAY_CLOSE",
          'Zamknięcie "[/fn]" bez wcześniejszego "[fn]". Dodaj otwierający marker lub usuń nadmiarowy koniec.',
          at,
          tag.length,
          value,
        );
        continue;
      }
      // Poprawna para - sprawdź, czy nie jest pusta.
      const inner = value.slice(opened.index + 4, at);
      if (inner.trim().length === 0) {
        pushIssue(
          ctx,
          "EMPTY",
          'Pusty przypis "[fn][/fn]" - zostanie pominięty przy publikacji. Uzupełnij treść lub usuń marker.',
          opened.index,
          at - opened.index + tag.length,
          value,
        );
      }
    }
  }
  // Wszystko, co zostało na stosie, to niezamknięte otwarcia.
  for (const opened of openStack) {
    pushIssue(
      ctx,
      "UNCLOSED",
      'Otwarty "[fn]" bez zamykającego "[/fn]". Silnik pominie ten przypis - dodaj zamknięcie.',
      opened.index,
      4,
      value,
    );
  }
}

// -------------------- skan bloków (dokładnie te same pola co origins) --------

interface WalkCtx {
  out: FootnoteIssue[];
  topIndex: number;
  topType: string;
}

function fieldCtx(ctx: WalkCtx, path: PathSegment[]): FieldCtx {
  return {
    path,
    blockIndex: ctx.topIndex,
    blockType: ctx.topType,
    out: ctx.out,
  };
}

function walk(ctx: WalkCtx, blocks: readonly Block[], prefix: PathSegment[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const isTop = prefix.length === 0;
    if (isTop) {
      ctx.topIndex = i;
      ctx.topType = b.type;
    }
    const base: PathSegment[] = [...prefix, i, "data"];
    if (b.type === "paragraph" || b.type === "html" || b.type === "spoiler") {
      scanField(fieldCtx(ctx, [...base, "html"]), (b.data as { html?: unknown }).html);
    } else if (b.type === "heading") {
      scanField(fieldCtx(ctx, [...base, "text"]), (b.data as { text?: unknown }).text);
    } else if (b.type === "quote") {
      scanField(fieldCtx(ctx, [...base, "text"]), (b.data as { text?: unknown }).text);
      scanField(fieldCtx(ctx, [...base, "cite"]), (b.data as { cite?: unknown }).cite);
    } else if (b.type === "list") {
      const items = (b.data as { items?: unknown }).items;
      if (Array.isArray(items)) {
        items.forEach((it, idx) => scanField(fieldCtx(ctx, [...base, "items", idx]), it));
      }
    } else if (b.type === "table") {
      const rows = (b.data as { rows?: unknown }).rows;
      if (Array.isArray(rows)) {
        rows.forEach((row, ri) => {
          if (!Array.isArray(row)) return;
          row.forEach((cell, ci) => scanField(fieldCtx(ctx, [...base, "rows", ri, ci]), cell));
        });
      }
    } else if (b.type === "columns") {
      const left = (b.data as { left?: unknown }).left;
      const right = (b.data as { right?: unknown }).right;
      if (Array.isArray(left)) walk(ctx, left as Block[], [...base, "left"]);
      if (Array.isArray(right)) walk(ctx, right as Block[], [...base, "right"]);
    } else if (b.type === "group" || b.type === "row" || b.type === "stack" || b.type === "grid") {
      const children = (b.data as { children?: unknown }).children;
      if (Array.isArray(children)) {
        walk(ctx, children as Block[], [...base, "children"]);
      }
    }
  }
}

/**
 * Zwraca listę ostrzeżeń dla wszystkich pól tekstowych w dokumencie.
 * Pusta lista = wszystko w porządku.
 */
export function validateFootnotes(doc: BlocksDoc | null | undefined): FootnoteIssue[] {
  if (!doc?.blocks?.length) return [];
  const ctx: WalkCtx = { out: [], topIndex: 0, topType: "" };
  walk(ctx, doc.blocks, []);
  return ctx.out;
}
