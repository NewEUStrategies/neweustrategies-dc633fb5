// Projekcja wiersza `content_revisions` na pozycję LISTY historii zmian.
//
// Wyniesione z `src/lib/revisions.functions.ts`, gdzie siedziało wewnątrz
// handlera server fn - a więc za `createServerFn`, middleware `requireStaff`,
// rozwiązaniem tenanta i rate-limitem. Reguła jest tymczasem czysta i niesie
// warunek, który decyduje o ROZMIARZE odpowiedzi: lista może mieć 50 wierszy,
// a każdy snapshot to komplet 40 pól wpisu razem z dokumentami buildera
// i blokami. Zwrócenie ich w całości zamieniłoby listę historii w transfer
// liczony w megabajtach.

/** Pozycja listy rewizji - dokładnie to, co widzi klient. */
export interface RevisionListItem {
  id: string;
  created_at: string;
  author_id: string | null;
  note: string | null;
  title_pl: string | null;
  title_en: string | null;
  status: string | null;
  editor: string | null;
}

/** Wiersz `content_revisions` w kształcie, w jakim czyta go server fn. */
export interface RevisionRow {
  id: string;
  created_at: string;
  author_id: string | null;
  note: string | null;
  snapshot: unknown;
}

/** Pola snapshotu wystawiane na liście. Reszta NIE opuszcza serwera. */
export const REVISION_LIST_FIELDS = ["title_pl", "title_en", "status", "editor"] as const;

/**
 * Odczyt pola snapshotu na potrzeby listy. Przechodzą WYŁĄCZNIE napisy.
 *
 * Snapshot jest kolumną `jsonb` bez schematu w bazie - historyczne wiersze
 * mogą nieść pod tą samą nazwą liczbę, obiekt albo null (kolumna zmieniła typ,
 * migracja dopisała pole, wiersz powstał przed jakąś zmianą). Wpuszczenie
 * takiej wartości na wylot rozjeżdża typ `RevisionListItem`, a lista renderuje
 * „[object Object]" zamiast tytułu.
 */
function pickString(snapshot: Record<string, unknown>, key: string): string | null {
  const value = snapshot[key];
  return typeof value === "string" ? value : null;
}

/**
 * Wiersz rewizji -> pozycja listy. Snapshot NIE jest przekazywany dalej:
 * pełne migawki pobiera osobna ścieżka (`getRevisionSnapshots`), ograniczona
 * z definicji do dwóch pozycji plus stan bieżący.
 */
export function projectRevisionListItem(row: RevisionRow): RevisionListItem {
  const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    created_at: row.created_at,
    author_id: row.author_id,
    note: row.note,
    title_pl: pickString(snapshot, "title_pl"),
    title_en: pickString(snapshot, "title_en"),
    status: pickString(snapshot, "status"),
    editor: pickString(snapshot, "editor"),
  };
}

/** Cała lista rewizji, w kolejności otrzymanej z bazy (najnowsze pierwsze). */
export function projectRevisionList(rows: readonly RevisionRow[] | null | undefined) {
  return (rows ?? []).map(projectRevisionListItem);
}

/**
 * Nota kopii bezpieczeństwa robionej PRZED nadpisaniem treści przy
 * przywracaniu. Stała, bo szuka się po niej w historii - a jest to jedyny
 * ślad stanu, który przywracanie nadpisało.
 */
export const PRE_RESTORE_NOTE = "pre_restore";

/** Czy ta pozycja historii jest automatyczną kopią sprzed przywracania. */
export function isPreRestoreEntry(item: Pick<RevisionListItem, "note">): boolean {
  return item.note === PRE_RESTORE_NOTE;
}
