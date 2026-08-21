// Katalogi taksonomii klubów w panelu - REGUŁY wyprowadzone z dwóch organizmów.
//
// CZEGO TU NIE BYŁO. `ClubTopicsManager` (366 linii) i `ClubSpecializationsManager`
// (482 linie) to dwa CRUD-y tej samej natury: wpis taksonomii wspólnej dla całej
// organizacji, z wersją roboczą w `useState`, walidacją w ciele `onClick` i
// mapowaniem odmowy bazy w ciele `onError`. Każda z tych reguł mieszkała w JSX-ie
// po jednym egzemplarzu NA ORGANIZM, więc poprawka w jednym miejscu nie docierała
// do drugiego - a obie powierzchnie obiecują to samo.
//
// CO JEST REGUŁĄ, A NIE UKŁADEM:
//
//   1. WYŁĄCZENIE JEST OSOBNE OD USUNIĘCIA. Wpis używany przez kluby albo wątki
//      NIE może zniknąć (etykieta w archiwum przestałaby się rozwiązywać,
//      a klub zostałby bez strony wejściowej), więc kasowanie działa wyłącznie
//      przy ZEROWYM użyciu. Wpis SYSTEMOWY nie kasuje się nigdy - nawet nieużywany.
//      To jest reguła bezpieczeństwa danych, nie kosmetyka przycisku.
//   2. OBA JĘZYKI SĄ WYMAGANE. Wpis z nazwą tylko po polsku wygląda na `/en/`
//      jak brak treści, a nie jak brak tłumaczenia - dlatego walidacja pyta
//      o PL i EN razem, zanim cokolwiek pojedzie do bazy.
//   3. KLUCZ (obszar) I ADRES (specjalizacja) SĄ NIEZMIENNE PO ZAPISIE i podążają
//      za nazwą polską tylko DO PIERWSZEGO tknięcia pola. Klucz zmieniony przy
//      edycji osierociłby istniejące wiersze, a adres jest publicznym kontraktem
//      (`/club/specialization/<slug>`).
//   4. ODMOWA BAZY MA DWIE DROGI. `duplicate key` i `*_in_use` to sytuacje, które
//      administrator naprawia sam, więc dostają zdanie ze słownika; każdy inny
//      błąd jedzie SUROWYM tekstem z bazy, bo zamiana go na ogólne „nie udało się”
//      kasuje jedyną informację diagnostyczną, jaką mamy.
//   5. KOLEJNOŚĆ NOWEGO WPISU wynika z ostatniego wiersza listy (+10), a nie ze
//      stałej - dwa nowe wpisy z tą samą kolejnością rozstrzygałyby się losowo.
//
// GRANICA WARSTW. Zero Reacta, zero i18next, zero klienta Supabase (typy wejścia
// i payloadu są importowane WYŁĄCZNIE jako typy). Wychodzą stąd KLUCZE i18n
// i deskryptory, nigdy gotowy tekst.
//
// SŁOWNIK PANELU, A NIE PUBLICZNY. Klucze `adminClubs.topics.*` zwracane przez
// ten moduł mieszkają w `i18n-clubs-admin`, który trzeba jawnie dociągnąć przez
// `ensureAdminClubsI18n()`. Moduł tego NIE robi i nie może - nie zna Reacta ani
// i18next - więc jest osiągalny wyłącznie z organizmów panelu, które to wołają
// (granicy pilnuje bramka `adminClubsI18nLoading.gate`). Klucze
// `adminClubs.specializations.*` zostały w słowniku PUBLICZNYM, bo tę sekcję
// woła także powierzchnia publiczna.
import { isValidTopicKey, slugifyTopicKey, type ClubTopicAdminRow } from "./topicCatalog";
import type { ClubTopicUpsertInput } from "./topicsApi";
import type {
  ClubSpecializationAdminRow,
  ClubSpecializationUpsertInput,
} from "./specializationsApi";
import { clubSlugFromName } from "./types";

// ---------------------------------------------------------------------------
// Reguły wspólne dla obu katalogów
// ---------------------------------------------------------------------------

/**
 * Komunikat odmowy: albo KLUCZ słownika (sytuacja, którą administrator naprawia
 * sam), albo goły tekst z bazy (wszystko inne - to jedyna diagnostyka, jaką mamy).
 */
export interface CatalogFailure {
  key: string | null;
  text: string;
}

/** Najkrótsza etykieta, jaką dopuszczamy w obu kolumnach językowych. */
export const CATALOG_MIN_LABEL = 2;

/** Kolejność nowego wpisu: ostatni wiersz + 10; pusta lista startuje od 100. */
export function nextCatalogSortOrder(rows: readonly { sort_order: number }[]): number {
  return (rows.at(-1)?.sort_order ?? 90) + 10;
}

/** Ile wpisów jest włączonych - licznik nad listą, nie długość listy. */
export function catalogActiveCount(rows: readonly { is_active: boolean }[]): number {
  return rows.filter((row) => row.is_active).length;
}

/**
 * Czy przycisk usunięcia jest ODCIĘTY. Dwa niezależne powody: wpis systemowy
 * (nigdy) i wpis w użyciu (dopóki ktokolwiek go używa).
 */
export function catalogDeleteBlocked(row: { is_system: boolean }, usage: number): boolean {
  return row.is_system || usage > 0;
}

/** Obie kolumny językowe wypełnione na tyle, żeby wpis miał nazwę. */
export function catalogLabelsComplete(labelPl: string, labelEn: string): boolean {
  return labelPl.trim().length >= CATALOG_MIN_LABEL && labelEn.trim().length >= CATALOG_MIN_LABEL;
}

/** Pole „kolejność” jest liczbą; treść niebędąca liczbą znaczy zero, nie NaN. */
export function catalogSortOrderValue(raw: string): number {
  return Number(raw) || 0;
}

function failure(message: string, needle: string, key: string): CatalogFailure {
  return message.includes(needle) ? { key, text: message } : { key: null, text: message };
}

// ---------------------------------------------------------------------------
// Obszary tematyczne (`admin_club_topic_upsert`)
// ---------------------------------------------------------------------------

/** Wersja robocza wpisu katalogu obszarów - dokładnie to, co widzi formularz. */
export interface ClubTopicDraft {
  /** `null` = wpis NOWY; wartość = edycja istniejącego (klucz jest zamrożony). */
  id: string | null;
  key: string;
  labelPl: string;
  labelEn: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

export const EMPTY_CLUB_TOPIC_DRAFT: ClubTopicDraft = {
  id: null,
  key: "",
  labelPl: "",
  labelEn: "",
  sortOrder: 100,
  isActive: true,
  isSystem: false,
};

export function clubTopicDraftFromRow(row: ClubTopicAdminRow): ClubTopicDraft {
  return {
    id: row.id,
    key: row.key,
    labelPl: row.label_pl,
    labelEn: row.label_en,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isSystem: row.is_system,
  };
}

export function newClubTopicDraft(rows: readonly { sort_order: number }[]): ClubTopicDraft {
  return { ...EMPTY_CLUB_TOPIC_DRAFT, sortOrder: nextCatalogSortOrder(rows) };
}

/**
 * Klucz, który POJEDZIE do bazy. Nowy wpis normalizuje wpisaną treść, edycja
 * oddaje klucz bez zmiany - zmieniony klucz osierociłby istniejące wiersze.
 */
export function clubTopicSaveKey(draft: ClubTopicDraft): string {
  return draft.id === null ? slugifyTopicKey(draft.key) : draft.key;
}

/**
 * Wersja robocza po zmianie nazwy polskiej. Klucz podąża za nazwą TYLKO dopóki
 * nikt go nie tknął - inaczej ręczna poprawka klucza znikałaby przy każdej
 * literze dopisanej do nazwy.
 */
export function clubTopicDraftWithLabelPl(
  draft: ClubTopicDraft,
  labelPl: string,
  keyTouched: boolean,
): ClubTopicDraft {
  return { ...draft, labelPl, key: keyTouched ? draft.key : slugifyTopicKey(labelPl) };
}

/** Klucz i18n powodu odrzucenia albo `null`, gdy wersja robocza jest gotowa. */
export function clubTopicDraftIssue(draft: ClubTopicDraft): string | null {
  if (!catalogLabelsComplete(draft.labelPl, draft.labelEn)) {
    return "adminClubs.topics.errors.labels";
  }
  if (draft.id === null && !isValidTopicKey(clubTopicSaveKey(draft))) {
    return "adminClubs.topics.errors.key";
  }
  return null;
}

/** Payload RPC. Etykiety jadą PRZYCIĘTE - spacja na końcu nazwy to nie nazwa. */
export function clubTopicUpsertPayload(draft: ClubTopicDraft): ClubTopicUpsertInput {
  return {
    id: draft.id,
    key: clubTopicSaveKey(draft),
    labelPl: draft.labelPl.trim(),
    labelEn: draft.labelEn.trim(),
    sortOrder: draft.sortOrder,
    isActive: draft.isActive,
  };
}

/** Ile razy obszar jest używany - kluby I wątki, bo oba trzymają etykietę. */
export function clubTopicUsage(row: { clubs_count: number; threads_count: number }): number {
  return row.clubs_count + row.threads_count;
}

export function clubTopicSaveFailure(error: Error): CatalogFailure {
  return failure(error.message, "duplicate key", "adminClubs.topics.errors.duplicate");
}

export function clubTopicDeleteFailure(error: Error): CatalogFailure {
  return failure(error.message, "topic_in_use", "adminClubs.topics.errors.inUse");
}

// ---------------------------------------------------------------------------
// Specjalizacje (`admin_club_specialization_upsert`)
// ---------------------------------------------------------------------------

/** Najkrótszy adres publiczny, jaki dopuszczamy dla specjalizacji. */
export const SPECIALIZATION_MIN_SLUG = 3;

export interface ClubSpecializationDraft {
  id: string | null;
  slug: string;
  labelPl: string;
  labelEn: string;
  leadPl: string;
  leadEn: string;
  descPl: string;
  descEn: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

export const EMPTY_CLUB_SPECIALIZATION_DRAFT: ClubSpecializationDraft = {
  id: null,
  slug: "",
  labelPl: "",
  labelEn: "",
  leadPl: "",
  leadEn: "",
  descPl: "",
  descEn: "",
  icon: "Globe2",
  sortOrder: 100,
  isActive: true,
  isSystem: false,
};

/**
 * Przepisanie wiersza RPC na wersję roboczą. Kolumny opisowe są NULL-owalne,
 * a formularz nie ma jak pokazać `null` - pustka jedzie jako pusty napis, żeby
 * pole tekstowe nie stało się niesterowane.
 */
export function clubSpecializationDraftFromRow(
  row: ClubSpecializationAdminRow,
): ClubSpecializationDraft {
  return {
    id: row.id,
    slug: row.slug,
    labelPl: row.label_pl,
    labelEn: row.label_en,
    leadPl: row.lead_pl ?? "",
    leadEn: row.lead_en ?? "",
    descPl: row.desc_pl ?? "",
    descEn: row.desc_en ?? "",
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    isSystem: row.is_system,
  };
}

export function newClubSpecializationDraft(
  rows: readonly { sort_order: number }[],
): ClubSpecializationDraft {
  return { ...EMPTY_CLUB_SPECIALIZATION_DRAFT, sortOrder: nextCatalogSortOrder(rows) };
}

/**
 * Adres, który POJEDZIE do bazy. Nowy wpis normalizuje wpisaną treść, edycja
 * oddaje adres bez zmiany - adres jest w URL-u, więc nie zmienia się razem
 * z etykietą.
 */
export function clubSpecializationSaveSlug(draft: ClubSpecializationDraft): string {
  return draft.id === null ? clubSlugFromName(draft.slug) : draft.slug;
}

export function clubSpecializationDraftWithLabelPl(
  draft: ClubSpecializationDraft,
  labelPl: string,
  slugTouched: boolean,
): ClubSpecializationDraft {
  return { ...draft, labelPl, slug: slugTouched ? draft.slug : clubSlugFromName(labelPl) };
}

export function clubSpecializationDraftIssue(draft: ClubSpecializationDraft): string | null {
  if (!catalogLabelsComplete(draft.labelPl, draft.labelEn)) {
    return "adminClubs.specializations.errors.labels";
  }
  if (draft.id === null && clubSpecializationSaveSlug(draft).length < SPECIALIZATION_MIN_SLUG) {
    return "adminClubs.specializations.errors.slug";
  }
  return null;
}

/**
 * Payload RPC. `key` startuje jako adres: kolumna jest NOT NULL, a jedynym
 * sensownym pierwszym kluczem redakcyjnym jest to, co widać w URL-u.
 */
export function clubSpecializationUpsertPayload(
  draft: ClubSpecializationDraft,
): ClubSpecializationUpsertInput {
  const slug = clubSpecializationSaveSlug(draft);
  return {
    id: draft.id,
    slug,
    key: slug,
    labelPl: draft.labelPl.trim(),
    labelEn: draft.labelEn.trim(),
    leadPl: draft.leadPl.trim(),
    leadEn: draft.leadEn.trim(),
    descPl: draft.descPl.trim(),
    descEn: draft.descEn.trim(),
    icon: draft.icon,
    sortOrder: draft.sortOrder,
    isActive: draft.isActive,
  };
}

/** Użycie specjalizacji liczy się KLUBAMI - wątek nie ma specjalizacji. */
export function clubSpecializationUsage(row: { clubs_count: number }): number {
  return row.clubs_count;
}

export function clubSpecializationSaveFailure(error: Error): CatalogFailure {
  return failure(error.message, "duplicate key", "adminClubs.specializations.errors.duplicate");
}

export function clubSpecializationDeleteFailure(error: Error): CatalogFailure {
  return failure(error.message, "in_use", "adminClubs.specializations.errors.inUse");
}
