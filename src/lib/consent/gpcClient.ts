// Global Privacy Control - odczyt po stronie klienta.
//
// Cienka warstwa DOM nad czystym rdzeniem (`gpc.ts`): składa dwa nośniki
// (`navigator.globalPrivacyControl` + cookie transportowe od SSR) w jeden
// sygnał i pozwala UI reagować na jego zmianę. Rdzeń zostaje wolny od globali
// przeglądarki, więc jest testowalny bez jsdom, a ten plik - z jsdom.
import {
  GPC_EVENT,
  GPC_INACTIVE,
  resolveClientGpc,
  type GpcNavigatorLike,
  type GpcSignal,
} from "@/lib/consent/gpc";

/**
 * Bieżący sygnał GPC tej karty. Czytany za KAŻDYM wywołaniem (bez cache'a):
 * rozszerzenie prywatnościowe może przestawić `navigator.globalPrivacyControl` w
 * trakcie sesji, a zapamiętana wartość zamieniłaby cofnięty opt-out w trwały -
 * albo, gorzej, świeży opt-out w ignorowany.
 */
export function readGpcSignal(): GpcSignal {
  if (typeof window === "undefined") return GPC_INACTIVE;
  const nav = typeof navigator === "undefined" ? null : (navigator as unknown as GpcNavigatorLike);
  const cookie = typeof document === "undefined" ? null : document.cookie;
  return resolveClientGpc(nav, cookie);
}

/** Skrót dla bramkowania: czy sygnał jest aktywny w tej karcie. */
export function isGpcSignalActive(): boolean {
  return readGpcSignal().active;
}

/**
 * Subskrypcja zmian sygnału. `GPC_EVENT` emitujemy sami (np. po świadomym
 * override), a `storage`/`focus` łapią przełączenie rozszerzenia w innej karcie
 * lub poza kartą - przeglądarki nie mają dla GPC własnego zdarzenia.
 */
export function subscribeGpc(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(GPC_EVENT, listener);
  window.addEventListener("focus", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(GPC_EVENT, listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("storage", listener);
  };
}

/** Rozgłoś zmianę sygnału/override'u do wszystkich nasłuchujących powierzchni. */
export function notifyGpcChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GPC_EVENT));
}
