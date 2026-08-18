// Skok do wiadomości spoza wczytanego okna historii.
//
// Wyszukiwarka (pasek w oknie albo skrzynka /messages) potrafi trafić
// w wiadomość sprzed roku. `MessageList` umie przewinąć TYLKO do wiersza,
// który jest już w DOM-ie, więc ktoś musi dociągać starsze strony, aż wiersz
// wejdzie w okno. Ten hook jest tym kimś - i pilnuje trzech warunków, których
// złamanie widzi wyłącznie użytkownik:
//
//   1. BUDŻET STRON - bez limitu pętla przewinęłaby całą historię rozmowy na
//      jedno kliknięcie w wynik (12 stron × 40 = ~480 wiadomości wstecz).
//   2. BRAK PODWÓJNEGO FETCHU - dopóki strona leci, nie zamawiamy kolejnej;
//      inaczej jedno kliknięcie zjada budżet w kilku renderach.
//   3. UCZCIWA PORAŻKA - koniec historii albo wyczerpany budżet kończy skok
//      komunikatem, a nie cichym „nic się nie stało". Wiadomość mogła też
//      właśnie zniknąć po TTL i to jest normalny bieg rzeczy.
//
// Decyzja „co dalej" jest czystą funkcją (`nextJumpStep` w `thread.ts`), więc
// maszyna stanów ma test bez renderowania okna czatu.
import { useCallback, useEffect, useRef, useState } from "react";
import { JUMP_PAGE_BUDGET, nextJumpStep } from "./thread";

/**
 * Zewnętrzne żądanie skoku. `nonce` pozwala ponowić skok do TEJ SAMEJ
 * wiadomości (drugie kliknięcie w ten sam wynik wyszukiwania musi znów
 * przewinąć, a samo `id` się nie zmienia).
 */
export interface JumpRequest {
  readonly id: string;
  readonly nonce: number;
}

export interface ThreadJump {
  /** Id, do którego `MessageList` ma przewinąć (null = brak aktywnego skoku). */
  readonly jumpTarget: string | null;
  /** `MessageList` potwierdza wykonanie przewinięcia. */
  readonly onJumpHandled: () => void;
  /** Rozpocznij skok z pełnym budżetem stron (klik w trafienie w pasku). */
  readonly startJump: (messageId: string) => void;
}

export interface ThreadJumpParams {
  /** Żądanie z zewnątrz (wyszukiwarka skrzynki) albo null. */
  readonly request: JumpRequest | null;
  /**
   * Czy dana wiadomość jest już w wczytanym oknie. PREDYKAT, nie gotowy bool:
   * cel żyje wewnątrz hooka, więc wołający nie ma go jeszcze w chwili renderu.
   * Wcześniejszy wariant („podaj `targetLoaded`") wymagał od wołającego
   * lustrzanego stanu z celem, a taki stan zawsze jest o jeden render z tyłu -
   * czyli w najgorszym momencie mówi „nie ma", gdy wiadomość właśnie doszła.
   * Referencja musi być zmemoizowana po liście wiadomości.
   */
  readonly isLoaded: (messageId: string) => boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly fetchNextPage: () => void;
  /** Wołane, gdy skok się nie udał - miejsce na komunikat dla użytkownika. */
  readonly onExhausted: () => void;
}

export function useThreadJump(params: ThreadJumpParams): ThreadJump {
  const { request, isLoaded, hasNextPage, isFetchingNextPage, fetchNextPage, onExhausted } = params;
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const pagesLeftRef = useRef(0);

  const startJump = useCallback((messageId: string) => {
    pagesLeftRef.current = JUMP_PAGE_BUDGET;
    setJumpTarget(messageId);
  }, []);

  // `nonce` w zależnościach jest celowy: ponowny klik w ten sam wynik musi
  // przezbroić skok, choć `id` się nie zmieniło.
  const requestId = request?.id;
  const requestNonce = request?.nonce;
  useEffect(() => {
    if (!requestId) return;
    pagesLeftRef.current = JUMP_PAGE_BUDGET;
    setJumpTarget(requestId);
  }, [requestId, requestNonce]);

  useEffect(() => {
    const step = nextJumpStep({
      targetId: jumpTarget,
      targetLoaded: !!jumpTarget && isLoaded(jumpTarget),
      hasNextPage,
      isFetchingNextPage,
      pagesLeft: pagesLeftRef.current,
    });
    if (step === "fail") {
      onExhausted();
      setJumpTarget(null);
      return;
    }
    if (step !== "fetch") return;
    pagesLeftRef.current -= 1;
    fetchNextPage();
  }, [jumpTarget, isLoaded, hasNextPage, isFetchingNextPage, fetchNextPage, onExhausted]);

  const onJumpHandled = useCallback(() => setJumpTarget(null), []);
  return { jumpTarget, onJumpHandled, startJump };
}
