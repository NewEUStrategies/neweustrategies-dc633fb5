// Sygnały "co się zmieniło w moich klubach" - czysta projekcja, bez Reacta.
//
// `club_my_memberships` zwraca dwa znaczniki czasu, których nikt dotąd nie
// zestawił: `last_activity_at` (ostatni ruch w klubie) i `last_read_at`
// (kiedy JA tam ostatnio byłem). Ich różnica to jedyna informacja, jakiej
// potrzeba, żeby powiedzieć "tu coś się wydarzyło od twojej ostatniej wizyty"
// - bez licznika nieprzeczytanych, którego baza nie liczy i którego nie da się
// uczciwie udawać.
//
// Świadomie NIE zwracamy liczby. "3 nowe" wymagałoby zliczenia wątków po
// dacie, czyli zapytania per klub; kropka wymaga porównania dwóch kolumn,
// które i tak już przyszły.
import type { ClubMembershipRow } from "./types";

export interface ClubMembershipSignal {
  clubId: string;
  slug: string;
  hasUnseen: boolean;
}

/**
 * Klub ma "coś nowego", gdy ostatnia aktywność jest PÓŹNIEJSZA niż moja
 * ostatnia wizyta.
 *
 * Brak `last_read_at` (nigdy nie otwarto klubu) liczy się jako nowość, ale
 * tylko wtedy, gdy w klubie w ogóle coś było - świeżo założony, pusty klub
 * nie ma czym migać.
 */
export function hasUnseenActivity(row: {
  last_activity_at: string | null;
  last_read_at: string | null;
}): boolean {
  if (row.last_activity_at === null) return false;
  const activity = Date.parse(row.last_activity_at);
  if (Number.isNaN(activity)) return false;
  if (row.last_read_at === null) return true;
  const read = Date.parse(row.last_read_at);
  if (Number.isNaN(read)) return true;
  return activity > read;
}

/** Sygnały dla całej listy członkostw, w kolejności "najpierw nowe". */
export function toMembershipSignals(rows: readonly ClubMembershipRow[]): ClubMembershipSignal[] {
  return rows.map((row) => ({
    clubId: row.club_id,
    slug: row.slug,
    hasUnseen: hasUnseenActivity(row),
  }));
}

/**
 * Sortuje członkostwa tak, jak czyta się hub: najpierw kluby z nowościami,
 * potem po ostatniej aktywności. Kolejność jest deterministyczna do końca
 * (tiebreaker po slugu), inaczej lista skakałaby przy każdym refetchu.
 */
export function sortMemberships(rows: readonly ClubMembershipRow[]): ClubMembershipRow[] {
  return [...rows].sort((a, b) => {
    const unseen = Number(hasUnseenActivity(b)) - Number(hasUnseenActivity(a));
    if (unseen !== 0) return unseen;
    const ta = a.last_activity_at === null ? 0 : Date.parse(a.last_activity_at);
    const tb = b.last_activity_at === null ? 0 : Date.parse(b.last_activity_at);
    if (tb !== ta) return tb - ta;
    return a.slug.localeCompare(b.slug);
  });
}
