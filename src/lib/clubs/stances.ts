// Normalizacja mapy stanowisk - czysta projekcja, bez Reacta.
//
// Mieszka w `lib`, nie w komponencie paska, z tego samego powodu, co
// `buildClubReplyTree` i `applyReactionToggle`: to jest reguła odczytu danych
// z RPC, a nie sposób ich narysowania. Testuje się ją wtedy bez środowiska
// przeglądarki i bez ikon.
import { CLUB_STANCES, type ClubStance, type ClubStanceSummaryRow } from "./types";

export interface StanceTally {
  stance: ClubStance;
  total: number;
  mine: boolean;
}

/**
 * Uzupełnia brakujące stanowiska zerami.
 *
 * `club_stance_summary` grupuje po stanowisku, więc zwraca WYŁĄCZNIE te,
 * na które ktoś zagłosował. Pasek z dwoma opcjami z trzech czyta się jako
 * "trzeciej nie ma", a nie "nikt jej nie wybrał" - a to dwie różne rzeczy.
 *
 * `total` przechodzi przez `Number`, bo `count(*)` jest w Postgresie typu
 * `bigint`, a supabase-js oddaje bigint jako tekst. Bez konwersji suma
 * "3" + "5" dałaby "35" i szerokości pasków byłyby bez sensu.
 */
export function toStanceTallies(rows: readonly ClubStanceSummaryRow[]): StanceTally[] {
  const byStance = new Map(rows.map((r) => [r.stance, r]));
  return CLUB_STANCES.map((stance) => {
    const row = byStance.get(stance);
    return {
      stance,
      total: row === undefined ? 0 : Number(row.total),
      mine: row?.mine === true,
    };
  });
}
