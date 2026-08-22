// Kto widzi co na stronie glownej klubow.
//
// UWAGA NA GRANICE. To jest bramka MIEKKA - decyduje wylacznie o tym, jaki
// panel narysowac nad lista. Twarda bramke trzyma `club_capabilities` w bazie
// i to ona rozstrzyga, ktory klub w ogole wyjdzie z `club_list`. Gdyby ten
// modul kiedykolwiek zaczal UKRYWAC kluby, ktore RPC zwrocilo, mielibysmy dwa
// zrodla prawdy o dostepie - a to jest dokladnie ta klasa bledu, ktora
// w tym module wyglada niewinnie i konczy sie tym, ze czlonek klubu nie widzi
// wlasnego klubu, bo skonczyla mu sie subskrypcja.
//
// Stad regula: `locked` nie zabiera nikomu ANI JEDNEGO wiersza z listy. Dokłada
// panel z zaproszeniem do planu i tyle.
import { TIER_RANKS } from "@/lib/billing/tierRanks";

/** Prog planu, od ktorego PELNE czlonkostwo w klubie jest czescia oferty (Pro). */
export const CLUB_TIER_RANK = TIER_RANKS.pro;

/**
 * Prog planu, od ktorego kluby sa czescia oferty w roli OBSERWATORA.
 *
 * Katalog v6.1 daje progowi Czlonek (ranga 10) „obserwatora w jednym klubie
 * otwartym" i oznacza te pozycje jako [B?] - bramka do dopisania. Bramka
 * brakowala wlasnie tutaj: panel klubow porownywal range wylacznie z
 * `CLUB_TIER_RANK` (20), wiec czlonek za 39 zl widzial „kup Pro" nawet wtedy,
 * gdy klub testowy miał `min_tier_rank = 10` i baza by go wpuscila.
 *
 * KTORE kluby sa otwarte dla obserwatora, rozstrzyga nadal WYLACZNIE
 * `clubs.min_tier_rank` po stronie bazy - ta stala mowi tylko tyle, ze panel
 * nie ma z gory zakladac braku oferty.
 */
export const CLUB_OBSERVER_TIER_RANK = TIER_RANKS.member;

export type ClubHubAccess =
  /** Nalezy do co najmniej jednego klubu - albo jest staffem. */
  | "member"
  /** Nie nalezy jeszcze nigdzie, ale ma czekajace zaproszenie. */
  | "invited"
  /** Plan obejmuje kluby, choc jeszcze nigdzie nie wszedl. */
  | "entitled"
  /** Ani plan, ani zaproszenie - widzi zaproszenie do planu. */
  | "locked";

export interface ClubHubAccessInput {
  /** Ranga planu wolajacego; `null` dopoki RPC nie odpowie. */
  tierRank: number | null;
  activeMemberships: number;
  pendingInvitations: number;
  isStaff: boolean;
}

/**
 * Kolejnosc rozstrzygania jest istotna: czlonkostwo bije plan, a zaproszenie
 * bije jego brak. Osoba z wygasla subskrypcja, ktora nalezy do klubu, ma
 * zobaczyc swoj klub, a nie cennik.
 */
export function resolveClubHubAccess(input: ClubHubAccessInput): ClubHubAccess {
  if (input.isStaff || input.activeMemberships > 0) return "member";
  if (input.pendingInvitations > 0) return "invited";
  if (input.tierRank !== null && input.tierRank >= CLUB_OBSERVER_TIER_RANK) return "entitled";
  return "locked";
}

/** Czy panel z zaproszeniem do planu ma sie w ogole pokazac. */
export function showsUpgradePanel(access: ClubHubAccess): boolean {
  return access === "locked";
}
