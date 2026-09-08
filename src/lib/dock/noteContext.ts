// Kontekst notatki: który materiał (analiza, raport, wywiad, podcast, strona,
// wydarzenie) użytkownik aktualnie czyta. Widok materiału publikuje tu swoje
// dane, a notatnik w doku proponuje przypięcie notatki do tego materiału.
//
// Świadomie prosty magazyn modułowy (useSyncExternalStore) - kontekst żyje
// tylko w pamięci karty i nie wymaga providera nad całym drzewem.
import { useSyncExternalStore } from "react";

export const NOTE_ENTITY_TYPES = [
  "post",
  "page",
  "event",
  "podcast",
  "document",
  "external",
] as const;
export type NoteEntityType = (typeof NOTE_ENTITY_TYPES)[number];

export interface NoteContext {
  entityType: NoteEntityType;
  entityId: string;
  title: string;
  url: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNoteEntityType(value: unknown): value is NoteEntityType {
  return NOTE_ENTITY_TYPES.includes(value as NoteEntityType);
}

/** Baza trzyma entity_id jako uuid - inne identyfikatory odrzucamy. */
export function isStorableEntityId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

let current: NoteContext | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function sameContext(a: NoteContext | null, b: NoteContext | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.entityType === b.entityType &&
    a.entityId === b.entityId &&
    a.title === b.title &&
    a.url === b.url
  );
}

export function setNoteContext(next: NoteContext | null): void {
  if (sameContext(current, next)) return;
  current = next;
  emit();
}

export function clearNoteContext(entityId?: string): void {
  if (entityId && current?.entityId !== entityId) return;
  setNoteContext(null);
}

export function getNoteContext(): NoteContext | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNoteContext(): NoteContext | null {
  return useSyncExternalStore(subscribe, getNoteContext, () => null);
}
