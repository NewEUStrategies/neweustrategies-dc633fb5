// Rejestr encji inline w dokumencie bloków (`doc.meta.inlineEntities`) oraz
// operacje na odwołaniach `<span data-nes-entity="id">` w treści.
//
// Rejestr jest trzymany w KAŻDYM dokumencie językowym (PL i EN) jako identyczna
// kopia - renderer dostaje jeden `BlocksDoc` i musi być samowystarczalny (zero
// zapytań przy SSR). Spójność obu kopii zapewnia `mirrorInlineEntities`,
// wołane przez edytor przy każdej propagacji zmian.
//
// Moduł czysty, bez DOM - operuje na stringach HTML i JSON-ie bloków.

import type { Block, BlocksDoc, Json } from "@/lib/blocks/types";
import { escapeInlineText } from "@/lib/blocks/inlineHtml";
import {
  inlineEntityDisplayName,
  inlineEntityToJson,
  normalizeInlineEntityRegistry,
  type InlineEntity,
  type InlineEntityRegistry,
} from "./model";

export const INLINE_ENTITY_META_KEY = "inlineEntities";

/** Atrybut odwołania w treści (kontrakt zapisu - nie zmieniać bez migracji). */
export const INLINE_ENTITY_ATTR = "data-nes-entity";
export const INLINE_ENTITY_KIND_ATTR = "data-nes-entity-kind";

const TOKEN_ID_RE = /data-nes-entity="([^"]+)"/g;
/** Odwołanie z samym tekstem w środku (tak serializuje je węzeł TipTap). */
const TOKEN_WITH_LABEL_RE = /(<span\b[^>]*\bdata-nes-entity="([^"]+)"[^>]*>)([^<]*)(<\/span>)/g;

/** Szybki test przed kosztowniejszym przetwarzaniem. */
export function containsInlineEntityMarkup(value: unknown): value is string {
  return typeof value === "string" && value.includes(INLINE_ENTITY_ATTR);
}

/** Markup odwołania - jedyne miejsce, które go składa (edytor, schowek, testy). */
export function inlineEntityTokenHtml(entity: InlineEntity): string {
  return `<span ${INLINE_ENTITY_ATTR}="${entity.id}" ${INLINE_ENTITY_KIND_ATTR}="${entity.kind}">${escapeInlineText(inlineEntityDisplayName(entity))}</span>`;
}

// ---------------------------------------------------------------------------
// Odczyt / zapis rejestru
// ---------------------------------------------------------------------------

export function readInlineEntities(
  doc: Pick<BlocksDoc, "meta"> | null | undefined,
): Record<string, InlineEntity> {
  return normalizeInlineEntityRegistry(doc?.meta?.[INLINE_ENTITY_META_KEY]);
}

/** Zwraca dokument z podmienionym rejestrem (pusty rejestr usuwa klucz z `meta`). */
export function withInlineEntities<T extends BlocksDoc>(doc: T, registry: InlineEntityRegistry): T {
  const entries = Object.values(registry);
  const meta: Record<string, Json> = { ...(doc.meta ?? {}) };
  if (entries.length === 0) {
    delete meta[INLINE_ENTITY_META_KEY];
  } else {
    const json: Record<string, Json> = {};
    for (const entity of entries) json[entity.id] = inlineEntityToJson(entity);
    meta[INLINE_ENTITY_META_KEY] = json;
  }
  const next = { ...doc };
  if (Object.keys(meta).length > 0) next.meta = meta;
  else delete next.meta;
  return next;
}

// ---------------------------------------------------------------------------
// Przejście po wszystkich stringach w blokach (także zagnieżdżonych)
// ---------------------------------------------------------------------------

function visitStrings(value: Json, visit: (s: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitStrings(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) visitStrings(item, visit);
  }
}

function mapStrings(value: Json, map: (s: string) => string): Json {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = mapStrings(item, map);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = mapStrings(item, map);
      if (next !== item) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}

/** Liczba odwołań do każdej encji w blokach dokumentu (kolejność dokumentu). */
export function countInlineEntityUsage(blocks: readonly Block[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    visitStrings(block.data, (s) => {
      if (!s.includes(INLINE_ENTITY_ATTR)) return;
      for (const match of s.matchAll(TOKEN_ID_RE)) {
        const id = match[1];
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    });
  }
  return counts;
}

/** Identyfikatory encji użytych w blokach. */
export function collectInlineEntityIds(blocks: readonly Block[]): Set<string> {
  return new Set(countInlineEntityUsage(blocks).keys());
}

/** Identyfikatory encji w dowolnym fragmencie HTML (np. treść schowka). */
export function collectInlineEntityIdsFromHtml(html: string): string[] {
  if (!html.includes(INLINE_ENTITY_ATTR)) return [];
  const out = new Set<string>();
  for (const match of html.matchAll(TOKEN_ID_RE)) out.add(match[1]);
  return [...out];
}

/**
 * Encje faktycznie użyte w dokumencie - to, co renderer publiczny przekazuje
 * karcie. Rekordy rejestru bez odwołania w treści nie trafiają na stronę.
 */
export function referencedInlineEntities(
  blocks: readonly Block[],
  registry: InlineEntityRegistry,
): InlineEntity[] {
  const ids = collectInlineEntityIds(blocks);
  const out: InlineEntity[] = [];
  for (const id of ids) {
    const entity = registry[id];
    if (entity) out.push(entity);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synchronizacja etykiet odwołań
// ---------------------------------------------------------------------------

/**
 * Przepisuje tekst wewnątrz odwołań na aktualną nazwę encji.
 *
 * Tekst w środku jest treścią zastępczą: czytają go RSS, wyszukiwarka, TTS
 * i każdy renderer, który nie zna encji. Po zmianie nazwy w jednym miejscu
 * wszystkie odwołania w materiale mają mówić to samo.
 */
export function syncInlineEntityLabelsInHtml(html: string, registry: InlineEntityRegistry): string {
  if (!html.includes(INLINE_ENTITY_ATTR)) return html;
  return html.replace(
    TOKEN_WITH_LABEL_RE,
    (full, open: string, id: string, label: string, close: string) => {
      const entity = registry[id];
      if (!entity) return full;
      const next = escapeInlineText(inlineEntityDisplayName(entity));
      return next === label ? full : `${open}${next}${close}`;
    },
  );
}

/** Wersja dokumentowa - zwraca TEN SAM obiekt, gdy nic się nie zmieniło. */
export function syncInlineEntityLabels<T extends BlocksDoc>(
  doc: T,
  registry: InlineEntityRegistry,
): T {
  let changed = false;
  const blocks = doc.blocks.map((block) => {
    const data = mapStrings(block.data, (s) => syncInlineEntityLabelsInHtml(s, registry));
    if (data === block.data) return block;
    changed = true;
    return { ...block, data: data as Record<string, Json> };
  });
  return changed ? { ...doc, blocks } : doc;
}

// ---------------------------------------------------------------------------
// Operacje edytorskie
// ---------------------------------------------------------------------------

/** Dodaje/aktualizuje encję i od razu wyrównuje etykiety jej odwołań. */
export function upsertInlineEntity<T extends BlocksDoc>(doc: T, entity: InlineEntity): T {
  const registry = { ...readInlineEntities(doc), [entity.id]: entity };
  return syncInlineEntityLabels(withInlineEntities(doc, registry), { [entity.id]: entity });
}

/** Dokłada encje nieznane w dokumencie (import ze schowka). Znane zostają bez zmian. */
export function importInlineEntities<T extends BlocksDoc>(
  doc: T,
  entities: readonly InlineEntity[],
): T {
  const registry = readInlineEntities(doc);
  let changed = false;
  for (const entity of entities) {
    if (registry[entity.id]) continue;
    registry[entity.id] = entity;
    changed = true;
  }
  return changed ? withInlineEntities(doc, registry) : doc;
}

/** Usuwa encję z rejestru (tylko nieużywane - wołający sprawdza licznik). */
export function removeInlineEntity<T extends BlocksDoc>(doc: T, id: string): T {
  const registry = readInlineEntities(doc);
  if (!registry[id]) return doc;
  delete registry[id];
  return withInlineEntities(doc, registry);
}

function sameEntity(a: InlineEntity | undefined, b: InlineEntity | undefined): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Lustro rejestru między wersjami językowymi.
 *
 * Wynikowy rejestr `other` = cały rejestr `active` + te rekordy `other`, do
 * których `other` wciąż się odwołuje, a których `active` nie zna (nigdy nie
 * psujemy drugiej wersji językowej). Rekord nieużywany w `other` i usunięty
 * w `active` znika - tak działa „usuń nieużywane" z menedżera encji.
 *
 * Zwraca TEN SAM obiekt `other`, gdy nic się nie zmieniło - edytor woła to przy
 * każdej propagacji, więc brak zmian nie może produkować nowych referencji.
 */
export function mirrorInlineEntities<T extends BlocksDoc>(active: BlocksDoc, other: T): T {
  const source = readInlineEntities(active);
  const target = readInlineEntities(other);
  const sourceIds = Object.keys(source);
  const targetIds = Object.keys(target);
  if (sourceIds.length === 0 && targetIds.length === 0) return other;

  const referencedInOther = targetIds.some((id) => !source[id])
    ? collectInlineEntityIds(other.blocks)
    : new Set<string>();
  const next: Record<string, InlineEntity> = { ...source };
  for (const id of targetIds) {
    if (!source[id] && referencedInOther.has(id)) next[id] = target[id];
  }

  const nextIds = Object.keys(next);
  const registryChanged =
    nextIds.length !== targetIds.length || nextIds.some((id) => !sameEntity(next[id], target[id]));
  if (!registryChanged) return other;
  return syncInlineEntityLabels(withInlineEntities(other, next), next);
}
