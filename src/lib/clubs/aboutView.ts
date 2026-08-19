// Strona „o klubie" (`/club/$clubSlug/about`) - REGUŁY WEJŚCIA, nie układ.
//
// CO BYŁO W JSX-IE TRASY. Cztery decyzje wpisane w drzewo renderu jako
// zagnieżdżone wyrażenia warunkowe, a każda z nich odpowiada na inne pytanie
// produktowe:
//
//   1. WARUNKI CZŁONKOSTWA WIDOCZNE PRZED WEJŚCIEM. Cztery odznaki
//      (widoczność, polityka wstępu, tryb autorstwa, kto może pisać) to nie
//      ozdoba nagłówka - to zestaw ustaleń, których człowiek musi znać PRZED
//      dołączeniem, bo po usunięciu konta jego treść zostaje w klubie
//      (anonimizacja autorstwa, V1 §7). Zgoda wyrażona wcześniej, nie
//      domniemana później - a to znaczy, że komplet jest regułą, nie układem:
//      zgubiona odznaka trybu autorstwa nie psuje niczego widocznego.
//   2. CO WOLNO ZROBIĆ NA TEJ STRONIE. Trzy rozłączne stany panelu akcji:
//      członek dostaje poziom powiadomień i wyjście z klubu, klub „tylko na
//      zaproszenie" - zdanie wyjaśniające zamiast martwego przycisku, a reszta
//      przycisk dołączenia w JEDNYM z dwóch znaczeń („dołącz" natychmiast albo
//      „poproś o dostęp" do zatwierdzenia). Przycisk z niewłaściwą etykietą
//      obiecuje wejście, którego RPC nie dowiezie.
//   3. KIEDY PROSIĆ O AKCEPTACJĘ ZASAD. Wyłącznie od CZŁONKA, który jeszcze
//      ich nie przyjął - nie od gościa (nie ma czego akceptować) i nie
//      powtórnie (`rules_accepted_at` już stoi).
//   4. JAKI POZIOM POWIADOMIEŃ POKAZAĆ. `club_view` go NIE zwraca; jedynym
//      źródłem jest `club_my_memberships.notify_level`. W tym miejscu stał
//      literał „digest", więc kontrolka pokazywała ten poziom KAŻDEMU:
//      użytkownik ustawiał „wszystkie", dostawał zielony toast i natychmiast
//      widział z powrotem „skrót", bez żadnego sposobu sprawdzenia, co
//      faktycznie ma ustawione.
//
// GRANICA WARSTWY. Zero Reacta, zero i18n, zero Supabase: wejściem są pola
// wierszy RPC (`club_view`, `club_my_memberships`), wyjściem KLUCZE i18n
// i deskryptory. Autoryzacja nie jest tu liczona ani powtarzana - `my_status`
// i `join_policy` pochodzą z SECURITY DEFINER i mają pgTAP; te funkcje je
// CZYTAJĄ.
import { toClubInviteError, toClubNotifyLevel, type ClubNotifyLevel } from "./types";

/** Status członkostwa, który znaczy „jestem w tym klubie". */
const ACTIVE_STATUS = "active";

/**
 * Czy wołający ma AKTYWNE członkostwo. `pending` (złożona prośba), `invited`
 * (zaproszenie bez odpowiedzi), `left` i `banned` członkostwem nie są - każdy
 * z nich musi widzieć drogę do środka, nie panel członka.
 */
function isActiveMember(myStatus: string | null): boolean {
  return myStatus === ACTIVE_STATUS;
}

/** Pola karty klubu, z których składa się lista warunków członkostwa. */
export interface ClubAboutTermsRow {
  readonly visibility: string;
  readonly join_policy: string;
  readonly attribution_mode: string;
  readonly who_can_post: string;
}

/**
 * Klucze i18n czterech warunków członkostwa - w kolejności, w jakiej strona
 * je pokazuje. Wartości pochodzą ze słowników domkniętych CHECK-iem w bazie,
 * więc klucz składa się bez walidacji: nieznana wartość ma wyjść jako brak
 * tłumaczenia (widoczna awaria), a nie zniknąć z listy (awaria niewidoczna).
 */
export function clubAboutTermKeys(club: ClubAboutTermsRow): readonly string[] {
  return [
    `club.visibility.${club.visibility}`,
    `club.joinPolicy.${club.join_policy}`,
    `club.attribution.${club.attribution_mode}`,
    `club.whoCanPost.${club.who_can_post}`,
  ];
}

/**
 * Co wolno zrobić na stronie klubu. Trzy stany ROZŁĄCZNE; `null` znaczy „brak
 * panelu akcji" - gościowi strona nie proponuje niczego poza lekturą, bo
 * dołączenie bez sesji kończy się odmową `auth_required` po stronie RPC.
 */
export type ClubAboutAction =
  /** Panel członka: poziom powiadomień + wyjście z klubu. */
  | { readonly kind: "membership" }
  /** Klub przyjmuje wyłącznie na zaproszenie - zdanie, nie przycisk. */
  | { readonly kind: "inviteOnly"; readonly noticeKey: string }
  /** Przycisk wejścia; etykieta mówi, czy skutek jest natychmiastowy. */
  | { readonly kind: "join"; readonly labelKey: string };

export interface ClubAboutActionInput {
  readonly signedIn: boolean;
  readonly myStatus: string | null;
  readonly joinPolicy: string;
}

/**
 * KOLEJNOŚĆ WARUNKÓW JEST TU TEZĄ. Członkostwo bije politykę wstępu: członek
 * klubu „tylko na zaproszenie" musi dostać swój panel, a nie zdanie o tym, że
 * wejście wymaga zaproszenia (był już w środku). Polityka bije domyślny
 * przycisk: `invite` nie ma ścieżki samoobsługowej, więc przycisk „poproś
 * o dostęp" prowadziłby prosto w `invitation_required` z RPC.
 *
 * Etykieta przycisku rozdziela `open` (wejście natychmiastowe) od `request`
 * (prośba do zatwierdzenia). Każda inna wartość - także nieznana z nowszej
 * migracji - jest traktowana jak `request`: obiecanie mniej, niż się stanie,
 * jest bezpieczne, obiecanie więcej to kłamstwo interfejsu.
 */
export function clubAboutAction(input: ClubAboutActionInput): ClubAboutAction | null {
  if (!input.signedIn) return null;
  if (isActiveMember(input.myStatus)) return { kind: "membership" };
  if (input.joinPolicy === "invite") {
    return { kind: "inviteOnly", noticeKey: "adminClubs.invitations.error.invitation_required" };
  }
  return { kind: "join", labelKey: input.joinPolicy === "open" ? "club.join" : "club.requestJoin" };
}

export interface ClubRulesAcceptInput {
  readonly myStatus: string | null;
  readonly rulesAcceptedAt: string | null;
}

/**
 * Czy pokazać przycisk akceptacji zasad. Tylko członek i tylko raz: `null`
 * w `rules_accepted_at` jest jedynym stanem „jeszcze nie przyjął".
 */
export function clubRulesAcceptVisible(input: ClubRulesAcceptInput): boolean {
  return isActiveMember(input.myStatus) && input.rulesAcceptedAt === null;
}

/**
 * Klucz komunikatu po udanym dołączeniu. RPC oddaje STATUS, nie sukces:
 * `active` znaczy „jesteś w środku", każdy inny (`pending`) - „prośba
 * czeka". Pomyłka tutaj wysyła człowieka do klubu, który zaraz pokaże mu
 * bramkę „nie jesteś członkiem".
 */
export function clubJoinToastKey(status: string): string {
  return status === ACTIVE_STATUS ? "club.joined" : "club.joinRequested";
}

/**
 * Klucz komunikatu błędu akcji członkowskiej. Kod ze słownika RPC dostaje
 * własne zdanie, kod nieznany degraduje się do ogólnego niepowodzenia zapisu -
 * nigdy do surowego tekstu z Postgresa.
 */
export function clubAboutErrorKey(error: unknown): string {
  const code = toClubInviteError(error);
  return code === null ? "adminClubs.saveFailed" : `adminClubs.invitations.error.${code}`;
}

/** Wiersz `club_my_memberships` w zakresie, którego ta reguła naprawdę czyta. */
export interface ClubNotifyLevelRow {
  readonly club_id: string;
  readonly notify_level: string;
}

/**
 * Poziom powiadomień DLA TEGO klubu z listy moich członkostw.
 *
 * Brak wiersza (lista w locie, osoba przed dołączeniem, inny klub) oddaje
 * `digest` - bo to domyślna wartość kolumny w `club_members`, czyli poziom,
 * który ta osoba dostanie po wejściu. Odczyt „z jakiegokolwiek" wiersza
 * pokazywałby ustawienie z INNEGO klubu, co jest gorsze od domysłu.
 */
export function myClubNotifyLevel(
  rows: readonly ClubNotifyLevelRow[] | undefined,
  clubId: string | undefined,
): ClubNotifyLevel {
  return toClubNotifyLevel(rows?.find((row) => row.club_id === clubId)?.notify_level);
}
