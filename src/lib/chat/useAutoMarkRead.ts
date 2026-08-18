// Automatyczne oznaczanie rozmowy jako przeczytanej.
//
// Reguła produktu: oznaczamy, gdy NAJNOWSZA wiadomość jest od rozmówcy,
// licznik nieprzeczytanych jest niezerowy, karta jest WIDOCZNA, a użytkownik
// nie wyłączył tego w preferencjach (`auto_mark_on_open`).
//
// Trzy rzeczy, które ten hook trzyma, a które w organizmie ginęły:
//
//   1. WIDOCZNOŚĆ JEST REAKTYWNA. Odczyt `document.visibilityState` w efekcie
//      daje wartość z chwili renderu; powrót do zakładki nie przerenderowuje
//      nic sam z siebie, więc oznaczenie nie odpalałoby się nigdy. Dlatego
//      `useSyncExternalStore` nad zdarzeniem `visibilitychange`.
//   2. KOALESCENCJA PO ID. Bez niej każdy render z tą samą najnowszą
//      wiadomością wołałby RPC ponownie. RPC jest wprawdzie idempotentne
//      (no-op, gdy nie ma nic nowego), ale każdy zbędny strzał to round-trip
//      i - przy realtime - zbędny fanout do rozmówcy.
//   3. SSR. `getServerSnapshot` musi zwrócić `false`, inaczej hydratacja
//      próbowałaby czytać `document` na serwerze.
import { useEffect, useRef, useSyncExternalStore } from "react";

function subscribeVisibility(callback: () => void): () => void {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}
const getDocumentVisible = (): boolean => document.visibilityState === "visible";
const getDocumentVisibleServer = (): boolean => false;

/** Czy karta przeglądarki jest widoczna - reaktywnie, dla dowolnej powierzchni. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, getDocumentVisible, getDocumentVisibleServer);
}

export interface AutoMarkReadParams {
  readonly conversationId: string;
  readonly myUserId: string | undefined;
  /** Nadawca i id najnowszej wiadomości wątku (null = pusty wątek). */
  readonly lastMessage: { readonly id: string; readonly sender_id: string } | undefined;
  readonly unreadCount: number;
  /** Preferencja `auto_mark_on_open` - wyłączona zostawia licznik do ręcznego oznaczenia. */
  readonly enabled: boolean;
  readonly markRead: (conversationId: string) => void;
}

/**
 * Czy w tym stanie należy zawołać `mark_conversation_read`. Wydzielone jako
 * czysty predykat, żeby regułę („tylko cudza wiadomość, tylko przy widocznej
 * karcie, tylko gdy licznik niezerowy") dało się przetestować bez Reacta.
 */
export function shouldMarkRead(params: {
  readonly myUserId: string | undefined;
  readonly lastMessage: { readonly id: string; readonly sender_id: string } | undefined;
  readonly unreadCount: number;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly alreadyMarkedId: string | null;
}): boolean {
  const { myUserId, lastMessage, unreadCount, visible, enabled, alreadyMarkedId } = params;
  if (!myUserId || !lastMessage || !visible || !enabled) return false;
  if (lastMessage.sender_id === myUserId) return false;
  if (unreadCount <= 0) return false;
  return alreadyMarkedId !== lastMessage.id;
}

export function useAutoMarkRead(params: AutoMarkReadParams): void {
  const { conversationId, myUserId, lastMessage, unreadCount, enabled, markRead } = params;
  const visible = useDocumentVisible();
  /**
   * Klucz koalescencji niesie ROZMOWĘ, nie tylko id wiadomości.
   *
   * Pierwsza wersja tego hooka zerowała ref osobnym efektem na zmianie
   * `conversationId`. Efekty biegną w kolejności deklaracji, więc ten drugi
   * czyścił ref ZARAZ PO pierwszym oznaczeniu - i koalescencja przestawała
   * działać: dowolna późniejsza zmiana `unreadCount` (a ta zmienia się przy
   * każdym refetchu listy) wołała RPC ponownie dla tej samej wiadomości.
   * Klucz złożony rozstrzyga oba warunki jednym porównaniem, bez drugiego
   * efektu.
   */
  const markedRef = useRef<string | null>(null);
  // Refy dla identyczności: `markRead` to `mutate` z react-query, a `lastMessage`
  // to nowy obiekt w każdym renderze - w zależnościach efektu byłyby szumem.
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  const lastMessageRef = useRef(lastMessage);
  lastMessageRef.current = lastMessage;

  const lastMessageId = lastMessage?.id;
  useEffect(() => {
    const message = lastMessageRef.current;
    const markedHere = markedRef.current?.startsWith(`${conversationId}:`)
      ? markedRef.current.slice(conversationId.length + 1)
      : null;
    if (
      !shouldMarkRead({
        myUserId,
        lastMessage: message,
        unreadCount,
        visible,
        enabled,
        alreadyMarkedId: markedHere,
      })
    ) {
      return;
    }
    markedRef.current = message ? `${conversationId}:${message.id}` : null;
    markReadRef.current(conversationId);
  }, [lastMessageId, unreadCount, conversationId, myUserId, visible, enabled]);
}
