// Schowek encji inline: kopiowanie gotowego odwołania do innego miejsca.
//
// W obrębie jednego materiału (także między PL i EN) nic nie trzeba przenosić:
// wklejony `<span data-nes-entity="id">` wskazuje ten sam rekord rejestru,
// więc oba miejsca są z konstrukcji zsynchronizowane. Dane jadą w schowku
// tylko po to, by odwołanie wklejone do INNEGO materiału (albo innej karty)
// od razu miało swój rekord - w materiale docelowym staje się on jego własną
// kopią.
//
// Dwa kanały, bo przeglądarki różnie traktują własne typy MIME:
//   1. `application/x-nes-inline-entities` w DataTransfer zdarzenia copy/paste,
//   2. localStorage (ta sama przeglądarka, inna karta) - awaryjnie.

import { normalizeInlineEntity, type InlineEntity } from "./model";

export const INLINE_ENTITY_CLIPBOARD_MIME = "application/x-nes-inline-entities";
const STORAGE_KEY = "nes:inline-entities:clipboard";
/** Po dobie wpis w localStorage jest uznawany za przeterminowany. */
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTITIES = 50;

interface ClipboardEnvelope {
  v: 1;
  at: number;
  entities: InlineEntity[];
}

export function serializeInlineEntityClipboard(
  entities: readonly InlineEntity[],
  now: number = Date.now(),
): string {
  const envelope: ClipboardEnvelope = {
    v: 1,
    at: now,
    entities: entities.slice(0, MAX_ENTITIES),
  };
  return JSON.stringify(envelope);
}

/** Parsuje kopertę; wszystko, co nie przechodzi normalizacji, jest odrzucane. */
export function parseInlineEntityClipboard(
  raw: string | null | undefined,
  now: number = Date.now(),
  maxAgeMs: number = Number.POSITIVE_INFINITY,
): InlineEntity[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const envelope = parsed as { v?: unknown; at?: unknown; entities?: unknown };
    if (envelope.v !== 1 || !Array.isArray(envelope.entities)) return [];
    if (typeof envelope.at === "number" && now - envelope.at > maxAgeMs) return [];
    const out: InlineEntity[] = [];
    for (const item of envelope.entities.slice(0, MAX_ENTITIES)) {
      const entity = normalizeInlineEntity(item);
      if (entity) out.push(entity);
    }
    return out;
  } catch {
    return [];
  }
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Zapamiętuje skopiowane encje (kanał awaryjny między kartami). */
export function rememberCopiedInlineEntities(entities: readonly InlineEntity[]): void {
  if (entities.length === 0) return;
  try {
    storage()?.setItem(STORAGE_KEY, serializeInlineEntityClipboard(entities));
  } catch {
    /* tryb prywatny / pełny magazyn - schowek MIME wystarczy */
  }
}

/** Odczytuje zapamiętane encje o podanych identyfikatorach. */
export function recallCopiedInlineEntities(
  ids: readonly string[],
  now: number = Date.now(),
): InlineEntity[] {
  if (ids.length === 0) return [];
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return [];
  }
  const wanted = new Set(ids);
  return parseInlineEntityClipboard(raw, now, STORAGE_TTL_MS).filter((e) => wanted.has(e.id));
}
