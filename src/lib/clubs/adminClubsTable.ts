// Tabela klubów w panelu - REGUŁY wiersza jako czyste funkcje.
//
// CO BYŁO W JSX-IE I DLACZEGO TO REGUŁA, A NIE UKŁAD. `ClubsTable.tsx` trzymał
// w swoim ciele cztery decyzje, z których każda ma widoczny skutek, a żadna nie
// zależy od tego, czy wiersz rysuje się jako `<tr>` (od `lg`), czy jako karta
// (niżej) - a rysuje się jako JEDNO I DRUGIE, więc każda z nich była tam
// zapisana DWA RAZY:
//
//   1. DEGRADACJA WARTOŚCI CHECK-A. Generator Supabase typuje `status`
//      i `visibility` z `admin_club_list` jako goły `string`, bo SQL nie ma unii
//      literałów. Znacznik (`atoms/ClubBadges.tsx`) indeksuje `Record<ClubStatus,
//      Tone>`, więc wartość spoza słownika dałaby `undefined` w klasie - czyli
//      znacznik BEZ TONU, który kłamie o stanie klubu zamiast go pokazać.
//      Nagłówek atomu mówi wprost, że dowód tej degradacji leży TUTAJ.
//      Fallback nie jest neutralny: nieznany status czyta się jako `draft`
//      (bursztyn: „ktoś musi na to spojrzeć"), nieznana widoczność jako
//      `members`, bo pomyłka w drugą stronę pokazywałaby klub jako PUBLICZNY.
//   2. PUSTE MIEJSCE MA ZNAK. Brak prowadzących i brak aktywności renderują
//      kreskę, a nie pustą komórkę - puste miejsce w tabeli czyta się jak błąd
//      wczytywania. Reguła jest jedna dla obu wariantów układu.
//   3. DATA AKTYWNOŚCI NIE MOŻE WYWALIĆ WIERSZA. `admin_club_list` typuje
//      `last_activity_at` jako non-null, ale kolumny CHECK-owe/timestampowe tego
//      RPC oddają PUSTKĘ jako pusty napis, a `new Date("")` to `Invalid Date`.
//      `formatDate` zwraca wtedy `""` - i bez tej gałęzi w komórce zostawał
//      pusty napis udający „brak aktywności".
//   4. ADRES PODGLĄDU PUBLICZNEGO (`/club/<slug>`) jest w obu wariantach ten
//      sam i jest kontraktem linku, a nie ozdobą: różnica między wariantami
//      sprowadzała się do tego, że karta otwiera go `window.open`, bo cała
//      karta jest jednym linkiem do edytora.
//
// GRANICA WARSTW. Zero Reacta, zero i18n (`formatDate`/`uiLang`/`pickLocalized`
// to czyste helpery formatowania, nie instancja i18next), zero klienta Supabase.
// Wejściem jest wiersz `admin_club_list` plus SUROWE `i18n.language`
// - normalizację języka robi `lib/i18n/format`, żeby ta decyzja nie miała
// drugiej kopii w komponencie.
import { formatDate, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
  narrowClubEnum,
  type AdminClubRow,
  type ClubStatus,
  type ClubVisibility,
} from "./types";

/** Znak pustej komórki. Jeden dla tabeli i dla kart - patrz punkt 2 nagłówka. */
export const CLUB_TABLE_EMPTY_CELL = "-";

/** Status klubu z RPC zawężony słownikiem; nieznany = wersja robocza. */
export function clubTableStatus(value: string | null): ClubStatus {
  return narrowClubEnum(value, CLUB_STATUSES, "draft");
}

/** Widoczność klubu z RPC zawężona słownikiem; nieznana = tylko członkowie. */
export function clubTableVisibility(value: string | null): ClubVisibility {
  return narrowClubEnum(value, CLUB_VISIBILITIES, "members");
}

/**
 * Data ostatniej aktywności w formacie kolumny listy. `lang` jedzie SUROWE
 * (`i18n.language`), bo `formatDate` normalizuje je samo.
 */
export function formatClubLastActivity(
  value: string | null | undefined,
  lang: string | undefined,
): string {
  if (!value) return CLUB_TABLE_EMPTY_CELL;
  return (
    formatDate(value, lang, { day: "2-digit", month: "short", year: "numeric" }) ||
    CLUB_TABLE_EMPTY_CELL
  );
}

/** Prowadzący klubu jednym napisem; brak prowadzących = kreska. */
export function clubTableLeads(names: readonly string[] | null | undefined): string {
  if (!names || names.length === 0) return CLUB_TABLE_EMPTY_CELL;
  return names.join(", ");
}

/** Adres publicznej strony klubu - podgląd „oczami członka". */
export function clubPublicHref(slug: string): string {
  return `/club/${slug}`;
}

/** Wiersz tabeli klubów gotowy do narysowania - w OBU wariantach układu. */
export interface ClubsTableRowView {
  id: string;
  /** Nazwa w języku interfejsu, z sięgnięciem po drugą kolumnę. */
  name: string;
  slug: string;
  /** Adres w postaci pokazywanej pod nazwą (`/slug`). */
  slugPath: string;
  publicHref: string;
  status: ClubStatus;
  visibility: ClubVisibility;
  groupCount: number;
  memberCount: number;
  threadCount: number;
  pendingCount: number;
  /** Czy zgłoszenia czekają - decyduje o znaczniku bursztynowym. */
  hasPending: boolean;
  /** Prowadzący albo kreska. */
  leads: string;
  /** Sformatowana data albo kreska. */
  lastActivity: string;
}

/** Projekcja jednego wiersza `admin_club_list` na widok tabeli. */
export function clubsTableRowView(row: AdminClubRow, lang: string | undefined): ClubsTableRowView {
  return {
    id: row.id,
    name: pickLocalized(row, "name", uiLang(lang)),
    slug: row.slug,
    slugPath: `/${row.slug}`,
    publicHref: clubPublicHref(row.slug),
    status: clubTableStatus(row.status),
    visibility: clubTableVisibility(row.visibility),
    groupCount: row.group_count,
    memberCount: row.member_count,
    threadCount: row.thread_count,
    pendingCount: row.pending_count,
    hasPending: row.pending_count > 0,
    leads: clubTableLeads(row.lead_names),
    lastActivity: formatClubLastActivity(row.last_activity_at, lang),
  };
}

/** Cała lista. Pusta lista wchodzi i wychodzi pusta - to stan „brak klubów". */
export function clubsTableRowViews(
  rows: readonly AdminClubRow[],
  lang: string | undefined,
): ClubsTableRowView[] {
  return rows.map((row) => clubsTableRowView(row, lang));
}
