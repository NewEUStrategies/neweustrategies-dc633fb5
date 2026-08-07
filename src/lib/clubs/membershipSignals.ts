// Sygnały "co się zmieniło w moich klubach" - czysta projekcja, bez Reacta.
//
// `club_my_memberships` zwraca dwa znaczniki czasu: `last_activity_at`
// (ostatni ruch w klubie) i `last_read_at` (kiedy JA tam ostatnio byłem). Ich
// różnica mówi "tu coś się wydarzyło od twojej ostatniej wizyty".
//
// Od migracji A18 przychodzi z bazy TAKŻE `unread_count` - policzony triggerem
// licznik wpisów, których nie widziałem. Wcześniej ten plik miał w nagłówku
// notkę, że liczby nie ma i "nie da się jej uczciwie udawać"; to była prawda
// dopóty, dopóki nikt jej nie liczył. Teraz liczy ją baza, więc kropka ustępuje
// liczbie, a porównanie znaczników zostaje jako AWARYJNE źródło sygnału:
// członkostwo sprzed migracji ma `unread_count = 0`, a klub, w którym coś się
// wydarzyło, nadal ma prawo zamigać.
import type { ClubMembershipRow } from "./types";

export interface ClubMembershipSignal {
  clubId: string;
  slug: string;
  hasUnseen: boolean;
  /** Liczba nieprzeczytanych wpisów; 0 gdy sygnał pochodzi ze znaczników. */
  unread: number;
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
  unread_count?: number;
}): boolean {
  // Licznik z bazy jest silniejszy niż porównanie znaczników: jest dokładny
  // i nie miga po cudzej edycji, która ruszyła `last_activity_at`.
  if ((row.unread_count ?? 0) > 0) return true;
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
    unread: row.unread_count,
  }));
}

/**
 * Sortuje członkostwa tak, jak czyta się hub: najpierw kluby z nowościami,
 * potem po ostatniej aktywności. Kolejność jest deterministyczna do końca
 * (tiebreaker po slugu), inaczej lista skakałaby przy każdym refetchu.
 */
export function sortMemberships(rows: readonly ClubMembershipRow[]): ClubMembershipRow[] {
  return [...rows].sort((a, b) => {
    // Najpierw kluby z nieprzeczytanymi, i to POSORTOWANE po ich liczbie:
    // dwadzieścia nowych wpisów jest pilniejsze niż jeden.
    if (b.unread_count !== a.unread_count) return b.unread_count - a.unread_count;
    const unseen = Number(hasUnseenActivity(b)) - Number(hasUnseenActivity(a));
    if (unseen !== 0) return unseen;
    const ta = a.last_activity_at === null ? 0 : Date.parse(a.last_activity_at);
    const tb = b.last_activity_at === null ? 0 : Date.parse(b.last_activity_at);
    if (tb !== ta) return tb - ta;
    return a.slug.localeCompare(b.slug);
  });
}
