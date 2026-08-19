// Lista działów klubu w panelu - REGUŁY tablicy jako czyste funkcje.
//
// CO BYŁO W JSX-IE I DLACZEGO TO REGUŁA, A NIE UKŁAD.
//
//   1. NOWA KOLEJNOŚĆ PO PRZECIĄGNIĘCIU. `handleDragEnd` liczył trzy rzeczy
//      naraz: kiedy przeciągnięcie jest NIEZDARZENIEM (upuszczenie poza listą,
//      upuszczenie na sobie, identyfikator, którego nie ma na liście), jaka jest
//      nowa tablica i jaka lista identyfikatorów jedzie do RPC. Pierwsza z nich
//      jest regułą o realnym skutku: bez niej upuszczenie na sobie zapisywało
//      kolejność, czyli wysyłało mutację, która nic nie zmienia - a przy błędzie
//      COFAŁO widok do odpowiedzi serwera, więc „nic nie zrobiłem" wyglądało
//      jak „coś się zepsuło".
//   2. WIERSZ DZIAŁU. Ten sam problem, co w tabeli klubów: `status`
//      i `visibility` z `admin_club_groups` to goły `string`, a znacznik
//      indeksuje `Record<ClubGroupStatus, Tone>`. Nieznany status czyta się jako
//      `draft`, nieznana widoczność jako `members` - nigdy jako coś szerszego,
//      niż zapisano w bazie. Dziedziczenie (`*_inherited`) idzie z tego samego
//      wiersza przez `toGroupSettings` i JEST widoczne w wierszu, bo wartość
//      klubu udająca wartość działu sprawia, że pierwsza zmiana ustawień klubu
//      przestaje działać „bez powodu".
//   3. TRZY STANY TABLICY. Zapytanie w locie, pustka i lista to nie trzy
//      warianty układu, tylko trzy różne komunikaty: szkielet NIE MOŻE
//      wyglądać jak „brak działów", bo administrator zakłada wtedy drugi dział
//      o tej samej nazwie.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero dnd-kit (przestawienie elementu
// tablicy to trzy linie - import biblioteki układu do warstwy reguł kosztowałby
// więcej, niż daje), zero klienta Supabase.
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  CLUB_GROUP_STATUSES,
  CLUB_VISIBILITIES,
  narrowClubEnum,
  toGroupSettings,
  type AdminClubGroupRow,
  type ClubGroupStatus,
  type ClubVisibility,
} from "./types";

/** Status działu z RPC zawężony słownikiem; nieznany = wersja robocza. */
export function clubGroupRowStatus(value: string | null): ClubGroupStatus {
  return narrowClubEnum(value, CLUB_GROUP_STATUSES, "draft");
}

/** Widoczność działu z RPC zawężona słownikiem; nieznana = tylko członkowie. */
export function clubGroupRowVisibility(value: string | null): ClubVisibility {
  return narrowClubEnum(value, CLUB_VISIBILITIES, "members");
}

/** Wiersz działu gotowy do narysowania. */
export interface ClubGroupRowView {
  id: string;
  name: string;
  slug: string;
  /** Adres w postaci pokazywanej pod nazwą (`/slug`). */
  slugPath: string;
  status: ClubGroupStatus;
  visibility: ClubVisibility;
  /** Czy widoczność pochodzi z klubu - etykieta dziedziczenia. */
  visibilityInherited: boolean;
  threadCount: number;
}

/** Projekcja wiersza `admin_club_groups` na widok listy działów. */
export function clubGroupRowView(
  group: AdminClubGroupRow,
  lang: string | undefined,
): ClubGroupRowView {
  const settings = toGroupSettings(group);
  return {
    id: group.id,
    name: pickLocalized(group, "name", uiLang(lang)),
    slug: group.slug,
    slugPath: `/${group.slug}`,
    status: clubGroupRowStatus(group.status),
    visibility: clubGroupRowVisibility(settings.visibility.value),
    visibilityInherited: settings.visibility.inherited,
    threadCount: group.thread_count,
  };
}

/** Trzy stany tablicy działów - patrz punkt 3 nagłówka. */
export type ClubGroupsBoardMode = "pending" | "empty" | "list";

/**
 * Kolejność sprawdzeń jest istotna: zapytanie w locie ma pierwszeństwo nad
 * pustką, bo lokalna kopia kolejności jest pusta DOPÓKI odpowiedź nie przyjdzie.
 */
export function clubGroupsBoardMode(input: {
  isPending: boolean;
  count: number;
}): ClubGroupsBoardMode {
  if (input.isPending) return "pending";
  return input.count === 0 ? "empty" : "list";
}

/** Wynik przeciągnięcia: nowa tablica plus lista identyfikatorów do RPC. */
export interface ClubGroupReorder {
  rows: AdminClubGroupRow[];
  ids: string[];
}

/**
 * Nowa kolejność po upuszczeniu `activeId` na `overId`. `null` znaczy
 * „nie zdarzyło się nic, czego warto zapisywać" - patrz punkt 1 nagłówka.
 * Identyfikatory dnd-kit mają typ `string | number`, więc porównanie jest
 * dokładnie takie, jak było w handlerze: bez konwersji.
 */
export function clubGroupReorder(
  rows: readonly AdminClubGroupRow[],
  activeId: string | number,
  overId: string | number | null,
): ClubGroupReorder | null {
  if (overId === null || activeId === overId) return null;
  const oldIndex = rows.findIndex((group) => group.id === activeId);
  const newIndex = rows.findIndex((group) => group.id === overId);
  if (oldIndex < 0 || newIndex < 0) return null;

  // Przestawienie bez gałęzi obronnej: `oldIndex` jest tu z definicji poprawnym
  // indeksem, więc dodatkowe `if` byłoby martwym kodem.
  const next = rows.filter((_group, index) => index !== oldIndex);
  next.splice(newIndex, 0, rows[oldIndex]);
  return { rows: next, ids: next.map((group) => group.id) };
}
