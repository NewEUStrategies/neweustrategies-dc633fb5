// „TERAZ" BEZPIECZNE DLA HYDRATACJI - jeden hook dla całej rodziny etykiet
// względnych i liczników.
//
// PROBLEM, KTÓRY ROZWIĄZUJE. Zegar przeczytany W CIELE RENDERU jest na serwerze
// i na kliencie inną liczbą - i to nie o milisekundy:
//   * `Date.now()` na Cloudflare Workers jest kwantowany do ostatniego I/O
//     w żądaniu, więc nie jest nawet „czasem renderu";
//   * dokument publiczny wchodzi do NES Edge Cache na do 24 h, więc czytelnik
//     dostaje HTML policzony godzinami wcześniej.
// React 19 przy rozjeździe tekstu PORZUCA serwerowe poddrzewo i renderuje je od
// zera na kliencie - objawem nie jest błąd, tylko utrata dokładnie tego HTML-a,
// który SSR miał dostarczyć.
//
// KONTRAKT: `null` w SSR i w PIERWSZYM renderze klienta, prawdziwa chwila
// dopiero po montażu. Wołający MUSI mieć dla `null` gałąź deterministyczną
// (placeholder albo data absolutna) - i to jest cała dyscyplina tego wzorca.
//
// Wzorzec pochodzi z `EventCountdownView` („SSR i pierwszy render klienta są
// identyczne, więc hydratacja nigdy się nie rozjeżdża"); tutaj jest wyciągnięty
// do jednego miejsca, bo tę samą rzecz robiło niezależnie pięć komponentów.
import { useEffect, useState } from "react";

/**
 * Bieżąca chwila w ms, albo `null` dopóki komponent nie jest zamontowany.
 *
 * @param intervalMs Co ile odświeżać po montażu. `0` = jednorazowo (etykiety
 *   względne w skali godzin i dni nie potrzebują tykania).
 */
export function useNowMs(intervalMs = 0): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (intervalMs <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
