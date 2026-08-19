// Moderacja klubu - REGUŁY OPERACJI NIEODWRACALNYCH. Czysty moduł, zero React.
//
// DLACZEGO AKURAT TE REGUŁY WYCHODZĄ Z PANELU. `ClubModerationTab.tsx` (185
// linii mierzonych, 0% pokrycia) wykonuje operacje, których nie da się cofnąć
// z interfejsu: usunięcie wątku, wyrzucenie członka, ukrycie wpisu
// i UJAWNIENIE AUTORA anonimowej wypowiedzi. Trzy rzeczy w tym panelu są
// regułą, a nie widokiem - i każda z nich psuje się cicho:
//
//   1. ROZBICIE ZAZNACZENIA NA PARTIE. `admin_club_bulk_moderate` przyjmuje
//      JEDEN typ celu, a kolejka miesza wątki z odpowiedziami. Błąd tutaj nie
//      wywala niczego: część zaznaczenia po prostu nie zostaje zmoderowana,
//      a komunikat i tak mówi „gotowe".
//
//   2. PRÓG POWODU PRZY UJAWNIENIU AUTORA. To JEDYNA akcja w module łamiąca
//      regułę Chatham House. RPC odrzuca pusty powód błędem 22023, ale
//      moderator ma się o tym dowiedzieć PRZED kliknięciem, nie po.
//
//   3. KTÓRE AKCJE WYMAGAJĄ POTWIERDZENIA. Zatwierdzenie i ukrycie da się
//      cofnąć (`restore`), usunięcia - nie. Dialog przy każdej akcji uczy
//      klikania „tak" bez czytania; dialog przy żadnej znaczy skasowany wątek
//      po jednym omyłkowym kliknięciu.
import { CLUB_LOG_TARGETS } from "./types";

/** Minimalna długość powodu ujawnienia autora - lustro bramki w RPC. */
export const MIN_REVEAL_REASON = 10;

/** Pozycja kolejki w zakresie, którego dotyczą reguły wsadu. */
export interface ModerationQueueItem {
  target_type: string;
  target_id: string;
}

/**
 * Rozbicie zaznaczenia na partie per TYP CELU.
 *
 * `admin_club_bulk_moderate` przyjmuje jeden typ na wywołanie, a kolejka
 * miesza wątki z odpowiedziami - stąd dwie listy zamiast jednej. `total`
 * liczy pozycje REALNIE objęte wsadem, więc komunikat „47 z 50" mówi prawdę
 * także wtedy, gdy część zaznaczenia zniknęła z kolejki w międzyczasie.
 */
export function splitModerationBatch(
  queue: readonly ModerationQueueItem[],
  selected: ReadonlySet<string>,
): { threadIds: string[]; replyIds: string[]; total: number } {
  const chosen = queue.filter((item) => selected.has(item.target_id));
  const threadIds = chosen.filter((i) => i.target_type === "thread").map((i) => i.target_id);
  const replyIds = chosen.filter((i) => i.target_type === "reply").map((i) => i.target_id);
  return { threadIds, replyIds, total: threadIds.length + replyIds.length };
}

/** Akcje moderacyjne dostępne z kolejki. */
export type QueueAction = "approve" | "hide" | "delete";

/**
 * Czy akcja wymaga potwierdzenia. Odwracalne (`approve`, `hide` - obie da się
 * cofnąć przez `restore`) idą od razu; usunięcie pyta.
 */
export function needsConfirmation(action: QueueAction): boolean {
  return action === "delete";
}

/** Czy powód ujawnienia autora wystarcza, żeby wysłać żądanie. */
export function revealReasonAccepted(reason: string): boolean {
  return reason.trim().length >= MIN_REVEAL_REASON;
}

/**
 * Czy typ celu jest w słowniku dziennika. Wartość spoza słownika (wpis
 * historyczny) widok pokazuje taką, jaka jest - moduł nie opiera żadnego
 * napisu na `defaultValue` i18n, bo wtedy brak klucza przechodzi przez bramkę
 * parytetu niezauważony.
 *
 * Ta funkcja odpowiada WYŁĄCZNIE na pytanie „czy znam ten typ", a nie „jaki
 * to klucz i18n" - i to jest różnica z konsekwencją. Sekcja `adminClubs.
 * moderation.*` mieszka w słowniku PANELU (`i18n-clubs-admin`), który trzeba
 * jawnie dociągnąć przez `ensureAdminClubsI18n()`. Budowanie tego klucza
 * tutaj, w module osiągalnym z tras publicznych, obeszłoby bramkę
 * `adminClubsI18nLoading.gate` - a jej złamanie kończy się gołym kluczem
 * na ekranie i jest widoczne dopiero w przeglądarce.
 */
export function isKnownModerationTarget(value: string): boolean {
  return (CLUB_LOG_TARGETS as readonly string[]).includes(value);
}

/** Przełącza id w zaznaczeniu, zwracając NOWY zbiór (bez mutacji stanu). */
export function toggleSelection(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Czy „zaznacz wszystko" jest zaznaczone: komplet pozycji widocznej strony. */
export function isAllSelected(
  queue: readonly ModerationQueueItem[],
  selected: ReadonlySet<string>,
): boolean {
  return queue.length > 0 && selected.size === queue.length;
}
