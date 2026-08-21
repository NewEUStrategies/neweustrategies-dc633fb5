// Pulpit moderacji w panelu - REGUŁY, których NIE MA w `moderationRules.ts`.
//
// PODZIAŁ MIĘDZY TYMI DWOMA MODUŁAMI JEST CELOWY. `moderationRules.ts` opisuje
// operacje NIEODWRACALNE na kolejce: rozbicie wsadu na typy celu, próg powodu
// ujawnienia, które akcje wymagają potwierdzenia, przełączanie zaznaczenia.
// Ten plik bierze to, co zostało w JSX-ie `ClubModerationTab` (1015 linii,
// 57,81% instrukcji przed tą zmianą) i co też jest regułą, a nie układem:
//
//   1. DZIENNIK MODERACJI. Okno czasu (`Date.now() - days * 86_400_000`),
//      liczniki per akcja i per typ celu, filtr po akcji/celu/frazie
//      z sianem złożonym z pięciu pól wiersza, deskryptor plakietki licznika
//      („wszystkie” vs „widać X z Y”) i pytanie, czy filtry są w ogóle
//      ustawione. Kolejność ma znaczenie: okno czasu stosuje się PRZED resztą,
//      bo liczniki przy akcjach mają mówić o tym, co widać w wybranym oknie -
//      inaczej „30 dni” pokazuje liczby z całej historii i moderator zaufa
//      złej liczbie.
//   2. BLOKADY CZŁONKÓW. Ładunek `club_ban_member` z pustym powodem zamienionym
//      na `null` (`""` zapisałby puste uzasadnienie blokady) oraz bramka pustego
//      wyboru osoby. Zdjęcie blokady to OSOBNY ładunek, bez powodu.
//   3. REDAKCJA MODERATORSKA. Który RPC dostaje ładunek - `admin_club_thread_edit`
//      czy `admin_club_reply_edit` - zależy od typu celu, a treść startowa
//      formularza to TREŚĆ WPISU, nie pustka. Bramka wymaga powodu (min. 3
//      znaki) i niepustej treści: bez powodu wpis w dzienniku nie mówi nikomu,
//      dlaczego cudza wypowiedź wygląda inaczej niż w chwili publikacji.
//   4. UJAWNIENIE AUTORA - ŁADUNEK I WYNIK. Próg powodu jest w
//      `moderationRules.ts`; tutaj jest złożenie ładunku (z PRZYCIĘTYM powodem)
//      i odnośnik do profilu ujawnionej osoby, który istnieje TYLKO wtedy, gdy
//      RPC oddał slug.
//
// DLACZEGO TO NIE MOŻE ZOSTAĆ W JSX-IE. Każda z tych reguł psuje się CICHO:
// dziennik z oknem czasu policzonym po filtrach pokazuje prawdziwe wiersze
// i nieprawdziwe liczniki; blokada z powodem `""` zapisuje się poprawnie
// i nie mówi nic; redakcja skierowana do złego RPC kończy się błędem bazy
// dopiero po kliknięciu „Zapisz” na cudzej wypowiedzi.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero klienta bazy. Etykiety do
// wyszukiwania w dzienniku wchodzą jako REZOLWERY (`ModerationLogLabels`) -
// tłumaczenie zostaje w komponencie, a pętla filtrująca jest tutaj i daje się
// sprawdzić bez montowania panelu.
//
// UMOWA CO DO PUSTKI. `RETURNS TABLE` typuje kolumny jako non-null, więc
// `reason` i `target_id` w wierszu dziennika mają typ `string`, choć baza
// oddaje tam NULL. Funkcje przyjmują `string | null` i traktują `null` oraz
// pusty napis identycznie - jako brak wartości.

/** Okna czasu dziennika. `null` = bez ograniczenia (cała historia). */
export const MODERATION_LOG_PERIODS: readonly { key: string; days: number | null }[] = [
  { key: "7", days: 7 },
  { key: "30", days: 30 },
  { key: "90", days: 90 },
  { key: "all", days: null },
];

/** Klucz okna, gdy moderator nie zawężał czasu. */
export const MODERATION_LOG_PERIOD_ALL = "all";

/** Minimalna długość powodu redakcji moderatorskiej - lustro bramki w RPC. */
export const MODERATOR_EDIT_MIN_REASON = 3;

const DAY_MS = 86_400_000;

/** Wiersz dziennika w zakresie, którego dotyczą reguły tego modułu. */
export interface ModerationLogEntry {
  action: string;
  target_type: string;
  target_id: string | null;
  moderator_name: string;
  reason: string | null;
  created_at: string;
}

/** Liczba dni okna dla klucza dropListy. Klucz nieznany = cała historia. */
export function moderationLogPeriodDays(period: string): number | null {
  return MODERATION_LOG_PERIODS.find((entry) => entry.key === period)?.days ?? null;
}

/**
 * Wiersze w wybranym oknie czasu. Wiersz z datą nieparsowalną NIE wypada
 * z okna: dziennik jest zapisem audytowym, a ukrycie wpisu przez literówkę
 * w danych jest gorsze niż pokazanie go poza oknem.
 */
export function moderationLogInWindow<T extends { created_at: string }>(
  rows: readonly T[],
  period: string,
  nowMs: number,
): T[] {
  const days = moderationLogPeriodDays(period);
  if (days === null) return [...rows];
  const from = nowMs - days * DAY_MS;
  return rows.filter((row) => {
    const at = new Date(row.created_at).getTime();
    return Number.isNaN(at) || at >= from;
  });
}

/** Liczniki wpisów per akcja i per typ celu w PODANYM zbiorze wierszy. */
export function moderationLogCounts(rows: readonly ModerationLogEntry[]): {
  byAction: Map<string, number>;
  byTarget: Map<string, number>;
} {
  const byAction = new Map<string, number>();
  const byTarget = new Map<string, number>();
  for (const row of rows) {
    byAction.set(row.action, (byAction.get(row.action) ?? 0) + 1);
    byTarget.set(row.target_type, (byTarget.get(row.target_type) ?? 0) + 1);
  }
  return { byAction, byTarget };
}

/** Opcja dropListy filtra: wartość ze słownika plus jej licznik. */
export interface ModerationLogOption {
  value: string;
  count: number;
}

/**
 * Opcje filtra ze słownika, WYŁĄCZNIE te z niezerowym licznikiem. Droplista
 * z siedemnastoma akcjami, z których dwie coś znaczą, jest listą do czytania,
 * nie kontrolką do wybierania.
 */
export function moderationLogOptions(
  dictionary: readonly string[],
  counts: ReadonlyMap<string, number>,
): ModerationLogOption[] {
  return dictionary
    .map((value) => ({ value, count: counts.get(value) ?? 0 }))
    .filter((option) => option.count > 0);
}

/** Stan filtrów dziennika - dokładnie cztery kontrolki nad tabelą. */
export interface ModerationLogFilterState {
  action: string | null;
  target: string | null;
  query: string;
  period: string;
}

/** Stan po wyczyszczeniu filtrów. Jedno miejsce dla przycisku „wyczyść”. */
export const MODERATION_LOG_FILTERS_CLEARED: ModerationLogFilterState = {
  action: null,
  target: null,
  query: "",
  period: MODERATION_LOG_PERIOD_ALL,
};

/** Czy dziennik jest w ogóle zawężony - decyduje o KOMUNIKACIE PUSTKI. */
export function isModerationLogFiltered(state: ModerationLogFilterState): boolean {
  return (
    state.action !== null ||
    state.target !== null ||
    state.query.trim() !== "" ||
    state.period !== MODERATION_LOG_PERIOD_ALL
  );
}

/**
 * Rezolwery etykiet do wyszukiwania. Moderator szuka po tym, CO WIDZI
 * („zablokowanie”, „odpowiedź”), a nie po surowej wartości kolumny - dlatego
 * siano zawiera przetłumaczone etykiety. Tłumaczenie zostaje w komponencie.
 */
export interface ModerationLogLabels {
  action: (value: string) => string;
  target: (value: string) => string;
}

/** Siano jednego wiersza: pięć pól, po których da się szukać. */
export function moderationLogHaystack(
  row: ModerationLogEntry,
  labels: ModerationLogLabels,
): string {
  return [
    row.moderator_name,
    row.reason ?? "",
    labels.action(row.action),
    labels.target(row.target_type),
    row.target_id ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** Filtr dziennika: akcja ORAZ typ celu ORAZ fraza (koniunkcja, nie suma). */
export function filterModerationLog<T extends ModerationLogEntry>(
  rows: readonly T[],
  state: ModerationLogFilterState,
  labels: ModerationLogLabels,
): T[] {
  const query = state.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (state.action !== null && row.action !== state.action) return false;
    if (state.target !== null && row.target_type !== state.target) return false;
    if (query === "") return true;
    return moderationLogHaystack(row, labels).includes(query);
  });
}

/** Deskryptor plakietki licznika dziennika. */
export type ModerationLogCountView =
  { kind: "all"; total: number } | { kind: "partial"; shown: number; total: number };

/**
 * Plakietka mówi ILE Z ILU tylko wtedy, gdy filtr coś odjął. Przy pełnym
 * zbiorze „12 z 12” to szum, a nie informacja.
 */
export function moderationLogCountView(shown: number, total: number): ModerationLogCountView {
  return shown === total ? { kind: "all", total } : { kind: "partial", shown, total };
}

/** Powód wpisu albo `null`, gdy go nie ma. Kreska w komórce to już układ. */
export function moderationLogReason(reason: string | null): string | null {
  if (reason === null) return null;
  return reason.trim() === "" ? null : reason;
}

/** Czy akcja to ujawnienie autora - jedyny wpis wyróżniany w dzienniku. */
export function isRevealLogAction(action: string): boolean {
  return action === "reveal_author";
}

/** Ładunek `club_ban_member` albo `null`, gdy nie wybrano osoby. */
export function banMemberVars(
  userId: string,
  reason: string,
): { userId: string; banned: true; reason: string | null } | null {
  if (userId.trim() === "") return null;
  const trimmed = reason.trim();
  return { userId, banned: true, reason: trimmed !== "" ? trimmed : null };
}

/** Ładunek zdjęcia blokady. Bez powodu - to przywrócenie stanu, nie kara. */
export function unbanMemberVars(userId: string): { userId: string; banned: false } {
  return { userId, banned: false };
}

/** Podpis pod nazwiskiem zablokowanej osoby: stanowisko albo KLUCZ roli. */
export type BannedMemberSubtitle =
  { kind: "jobTitle"; text: string } | { kind: "roleKey"; key: string };

/**
 * Stanowisko, a gdy go nie ma - rola w klubie. Rola jako klucz i18n, bo
 * słownik ról mieszka w warstwie tłumaczeń, a ten moduł napisów nie składa.
 */
export function bannedMemberSubtitle(member: {
  job_title: string | null;
  role: string;
}): BannedMemberSubtitle {
  const title = member.job_title;
  if (title !== null && title.trim() !== "") return { kind: "jobTitle", text: title };
  return { kind: "roleKey", key: `club.role.${member.role}` };
}

/** Wersja robocza redakcji moderatorskiej - stan trzech pól formularza. */
export interface ModeratorEditDraft {
  title: string;
  body: string;
  reason: string;
}

/** Pozycja kolejki w zakresie reguł redakcji moderatorskiej. */
export interface ModeratorEditTarget {
  target_type: string;
  target_id: string;
  title: string;
  body: string;
}

/**
 * Treść startowa formularza. Moderator ZACZERNIA fragment cudzej wypowiedzi,
 * a nie pisze ją od nowa - pusty formularz zamieniałby redakcję w podmianę.
 * Powód startuje pusty ZAWSZE: uzasadnienie poprzedniej redakcji nie jest
 * uzasadnieniem tej.
 */
export function moderatorEditInitial(item: ModeratorEditTarget | null): ModeratorEditDraft {
  return { title: item?.title ?? "", body: item?.body ?? "", reason: "" };
}

/** Czy zapis redakcji jest zablokowany: brak powodu albo pusta treść. */
export function isModeratorEditBlocked(draft: ModeratorEditDraft): boolean {
  return draft.reason.trim().length < MODERATOR_EDIT_MIN_REASON || draft.body.trim() === "";
}

/** Ładunek redakcji: DWA różne RPC, wybór po typie celu. */
export type ModeratorEditVars =
  | { kind: "thread"; vars: { threadId: string; title: string; body: string; reason: string } }
  | { kind: "reply"; vars: { replyId: string; body: string; reason: string } };

/**
 * Ładunek redakcji albo `null`, gdy bramka nie przepuszcza. Cel inny niż
 * `thread` jedzie ścieżką odpowiedzi - kolejka miesza oba typy, a `post`
 * z wpisu historycznego nie ma własnego RPC redakcji.
 */
export function moderatorEditVars(
  item: ModeratorEditTarget | null,
  draft: ModeratorEditDraft,
): ModeratorEditVars | null {
  if (item === null || isModeratorEditBlocked(draft)) return null;
  const body = draft.body.trim();
  const reason = draft.reason.trim();
  if (item.target_type === "thread") {
    return {
      kind: "thread",
      vars: { threadId: item.target_id, title: draft.title.trim(), body, reason },
    };
  }
  return { kind: "reply", vars: { replyId: item.target_id, body, reason } };
}

/** Cel ujawnienia autora - typ celu ZAWĘŻONY do tego, co przyjmuje RPC. */
export interface RevealAuthorTarget {
  targetType: "thread" | "reply";
  targetId: string;
  title: string;
}

/** Typ celu z kolejki na typ przyjmowany przez RPC moderacji. */
export function moderationTargetType(rawTargetType: string): "thread" | "reply" {
  return rawTargetType === "reply" ? "reply" : "thread";
}

/**
 * Ładunek ujawnienia albo `null`. Powód jedzie PRZYCIĘTY - do dziennika
 * audytowego ma trafić uzasadnienie, nie uzasadnienie z tabulatorami.
 * Próg długości pilnuje `revealReasonAccepted` z `moderationRules.ts`.
 */
export function revealAuthorVars(
  target: RevealAuthorTarget | null,
  reason: string,
  accepted: boolean,
): { targetType: "thread" | "reply"; targetId: string; reason: string } | null {
  if (target === null || !accepted) return null;
  return { targetType: target.targetType, targetId: target.targetId, reason: reason.trim() };
}

/** Odnośnik do profilu ujawnionej osoby albo `null`, gdy RPC nie dał sluga. */
export function revealProfileHref(profileSlug: string | null): string | null {
  if (profileSlug === null || profileSlug.trim() === "") return null;
  return `/profile/${profileSlug}`;
}
