// Hak rezerwacji dolnej krawędzi dla paska doku.
//
// WYCIĄGNIĘTY Z `WorkspaceDock.tsx` z trzech powodów, w tej kolejności:
//   1. to POWIERZCHNIA SSR-OWA Z POMIAREM PRZED MALOWANIEM, a takie w tym
//      repozytorium idą przez `useIsomorphicLayoutEffect` i są wymienione
//      w asercji źródłowej `ssrRenderSafety.test.tsx` - dopisanie doku do tej
//      listy wymaga, żeby pomiar dał się wskazać jako osobny moduł;
//   2. pomiar + publikacja + sprzątanie to logika, którą trzeba przetestować
//      bez renderowania całego paska;
//   3. pasek nie jest jedyną powierzchnią, która kiedykolwiek zajmie dolną
//      krawędź (był tam mobilny pasek dolny, jest dok czatu) - jedna
//      implementacja zamiast trzeciej kopii.
//
// ── CO NAPRAWIA WOBEC POPRZEDNIEJ WERSJI ──────────────────────────────────
//  * POMIAR PRZED MALOWANIEM. Było `useEffect` (po malowaniu), więc pasek
//    malował się w jednej klatce, a rezerwacja dochodziła w następnej -
//    dwa przeskoki zamiast jednego. `useIsomorphicLayoutEffect` sadza zapis
//    w tym samym commicie, w którym pasek wchodzi.
//  * ZNACZNIK PO POMIARZE, NIE PRZED. Było `root.dataset.mbb = "on"`
//    bezwarunkowo, a publikacja wysokości pod warunkiem `value > 0`. Pomiar
//    zerowy (węzeł pod `display: none`, pomiar poza układem) włączał więc
//    rezerwację BEZ wysokości, a CSS spadał na zapas 72 px przy pasku
//    ~33-38 px - ~35 px pustego pasa. Teraz znacznik zapala się dopiero razem
//    z liczbą.
//  * SPRZĄTANIE PILNUJE WŁASNOŚCI. Było bezwarunkowe `removeAttribute`, więc
//    poprawność zależała od kolejności, w jakiej React zatwierdza usunięcia
//    względem efektów nowego poddrzewa (dok przemontowuje się przy przejściu
//    na trasę z `ownChrome`). Teraz instancja podpisuje znacznik własnym
//    tokenem i zdejmuje go TYLKO, jeśli nadal jest właścicielem - warunek
//    stoi w kodzie, a nie w wiedzy o wnętrzu Reacta.
//  * ZAPAMIĘTANIE WYSOKOŚCI. Zmierzona wartość ląduje w magazynie lokalnym,
//    skąd skrypt sprzed malowania odtwarza rezerwację przy następnym wejściu
//    (patrz `reservedSpace.ts`) - dół strony przestaje podskakiwać.
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/react/useIsomorphicLayoutEffect";
import {
  DOCK_RESERVE_ATTR,
  DOCK_RESERVE_PROP,
  normalizeReservedSpace,
  readReservedSpace,
  writeReservedSpace,
} from "./reservedSpace";

/**
 * Licznik instancji. Rośnie przy każdym montażu, więc dwa paski (podgląd
 * w panelu obok prawdziwego) nie mogą sobie odebrać znacznika przez pomyłkę.
 */
let ownerSeq = 0;

export interface DockReservedSpace {
  /** Referencja do mierzonego węzła (pasek doku). */
  ref: React.RefObject<HTMLDivElement | null>;
  /**
   * Zmierzona wysokość paska w pikselach. Do pierwszego pomiaru niesie
   * wartość zapamiętaną (albo 0) - panele używają jej jako odsunięcia, więc
   * lepiej zacząć od liczby z poprzedniej wizyty niż od zera.
   */
  height: number;
}

/**
 * Mierzy pasek, publikuje `--mbb-space` i `data-mbb="on"` na `<html>`,
 * zapamiętuje wysokość i utrzymuje ją przy zmianie rozmiaru okna.
 */
export function useDockReservedSpace(): DockReservedSpace {
  const ref = useRef<HTMLDivElement | null>(null);
  // Pierwszy render (serwer i klient) nie zna wysokości. Zapamiętaną wartość
  // czytamy w efekcie, NIE w ciele renderu - ciało renderu musi dać ten sam
  // wynik po obu stronach, a magazyn lokalny to stan, którego React nie
  // śledzi. Ta sama zasada, którą `travel-route-card.tsx` opisuje wprost.
  const [height, setHeight] = useState(0);
  const ownerRef = useRef<string>("");

  const publish = useCallback((raw: number) => {
    const px = normalizeReservedSpace(raw);
    if (px === null) return;
    setHeight((prev) => (prev === px ? prev : px));
    const root = document.documentElement;
    root.style.setProperty(DOCK_RESERVE_PROP, `${px}px`);
    // Znacznik zapala się RAZEM z liczbą - nigdy przed nią.
    root.dataset[DOCK_RESERVE_ATTR] = "on";
    if (typeof window !== "undefined") writeReservedSpace(window.localStorage, px);
  }, []);

  // Gałąź layoutowa na kliencie: pomiar leci przed malowaniem tego commitu,
  // więc pasek i rezerwacja pojawiają się w tej samej klatce. Na serwerze to
  // `useEffect`, a tam ciało i tak nie biegnie (React nie odpala efektów
  // w `renderToString`).
  useIsomorphicLayoutEffect(() => {
    ownerSeq += 1;
    const owner = `wd-${ownerSeq}`;
    ownerRef.current = owner;
    const root = document.documentElement;
    root.dataset.mbbOwner = owner;

    // Zapamiętana wysokość od razu, żeby panele dostały sensowne odsunięcie
    // jeszcze przed pierwszym pomiarem (skrypt sprzed malowania ustawił już
    // tę samą liczbę na `<html>`, więc to nie jest nowy zapis do układu).
    const remembered = readReservedSpace(window.localStorage);
    if (remembered !== null) setHeight(remembered);

    const node = ref.current;
    if (node) publish(node.offsetHeight);

    return () => {
      // Zdejmujemy TYLKO własny znacznik. Przy przemontowaniu doku nowa
      // instancja podpisała już `mbbOwner` swoim tokenem, więc ten warunek
      // nie przepuści sprzątania, które zabrałoby jej rezerwację.
      if (root.dataset.mbbOwner !== owner) return;
      delete root.dataset.mbbOwner;
      delete root.dataset[DOCK_RESERVE_ATTR];
      root.style.removeProperty(DOCK_RESERVE_PROP);
    };
  }, [publish]);

  // Zmiana rozmiaru: osobny efekt PASYWNY, bo tu nie ma czego zdążyć przed
  // malowaniem - obserwator i tak odpala się po układzie. Reagujemy tylko na
  // FAKTYCZNĄ zmianę wysokości, żeby nie publikować tej samej liczby
  // w pętli (ten sam wniosek co w `MobileBottomBarView`).
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let last = node.offsetHeight;
    const observer = new ResizeObserver(() => {
      const next = node.offsetHeight;
      if (next === last) return;
      last = next;
      publish(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [publish]);

  return { ref, height };
}
