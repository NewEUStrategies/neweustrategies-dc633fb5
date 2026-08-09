// Odpowiedzi, ktore NIE wskakuja same pod kursor czytelnika.
//
// To jest wymaganie projektowe modulu, nie ozdoba (V1 §5.4): "Realtime: nowe
// odpowiedzi NIE wskakuja same do widoku. Pojawia sie pasek '3 nowe odpowiedzi
// - pokaz'. Wstawianie tresci pod kursorem czytajacego to najczestszy blad UX
// w tej klasie produktow; czat moze sobie na to pozwolic, dluga deliberacja
// nie."
//
// STAN PRZED TA ZMIANA. Naglowek trasy watku opisywal ten pasek jako istniejacy,
// a nie istnial. Co gorsza, zachowanie bylo DOKLADNIE ODWROTNE do opisanego:
// `useDomainEventInvalidation` jest montowany globalnie w __root, a mapa
// inwalidacji przepisuje `club_reply.created.v1` na `clubKeys.repliesAll`, wiec
// kazda cudza odpowiedz uniewazniala zapytanie i wstawiala sie w srodek
// czytanej wlasnie dyskusji, przesuwajac tresc pod kursorem.
//
// MECHANIKA. Nie zamrazamy zapytania (dane maja byc swieze - inaczej licznik
// w pasku klamie). Zamrazamy PROJEKCJE: renderujemy wylacznie te wiersze,
// ktorych identyfikatory czytelnik juz "przyjal". Konsekwencje sa trzy i kazda
// jest zamierzona:
//
//   * REDAKCJA cudzego wpisu, ktory juz widac, pojawia sie natychmiast - to nie
//     jest nowa tresc, tylko poprawka tej, ktora czytelnik ma przed oczami;
//   * USUNIECIE przez moderacje dziala natychmiast - tresc zdjeta z obiegu nie
//     ma prawa czekac w kolejce na klikniecie czytelnika;
//   * WLASNA odpowiedz ma sie pokazac od razu, wiec widok wola `reveal()`
//     po udanej mutacji. Kazanie autorowi kliknac "pokaz nowe", zeby zobaczyc
//     to, co przed chwila wyslal, byloby absurdem.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClubReplyRow } from "./types";

export interface DeferredReplies {
  /** Wiersze do wyrenderowania - podzbior `latest` przyjety przez czytelnika. */
  rows: ClubReplyRow[];
  /** Ile nowych odpowiedzi czeka na pokazanie. */
  pendingCount: number;
  /** Przyjmuje wszystko, co czeka. */
  reveal: () => void;
  /**
   * Przyjmuje WSKAZANE wpisy, nie wszystko.
   *
   * Po co osobno od `reveal`. Wlasna odpowiedz ma sie pokazac natychmiast, ale
   * `reveal()` przyjmuje przy okazji KAZDY cudzy wpis, ktory w miedzyczasie
   * wpadl do kolejki - czyli wstawia cudza tresc pod kursorem czytelnika
   * dokladnie w chwili, gdy on sam cos wysyla. To jest ten sam blad, przed
   * ktorym broni caly ten modul, tyle ze wywolany wlasnym dzialaniem.
   */
  accept: (ids: readonly string[]) => void;
}

/**
 * @param latest aktualny wynik zapytania (moze byc `undefined` przy pierwszym renderze)
 * @param threadId zmiana watku zeruje stan - inaczej czytelnik wchodzacy w drugi
 *   watek zobaczylby pasek "N nowych" liczony wzgledem pierwszego
 */
export function useDeferredReplies(
  latest: readonly ClubReplyRow[] | undefined,
  threadId: string | undefined,
): DeferredReplies {
  const [acceptedIds, setAcceptedIds] = useState<ReadonlySet<string>>(() => new Set());
  const threadRef = useRef<string | undefined>(threadId);
  // Pierwsza partia jest przyjmowana bez pytania: pasek "12 nowych odpowiedzi"
  // nad pusta lista przy wejsciu do watku nie ma sensu.
  const primedRef = useRef(false);

  if (threadRef.current !== threadId) {
    threadRef.current = threadId;
    primedRef.current = false;
  }

  useEffect(() => {
    if (latest === undefined) return;
    if (primedRef.current) return;
    primedRef.current = true;
    setAcceptedIds(new Set(latest.map((row) => row.id)));
  }, [latest]);

  const reveal = useCallback(() => {
    if (latest === undefined) return;
    setAcceptedIds(new Set(latest.map((row) => row.id)));
  }, [latest]);

  const accept = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setAcceptedIds((prev) => {
      // Bez nowego wpisu nie ma po co przerysowywac listy - `new Set(prev)`
      // przy kazdym wywolaniu zmienialoby referencje stanu i wymuszal render.
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const rows = (latest ?? []).filter((row) => acceptedIds.has(row.id));
  const pendingCount = (latest ?? []).length - rows.length;

  return { rows, pendingCount, reveal, accept };
}
