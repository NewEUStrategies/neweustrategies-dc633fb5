// Kto widzi minisite klubu.
//
// Minisite to OSOBNY widok treści klubu: kuratorska strona (okładka, opis,
// wyróżniony temat, fragmenty) zamiast operacyjnej listy wątków. Bramka jest
// węższa niż wejście do klubu - to powierzchnia dla planu Pro i wyżej oraz dla
// osób z imiennym zaproszeniem.
//
// UWAGA NA GRANICE - ta sama doktryna, co w `hubAccess`: to jest bramka
// MIĘKKA, decydująca wyłącznie o tym, który panel narysować. Twardą trzyma
// `club_capabilities` w bazie i to ona rozstrzyga, czy `club_view` w ogóle
// zwróciło treść (`can_read`). Dlatego moduł NIGDY nie przepuszcza nikogo,
// komu baza odmówiła odczytu - dokłada tylko drugi warunek na wierzchu.
import { TIER_RANKS } from "@/lib/billing/tierRanks";

/**
 * Próg planu, od którego minisite jest częścią oferty.
 *
 * RANGA 50 (Partner Strategiczny), nie 20 (Pro). Audyt katalogu członkostw
 * v6.1, rozdział 2.2: katalog sprzedaje „prywatny mikroserwis klubowy dla
 * organizacji" jako składnik progu Partner Strategiczny za 60 000 zł rocznie
 * i wskazuje TĘ stałą jako punkt egzekwowania. Stała wskazywała `TIER_RANKS.pro`,
 * czyli 20 - a więc każdy członek progu Pro za 119 zł miesięcznie był
 * uprawniony do funkcji wycenionej pięćsetkrotnie wyżej.
 *
 * UWAGA PRZY PODNOSZENIU PROGU: to jest bramka MIĘKKA (patrz nagłówek pliku).
 * Podniesienie stałej NIE zabiera dostępu członkom klubu ani osobom
 * zaproszonym - `resolveClubMinisiteAccess` rozstrzyga członkostwo i zaproszenie
 * PRZED planem. Zmienia się wyłącznie to, co widzi osoba bez członkostwa
 * w klubie: zamiast treści minisite dostaje panel z zachętą. Kluby, których
 * własny `min_tier_rank` jest niższy, działają dalej - ich członkowie wchodzą
 * członkostwem, nie planem.
 */
export const CLUB_MINISITE_TIER_RANK = TIER_RANKS.partner_general;

export type ClubMinisiteAccess =
  /** Członek klubu albo staff - pełny widok. */
  | "member"
  /** Ma czekające zaproszenie do TEGO klubu. */
  | "invited"
  /** Plan Pro+ i baza pozwala czytać. */
  | "entitled"
  /** Baza odmówiła odczytu - nie ma czego pokazać. */
  | "no_read"
  /** Czyta, ale ani planu, ani zaproszenia - widzi zachętę. */
  | "locked";

export interface ClubMinisiteAccessInput {
  /** `club_view.can_read` - twarda odpowiedź bazy. */
  canRead: boolean;
  /** `club_view.my_status` - `active` znaczy członkostwo. */
  myStatus: string | null;
  /** Czy woła­jący ma czekające zaproszenie do tego klubu. */
  hasInvitation: boolean;
  /** Ranga planu; `null` dopóki RPC nie odpowie. */
  tierRank: number | null;
  isStaff: boolean;
}

/**
 * Kolejność rozstrzygania jest istotna: brak odczytu bije wszystko, potem
 * członkostwo, potem zaproszenie, na końcu plan. Osoba z wygasłą subskrypcją,
 * która należy do klubu, ma zobaczyć minisite, a nie cennik.
 */
export function resolveClubMinisiteAccess(input: ClubMinisiteAccessInput): ClubMinisiteAccess {
  if (input.isStaff) return "member";
  if (!input.canRead) return "no_read";
  if (input.myStatus === "active") return "member";
  if (input.hasInvitation) return "invited";
  if (input.tierRank !== null && input.tierRank >= CLUB_MINISITE_TIER_RANK) return "entitled";
  return "locked";
}

/** Czy narysować treść minisite (a nie panel z zachętą). */
export function showsClubMinisiteContent(access: ClubMinisiteAccess): boolean {
  return access === "member" || access === "invited" || access === "entitled";
}
