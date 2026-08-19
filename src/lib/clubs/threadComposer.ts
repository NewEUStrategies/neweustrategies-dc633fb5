// Reguły KOMPOZYTORA ODPOWIEDZI na stronie wątku - wyprowadzone z JSX-a.
//
// CO TU BYŁO PRZED WYPROWADZENIEM. Cztery decyzje kompozytora siedziały jako
// wyrażenia inline w drzewie znaczników trasy wątku, każda w innym miejscu
// pliku: warunek wysyłki był powtórzony DWA razy (raz w `submitReply`, raz
// w `disabled` przycisku), próg licznika znaków stał jako `0.7` w warunku
// renderu, obsługa klawiatury była dwoma `if`-ami w uchwycie zdarzenia,
// a wybór komunikatu o braku prawa do odpowiedzi - ternarnym wyrażeniem.
//
// Powtórzony warunek wysyłki to najgorszy z tych czterech: rozjazd między nim
// a `disabled` daje przycisk, który wygląda na czynny i nic nie robi (albo
// odwrotnie - wysyła pusty wpis). Jedna funkcja zamyka tę możliwość.
//
// DLACZEGO TO SĄ REGUŁY, A NIE UKŁAD:
//
//   * ENTER ZOSTAJE ZNAKIEM NOWEJ LINII. To jest pole deliberacji, nie okno
//     czatu - wysłanie akapitu w połowie zdania jest tu kosztowniejsze niż
//     jedno kliknięcie więcej (V1 §4.1). Wysyłka idzie Ctrl/Cmd + Enter.
//   * ESCAPE ZDEJMUJE ADRESATA, nie treść. Wyjście z odpowiadania komuś
//     konkretnemu nie może kasować napisanego tekstu.
//   * LICZNIK ZNAKÓW pokazuje się dopiero, gdy limit robi się realny. Stały
//     licznik pod polem uczy, że tekst ma być krótki - a to nieprawda.
//   * BRAK PRAWA DO ODPOWIEDZI ma powiedzieć POWÓD, jeśli RPC go podało.
//     „Nie możesz odpowiedzieć” bez powodu wygląda jak awaria.
//
// GRANICA WARSTW: zero Reacta, zero i18n, zero bazy. Zdarzenie klawiatury
// wchodzi tu jako trzy pola (`key`, `metaKey`, `ctrlKey`), więc reguła daje się
// sprawdzić tabelą przypadków bez syntetycznego zdarzenia DOM-u; funkcje
// zwracają KLUCZE i18n, nigdy tekstu.

/** Twardy limit treści odpowiedzi - ten sam, co `maxLength` pola. */
export const CLUB_REPLY_BODY_MAX = 10000;

/**
 * Od jakiego udziału limitu pokazujemy licznik znaków. 70 % to punkt, w którym
 * limit przestaje być teoretyczny: przy 10 000 znaków zostaje jeszcze 3 000, na
 * dopisanie akapitu i przeredagowanie wystarczy.
 */
export const CLUB_REPLY_COUNTER_RATIO = 0.7;

/** Długość treści PO PRZYCIĘCIU - same spacje nie są treścią. */
export function clubReplyBodyLength(body: string): number {
  return body.trim().length;
}

/**
 * Czy wolno wysłać. JEDNO miejsce dla przycisku i dla uchwytu wysyłki - inaczej
 * te dwa warunki rozjeżdżają się przy pierwszej zmianie.
 *
 * Wpis W DRODZE blokuje wysyłkę: podwójne kliknięcie „Odpowiedz” przy wolnym
 * łączu dawałoby dwie identyczne odpowiedzi, a RPC nie ma na to
 * deduplikacji.
 */
export function canSubmitClubReply(body: string, pending: boolean): boolean {
  return clubReplyBodyLength(body) > 0 && !pending;
}

/** Czy pokazać licznik znaków. */
export function showsClubReplyCounter(
  body: string,
  max: number = CLUB_REPLY_BODY_MAX,
): boolean {
  return clubReplyBodyLength(body) > max * CLUB_REPLY_COUNTER_RATIO;
}

/** Rozstrzygnięcie skrótu klawiszowego w kompozytorze. */
export type ClubComposerKeyIntent = "submit" | "clear-reply-target" | "ignore";

/** Pola zdarzenia klawiatury, na których stoi ta reguła. */
export interface ClubComposerKeyEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

/**
 * Co ma się stać po naciśnięciu klawisza w kompozytorze.
 *
 * `Escape` bez wybranego adresata to `ignore`, nie „nic nie rób i zablokuj
 * klawisz”: trasa dopiero po tym rozstrzygnięciu woła `preventDefault`, więc
 * zwrócenie tu czegokolwiek innego odebrałoby Escape jego domyślne działanie
 * (zamknięcie podpowiedzi wzmianek) w polu bez adresata.
 */
export function clubComposerKeyIntent(
  event: ClubComposerKeyEvent,
  hasReplyTarget: boolean,
): ClubComposerKeyIntent {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") return "submit";
  if (event.key === "Escape" && hasReplyTarget) return "clear-reply-target";
  return "ignore";
}

/**
 * Nagłówek kompozytora. „Odpowiadasz na…” zamiast „Napisz odpowiedź” jest
 * jedynym sygnałem, że wpis pójdzie w GAŁĄŹ, a nie na koniec wątku.
 */
export function clubComposerHeadingKey(replyTarget: string | null): string {
  return replyTarget !== null ? "club.replyingTo" : "club.postReply";
}

/**
 * Zdanie w miejscu kompozytora, gdy odpowiadać nie wolno.
 *
 * `reason` przychodzi z RPC jako kod ze słownika (`locked`, `not_member`,
 * `tier_too_low`…). Pusty kod znaczy „brak prawa bez podanej przyczyny” -
 * wtedy zdanie ogólne. Wstawianie surowego kodu do tekstu byłoby pokazaniem
 * użytkownikowi identyfikatora z bazy.
 */
export function clubBlockedReplyKey(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason.length === 0) return "club.cannotReply";
  return `club.reason.${reason}`;
}
