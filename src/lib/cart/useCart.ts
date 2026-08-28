// Hook koszyka - JEDEN magazyn na kartę przeglądarki.
//
// `useSyncExternalStore` zamiast kontekstu: koszyk czyta ikona w nagłówku,
// przycisk przy bilecie i strona `/cart`, a te powierzchnie montują się w
// różnych poddrzewach (widget buildera, trasa wydarzenia, trasa profilu).
// Provider musiałby stać w korzeniu i obejmować także podgląd studia, który
// stoi POZA drzewem tras. Magazyn modułowy nie ma tego ograniczenia.
//
// SSR zwraca pusty koszyk (`getServerSnapshot`) - localStorage nie istnieje na
// serwerze, a rozjazd hydracji dałby ostrzeżenie React #418 na każdej stronie.
import { useCallback, useSyncExternalStore } from "react";

import {
  addCartItem,
  cartTotals,
  readCartStorage,
  removeCartItem,
  writeCartStorage,
  type CartItem,
  type CartTotals,
} from "@/lib/cart/cartStore";

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: CartItem[] | null = null;
const EMPTY: CartItem[] = [];

function current(): CartItem[] {
  if (snapshot === null) snapshot = readCartStorage();
  return snapshot;
}

function commit(next: CartItem[]): void {
  snapshot = next;
  writeCartStorage(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Druga karta tej samej przeglądarki musi widzieć ten sam koszyk - inaczej
  // użytkownik dodaje bilet w jednej zakładce, a płaci w drugiej ze starą listą.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== "nes:cart:v1") return;
    snapshot = readCartStorage();
    for (const l of listeners) l();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export interface UseCartResult {
  items: CartItem[];
  totals: CartTotals;
  add: (item: CartItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}

export function useCart(): UseCartResult {
  const items = useSyncExternalStore(
    subscribe,
    current,
    () => EMPTY,
  );

  const add = useCallback((item: CartItem) => commit(addCartItem(current(), item)), []);
  const remove = useCallback((id: string) => commit(removeCartItem(current(), id)), []);
  const clear = useCallback(() => commit([]), []);
  const has = useCallback((id: string) => current().some((entry) => entry.id === id), []);

  return { items, totals: cartTotals(items), add, remove, clear, has };
}
