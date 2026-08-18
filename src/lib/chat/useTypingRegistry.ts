// Rejestr piszących w rozmowie: zbiór id + niezależny licznik wygaszenia dla
// każdego z nich, spięty z kanałem broadcastu „typing".
//
// DLACZEGO ZBIÓR, A NIE JEDNO POLE. W kręgu kilka osób pisze naraz. Jedno pole
// („kto pisze") gasło przy pauzie DOWOLNEJ z nich, więc wskaźnik migał
// i kłamał. Zbiór z licznikiem per osoba gasi tylko tę, która przestała.
//
// DLACZEGO OSOBNY HOOK. `ChatWindow` trzymał tu 40 linii stanu, refów
// i trzech efektów wymieszanych z resztą organizmu - w tym najłatwiejszy do
// przeoczenia warunek poprawności: przełączenie rozmowy w oknie dokowanym
// dzieje się BEZ remountu, więc piszący z poprzedniego wątku muszą zostać
// zdjęci na OBU krawędziach efektu (wejście i wyjście), inaczej „Anna pisze..."
// przenosi się do rozmowy z Markiem.
import { useCallback, useEffect, useRef, useState } from "react";
import { addTyper, removeTyper } from "./thread";
import { useConversationChannel, type TypingEvent } from "./useMessages";

/** Ile pokazujemy „pisze..." bez kolejnego pingu (klient nadaje co ~2 s). */
export const TYPING_VISIBLE_MS = 4000;

export interface TypingRegistry {
  /** Id osób, które właśnie piszą (bez wołającego - kanał nie echuje własnych). */
  readonly typingUserIds: ReadonlySet<string>;
  /**
   * Nadaj własny ping. `sendTyping(false)` to JAWNE „przestałem" - wysyłane
   * razem z wiadomością, żeby wskaźnik u rozmówcy zgasł natychmiast, a nie po
   * wygaśnięciu licznika.
   */
  readonly sendTyping: (typing?: boolean) => void;
}

/**
 * @param conversationId rozmowa, której kanał nasłuchujemy,
 * @param enabled        false = brak subskrypcji (okno zamknięte/zminimalizowane),
 * @param broadcast      false = obserwujemy, ale nie nadajemy (preferencja
 *                       `typing_indicators_enabled`; odbiór zostaje bez zmian).
 */
export function useTypingRegistry(
  conversationId: string,
  enabled: boolean,
  broadcast: boolean,
): TypingRegistry {
  const [typingUserIds, setTypingUserIds] = useState<ReadonlySet<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const drop = useCallback((userId: string) => {
    const timer = timersRef.current.get(userId);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(userId);
    setTypingUserIds((prev) => removeTyper(prev, userId));
  }, []);

  const handleTypingEvent = useCallback(
    (event: TypingEvent) => {
      if (event.typing === false) {
        drop(event.userId);
        return;
      }
      setTypingUserIds((prev) => addTyper(prev, event.userId));
      const existing = timersRef.current.get(event.userId);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        event.userId,
        setTimeout(() => drop(event.userId), TYPING_VISIBLE_MS),
      );
    },
    [drop],
  );

  const { sendTyping: emit } = useConversationChannel(conversationId, enabled, handleTypingEvent);

  // Przełączenie rozmowy bez remountu (dock): stan i liczniki lecą na obu
  // krawędziach, żeby piszący nie przeciekli między wątkami.
  useEffect(() => {
    setTypingUserIds((prev) => (prev.size === 0 ? prev : new Set()));
    const timers = timersRef.current;
    const clearAll = () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
    clearAll();
    return clearAll;
  }, [conversationId]);

  const sendTyping = useCallback(
    (typing?: boolean) => {
      if (broadcast) emit(typing);
    },
    [broadcast, emit],
  );

  return { typingUserIds, sendTyping };
}
