// Lista tematów w panelu (zakładka „Tematy”) - REGUŁY jako czyste funkcje.
//
// CO BYŁO W JSX-IE. Organizm `ClubThreadsTab` (898 linii, 0% pokrycia przed tą
// zmianą) trzymał w drzewie renderu dziesięć osobnych reguł produktu, każdą
// jako wyrażenie inline w atrybucie albo funkcję lokalną tuż nad zwrotem:
//
//   * przełożenie wartości dropListy „wszystkie” (`__any__`) na argument
//     zapytania (`v === ANY ? null : v`) - trzy razy, po jednym na filtr,
//   * przecięcie zaznaczenia z WIDOCZNYMI wierszami
//     (`[...selected].filter((id) => visibleIds.has(id))`),
//   * przełączanie jednego identyfikatora w zbiorze i stan pola „zaznacz
//     wszystkie” (`selectedVisible.length === rows.length && rows.length > 0`),
//   * wyliczenie stanu przycisków akcji wiersza: `row.pinned_at !== null
//     ? "unpin" : "pin"`, to samo dla zamknięcia, oraz `row.status ===
//     "deleted" || row.status === "hidden"` decydujące o parze usuń/przywróć,
//   * ochrona tożsamości autora (`row.is_anonymous || row.attribution_mode
//     === "chatham"`),
//   * dział efektywny kompozytora (`groupId !== "" ? groupId : groups[0]?.id`),
//   * walidacja nowego tematu (`title.trim().length < 5 || body.trim().length
//     < 10`) wraz ze złożeniem ładunku mutacji i zamianą pustego wyboru osoby
//     na `null`,
//   * bramka publikacji odpowiedzi (`body.trim().length === 0`),
//   * lista działów docelowych przeniesienia (`groups.filter((g) => g.id !==
//     thread?.group_id)`),
//   * zdanie o UCIĘCIU strony odpowiedzi (`repliesTotal > replies.length`)
//     i wcięcie odpowiedzi z poziomu zagnieżdżenia (`depth * 12`).
//
// DLACZEGO TO SĄ REGUŁY, A NIE UKŁAD. Żadna z nich nie mówi, JAK lista wygląda
// - każda mówi, CO POLECI DO BAZY albo CZEGO MODERATOR NIE ZOBACZY:
//
//   * przecięcie zaznaczenia z widocznymi wierszami jest jedyną obroną przed
//     wsadem na wpisach, których moderator NIE MA na ekranie: zmiana filtra
//     (albo cudze skasowanie wątku między refetchami) zostawiała w zbiorze
//     identyfikatory znikniętych wierszy, a przycisk „usuń 12” kasował coś,
//     czego nikt nie widział,
//   * stan przycisku akcji decyduje o KIERUNKU operacji: „unpin” na wpisie
//     nieprzypiętym i „delete” na wpisie już usuniętym to dwa różne wywołania
//     RPC, oba wyglądające w interfejsie identycznie,
//   * ochrona tożsamości to reguła Chatham House, nie kolor tekstu: jeden
//     pominięty warunek pokazuje nazwisko autora wypowiedzi anonimowej,
//   * walidacja tematu jest bramką PRZED zapytaniem - `admin_club_thread_create`
//     odrzuci krótki tytuł błędem bazy, a moderator ma się o tym dowiedzieć
//     przed kliknięciem, nie po,
//   * pusty wybór osoby MUSI jechać jako `null`, bo `""` w `p_author_id`
//     to nie „publikuję sam”, tylko nieistniejący identyfikator,
//   * zdanie o ucięciu strony odpowiedzi jest różnicą między „widzisz wszystko”
//     a „widzisz wycinek” - bez niego moderator zamyka wątek po przeczytaniu
//     pierwszych pięćdziesięciu odpowiedzi z trzystu.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero klienta bazy. Wejściem są
// wiersze `admin_club_threads` / `admin_club_replies` i stan kontrolek,
// wyjściem deskryptory i KLUCZE i18n - w tym pliku nie ma ani jednego napisu
// do pokazania człowiekowi.
//
// UMOWA CO DO PUSTKI, którą trzeba znać czytając asercje. Generator typów
// Supabase deklaruje kolumny `RETURNS TABLE` jako non-null, więc `pinned_at`
// i `locked_at` mają w `AdminClubThreadRow` typ `string`, choć RPC oddaje tam
// NULL (migracja A8, `t.pinned_at` bez `coalesce`). Funkcje tego modułu
// przyjmują `string | null` i traktują OBIE postacie pustki - `null` oraz pusty
// napis - jako brak znacznika. Wariant z samym `!== null` (tak było w JSX-ie)
// jest poprawny dla danych z bazy, ale przy pustym napisie z atrapy albo
// z przyszłego `coalesce` cicho odwracał kierunek akcji.
import type { ClubThreadKind } from "./types";

/** Wartość dropListy „wszystkie” - filtr nieustawiony. */
export const THREAD_FILTER_ANY = "__any__";

/** Minimalna długość tytułu i treści nowego tematu - lustro bramki w RPC. */
export const ADMIN_THREAD_MIN_TITLE = 5;
export const ADMIN_THREAD_MIN_BODY = 10;

/**
 * Nazwa etykiety W SEKCJI `threads` słownika panelu - BEZ prefiksu klucza.
 *
 * Prefiks (`adminClubs` + `threads`) składa molekuła, i to nie jest kaprys
 * stylu: sekcje panelu mieszkają w osobnym słowniku, który trzeba jawnie
 * dociągnąć przez `ensureAdminClubsI18n()`. Zbudowanie pełnego klucza TUTAJ,
 * w module osiągalnym z tras publicznych, obchodziłoby bramkę
 * `adminClubsI18nLoading.gate` - a jej złamanie kończy się gołym kluczem na
 * ekranie i widać je dopiero w przeglądarce. Ta sama reguła i to samo
 * uzasadnienie są w `moderationRules.ts`.
 */
export type ThreadActionLabel = "pin" | "unpin" | "lock" | "unlock" | "delete" | "restore";

/** Nazwa podpowiedzi pod wyborem osoby, też bez prefiksu sekcji. */
export type OnBehalfLabel = "onBehalfHint" | "onBehalfWarning";

/** Akcje moderacyjne dostępne z wiersza listy tematów. */
export type ThreadBoardAction = "pin" | "unpin" | "lock" | "unlock" | "delete" | "restore";

/** Akcje wsadowe. `unlock`/`unpin` nie mają sensu na partii mieszanej. */
export type ThreadBulkAction = "pin" | "lock" | "restore" | "delete";

/** Wiersz w zakresie, którego dotyczą reguły zaznaczenia i akcji. */
export interface ThreadBoardRow {
  id: string;
  status: string;
  pinned_at: string | null;
  locked_at: string | null;
}

/** Wiersz w zakresie reguły ochrony tożsamości autora. */
export interface ThreadIdentityRow {
  author_name: string;
  is_anonymous: boolean;
  attribution_mode: string;
}

/**
 * Wartość filtra na argument zapytania: `__any__` znaczy „bez zawężenia”,
 * czyli `null`. Pusty napis też - droplista bez wyboru nie ma zawężać listy.
 */
export function threadFilterValue(raw: string): string | null {
  return raw === THREAD_FILTER_ANY || raw === "" ? null : raw;
}

/** Argument zapytania na wartość dropListy - odwrotność `threadFilterValue`. */
export function threadFilterSelectValue(value: string | null): string {
  return value ?? THREAD_FILTER_ANY;
}

/** Identyfikatory wierszy WIDOCZNYCH na ekranie (po filtrach i stronicowaniu). */
export function visibleThreadIds(rows: readonly ThreadBoardRow[]): Set<string> {
  return new Set(rows.map((row) => row.id));
}

/**
 * Zaznaczenie przecięte z widocznymi wierszami. Przecięcie, a nie czyszczenie
 * w efekcie: nie kosztuje dodatkowego renderu, a łapie też znikanie wierszy
 * BEZ zmiany filtra. Kolejność wynikowa idzie po zbiorze zaznaczenia.
 */
export function visibleThreadSelection(
  selected: ReadonlySet<string>,
  visibleIds: ReadonlySet<string>,
): string[] {
  return [...selected].filter((id) => visibleIds.has(id));
}

/** Przełącza identyfikator w zaznaczeniu, zwracając NOWY zbiór. */
export function toggleThreadSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Czy „zaznacz wszystkie” jest zaznaczone: komplet WIDOCZNYCH wierszy. */
export function areAllThreadsSelected(
  rows: readonly ThreadBoardRow[],
  selectedVisibleCount: number,
): boolean {
  return rows.length > 0 && selectedVisibleCount === rows.length;
}

/** Wszystkie identyfikatory widocznej strony - ładunek „zaznacz wszystkie”. */
export function allThreadIds(rows: readonly ThreadBoardRow[]): Set<string> {
  return new Set(rows.map((row) => row.id));
}

/**
 * Czy znacznik czasu z RPC jest USTAWIONY. Patrz umowa co do pustki
 * w nagłówku: `null` i pusty napis znaczą to samo - brak przypięcia/zamknięcia.
 */
export function isThreadMarkSet(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

/**
 * Czy wpis jest zdjęty z klubu - usunięcie miękkie albo ukrycie. Ta sama
 * reguła dotyczy tematu i ODPOWIEDZI: `admin_club_replies` oddaje te same dwa
 * statusy, a panel pokazuje przy nich „przywróć” zamiast „usuń”.
 */
export function isRemovedStatus(status: string): boolean {
  return status === "deleted" || status === "hidden";
}

/** Deskryptor jednego przycisku akcji: co wysłać i jaką etykietę pokazać. */
export interface ThreadActionDescriptor {
  action: ThreadBoardAction;
  label: ThreadActionLabel;
  /** Czy akcja COFA stan (odepnij / otwórz / przywróć) - decyduje o ikonie. */
  undo: boolean;
}

/** Stan przycisków akcji dla JEDNEGO wiersza listy. */
export interface ThreadRowActions {
  pinned: boolean;
  locked: boolean;
  removed: boolean;
  pin: ThreadActionDescriptor;
  lock: ThreadActionDescriptor;
  removal: ThreadActionDescriptor;
}

/**
 * Kierunek każdej z trzech akcji wiersza. To wyliczenie było trzema
 * wyrażeniami `?:` powtórzonymi w dwóch układach (tabela i karta), czyli
 * sześcioma miejscami do rozjechania się.
 */
export function threadRowActions(row: ThreadBoardRow): ThreadRowActions {
  const pinned = isThreadMarkSet(row.pinned_at);
  const locked = isThreadMarkSet(row.locked_at);
  const removed = isRemovedStatus(row.status);
  return {
    pinned,
    locked,
    removed,
    // Nazwa akcji i nazwa etykiety są tym samym napisem, ale NIE tym samym
    // pojęciem: pierwsza jedzie do RPC, druga składa klucz i18n. Rozdzielone
    // pola pilnują, żeby zmiana słownika nie przestawiła argumentu mutacji.
    pin: {
      action: pinned ? "unpin" : "pin",
      label: pinned ? "unpin" : "pin",
      undo: pinned,
    },
    lock: {
      action: locked ? "unlock" : "lock",
      label: locked ? "unlock" : "lock",
      undo: locked,
    },
    removal: {
      action: removed ? "restore" : "delete",
      label: removed ? "restore" : "delete",
      undo: removed,
    },
  };
}

/** Czy tożsamość autora jest chroniona (anonim albo tryb Chatham House). */
export function isThreadIdentityProtected(row: ThreadIdentityRow): boolean {
  return row.is_anonymous || row.attribution_mode === "chatham";
}

/** Wersja robocza kompozytora nowego tematu - dokładnie stan kontrolek. */
export interface AdminThreadDraft {
  groupId: string;
  title: string;
  body: string;
  kind: ClubThreadKind;
  authorId: string;
  topic: string | null;
}

/** Ładunek `admin_club_thread_create` po przycięciu i podstawieniu pustek. */
export interface AdminThreadCreateVars {
  groupId: string;
  title: string;
  body: string;
  kind: ClubThreadKind;
  authorId: string | null;
  topic: string | null;
}

/**
 * Dział efektywny kompozytora: wybrany jawnie, a gdy nie - PIERWSZY z listy.
 * Klub bez działów oddaje pusty napis i to jest sygnał dla walidacji, a nie
 * powód do wysłania mutacji bez działu.
 */
export function composerGroupId(chosen: string, groups: readonly { id: string }[]): string {
  if (chosen !== "") return chosen;
  return groups[0]?.id ?? "";
}

/**
 * Ładunek nowego tematu albo `null`, gdy wersja robocza nie przechodzi bramki.
 * Jedna funkcja na oba pytania celowo: „czy wolno” i „co wysłać” rozjeżdżały
 * się, gdy stały osobno (walidacja liczyła długość surową, ładunek przycinał).
 */
export function adminThreadCreateVars(
  draft: AdminThreadDraft,
  effectiveGroupId: string,
): AdminThreadCreateVars | null {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (
    effectiveGroupId === "" ||
    title.length < ADMIN_THREAD_MIN_TITLE ||
    body.length < ADMIN_THREAD_MIN_BODY
  ) {
    return null;
  }
  return {
    groupId: effectiveGroupId,
    title,
    body,
    kind: draft.kind,
    authorId: draft.authorId !== "" ? draft.authorId : null,
    topic: draft.topic,
  };
}

/** Etykieta ostrzeżenia pod wyborem osoby: publikacja w imieniu vs pod sobą. */
export function onBehalfLabel(authorId: string): OnBehalfLabel {
  return authorId !== "" ? "onBehalfWarning" : "onBehalfHint";
}

/** Ładunek `admin_club_reply_create` albo `null`, gdy treść jest pusta. */
export function adminReplyVars(
  threadId: string | null,
  body: string,
  authorId: string,
): { threadId: string; body: string; authorId: string | null } | null {
  if (threadId === null || threadId === "") return null;
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;
  return { threadId, body: trimmed, authorId: authorId !== "" ? authorId : null };
}

/** Czy przycisk publikacji odpowiedzi ma być aktywny. */
export function canPostAdminReply(body: string): boolean {
  return body.trim().length > 0;
}

/**
 * Działy docelowe przeniesienia: wszystkie POZA obecnym. Wątek przeniesiony
 * do własnego działu to wpis w dzienniku moderacji bez żadnej zmiany.
 */
export function threadMoveTargets<T extends { id: string }>(
  groups: readonly T[],
  currentGroupId: string | null | undefined,
): T[] {
  return groups.filter((group) => group.id !== currentGroupId);
}

/** Czy widoczna strona odpowiedzi jest UCIĘTA względem sumy z RPC. */
export function isRepliesPageTruncated(total: number, shown: number): boolean {
  return total > shown;
}

/** Wcięcie odpowiedzi w pikselach - poziom zagnieżdżenia razy dwanaście. */
export function replyIndentPx(depth: number): number {
  return Math.max(0, Math.trunc(depth)) * 12;
}
