// Czyste reguły rozmowy w karcie strumienia (komentarze wpisu, odpowiedzi
// wątku). Zero Reacta i zero i18n - funkcje dają się sprawdzić tabelą
// przypadków, a komponenty `ClubFeedComments` / `ClubFeedThreadReplies`
// tylko z nich czytają.
import { splitInline } from "@/lib/clubs/inlineSegments";
import { collectMentionSlugs, withAuthorSlugs } from "@/lib/mentions/directory";

/**
 * Co czytelnik może zrobić w sekcji rozmowy.
 *
 *  * `write`    - kompozytor nad listą,
 *  * `guest`    - niezalogowany: lista + zaproszenie do zalogowania,
 *  * `readOnly` - zalogowany bez prawa głosu (klub albo dział wpisu): lista
 *                 + powód,
 *  * `locked`   - wątek zamknięty: lista + informacja o zamknięciu.
 *
 * Żaden stan poza `write` nie rysuje martwego pola ani martwego przycisku.
 */
export type ClubFeedDiscussionMode = "write" | "guest" | "readOnly" | "locked";

/** Statusy wątku, w których odpowiedź z karty nie przejdzie przez `club_reply`. */
const CLOSED_THREAD_STATUSES: ReadonlySet<string> = new Set(["locked", "hidden", "deleted"]);

export function isClubThreadClosed(status: string | null | undefined): boolean {
  return typeof status === "string" && CLOSED_THREAD_STATUSES.has(status);
}

/**
 * Tryb sekcji. Kolejność ma znaczenie: zamknięty wątek wygrywa ze wszystkim
 * (zalogowanie niczego tu nie zmieni, więc gość nie dostaje martwej zachęty
 * „Zaloguj się", po której trafiłby na „wątek jest zamknięty"), potem brak
 * sesji (gość dostaje drogę do logowania, nie wykład o uprawnieniach), a na
 * końcu prawo głosu.
 */
export function clubFeedDiscussionMode(input: {
  signedIn: boolean;
  canWrite: boolean;
  locked?: boolean;
}): ClubFeedDiscussionMode {
  if (input.locked === true) return "locked";
  if (!input.signedIn) return "guest";
  return input.canWrite ? "write" : "readOnly";
}

/** To, co karta wątku wie o prawie głosu z widoku wątku (`club_thread_view`). */
export interface ClubThreadReplyView {
  can_reply: boolean;
  reason: string | null;
  locked_at: string | null;
  status: string;
}

/** Odmowa z bazy przy wysyłce z karty - ostatnie słowo, gdy widok był stary. */
export type ClubThreadReplyRejection = "locked" | "readOnly";

/**
 * Tryb sekcji odpowiedzi w KARCIE WĄTKU, doprecyzowany widokiem wątku.
 *
 * DLACZEGO WIDOK, A NIE LISTA. Wiersz listy wątków nie niesie prawa głosu
 * w DZIALE wątku - karta zna tylko prawo klubu (sesja i `club.can_reply`).
 * Członek klubu bez prawa w dziale zamkniętym planem albo członkostwem
 * widziałby działający kompozytor, pisał i dostawał odmowę. Widok wątku
 * (`club_thread_view`, ten sam klucz cache co strona wątku) liczy
 * `can_reply` dla działu i blokady, a `reason` mówi, DLACZEGO nie wolno.
 *
 * Kolejność jak w `clubFeedDiscussionMode`: zamknięcie (z listy, z widoku
 * albo z odmowy bazy) wygrywa ze wszystkim, gość zostaje gościem, odmowa
 * prawa przy wysyłce wygrywa z widokiem sprzed chwili, a bez widoku (w drodze,
 * wątek niewidoczny) zostaje tryb z listy - baza i tak pilnuje zapisu.
 */
export function clubThreadReplyMode(input: {
  mode: ClubFeedDiscussionMode;
  view?: ClubThreadReplyView | null;
  rejected?: ClubThreadReplyRejection | null;
}): { mode: ClubFeedDiscussionMode; reason: string | null } {
  const { mode, view = null, rejected = null } = input;
  const closed =
    rejected === "locked" ||
    (view !== null && (view.locked_at !== null || isClubThreadClosed(view.status)));
  if (mode === "locked" || closed) return { mode: "locked", reason: null };
  if (mode === "guest") return { mode: "guest", reason: null };
  if (rejected === "readOnly") return { mode: "readOnly", reason: null };
  if (view === null) return { mode, reason: null };
  if (view.can_reply) return { mode: "write", reason: null };
  const reason = typeof view.reason === "string" && view.reason !== "" ? view.reason : null;
  return { mode: "readOnly", reason };
}

/**
 * „Odpowiedz" na komentarz: wzmianka autora w szkicu.
 *
 * Komentarze są PŁASKIE - odpowiedź to `@slug` (powiadomienie dla adresata),
 * nie gałąź. Pusty szkic zaczyna się od wzmianki; niepusty dostaje ją na
 * końcu po spacji. Wzmianka już obecna w szkicu nie jest dublowana - drugie
 * kliknięcie „Odpowiedz" tylko oddaje fokus polu.
 */
export function appendMentionToDraft(draft: string, slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (normalized === "") return draft;
  if (collectMentionSlugs([draft], splitInline).includes(normalized)) return draft;
  const token = `@${normalized} `;
  if (draft.trim() === "") return token;
  return /\s$/.test(draft) ? `${draft}${token}` : `${draft} ${token}`;
}

/**
 * Slugi katalogu wzmianek dla poddrzewa rozmowy.
 *
 * ZAGNIEŻDŻONY `MentionDirectoryProvider` ZASTĘPUJE zewnętrzny (nie scala się
 * z nim), więc lista musi być KOMPLETNA dla wszystkiego, co sekcja rysuje:
 * autorzy wierszy (bylina z firmą) i wzmianki w ich treści. Autorzy idą
 * pierwsi - przy limicie katalogu ważniejsza jest bylina każdego wiersza niż
 * awatar w środku zdania.
 */
export function discussionDirectorySlugs(
  rows: ReadonlyArray<{ author_slug: string | null; body: string }>,
): string[] {
  return withAuthorSlugs(
    withAuthorSlugs(
      [],
      rows.map((row) => row.author_slug),
    ),
    collectMentionSlugs(
      rows.map((row) => row.body),
      splitInline,
    ),
  );
}
