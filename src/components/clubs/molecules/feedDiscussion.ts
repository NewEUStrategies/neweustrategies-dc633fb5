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
 *  * `readOnly` - zalogowany bez prawa głosu w tym dziale: lista + powód,
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
 * Tryb sekcji. Kolejność ma znaczenie: brak sesji wygrywa ze wszystkim (gość
 * dostaje drogę do logowania, nie wykład o uprawnieniach), a zamknięty wątek
 * - z prawem głosu (prawo jest, ale wątek nie przyjmuje odpowiedzi).
 */
export function clubFeedDiscussionMode(input: {
  signedIn: boolean;
  canWrite: boolean;
  locked?: boolean;
}): ClubFeedDiscussionMode {
  if (!input.signedIn) return "guest";
  if (input.locked === true) return "locked";
  return input.canWrite ? "write" : "readOnly";
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
