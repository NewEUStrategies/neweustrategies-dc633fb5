import { useCallback, useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/react/useIsomorphicLayoutEffect";
import { watchAuthorTitle, type AuthorTitleMeasurement } from "./authorTitleScheduler";

/**
 * Rozmiar nazwiska autora w trybie „tytuł minus 2 px”:
 *  * `undefined` - jeszcze nie zmierzono (HTML z serwera i render hydratacji
 *    są identyczne; do pomiaru rozmiar szacuje CSS, patrz `styles.css`),
 *  * `null`      - w zakresie bylinu nie ma tytułu: obowiązuje rozmiar z panelu,
 *  * liczba      - zmierzony tytuł minus 2 px.
 */
export type AuthorTitleSize = AuthorTitleMeasurement | undefined;

/**
 * Idzie za tytułem karty bylinu (zakres i harmonogram: `authorTitleScheduler`).
 * Pierwszy pomiar biegnie w efekcie layoutowym, czyli przed malowaniem.
 */
export function useAuthorTitleSize(enabled: boolean): {
  ref: (node: HTMLElement | null) => void;
  size: AuthorTitleSize;
} {
  const [size, setSize] = useState<AuthorTitleSize>(undefined);
  const node = useRef<HTMLElement | null>(null);
  const watched = useRef<{ node: HTMLElement; stop: () => void } | null>(null);
  const ref = useCallback((next: HTMLElement | null) => {
    node.current = next;
  }, []);
  // Bez tablicy zależności: węzeł bylinu pojawia się dopiero z danymi autora
  // i potrafi zmienić typ (`<a>` ⇄ `<span>`). Porównanie referencji przy każdym
  // renderze kosztuje mniej niż dodatkowy render z callback-refa w stanie.
  useIsomorphicLayoutEffect(() => {
    const next = enabled ? node.current : null;
    if (watched.current?.node === next) return;
    watched.current?.stop();
    watched.current = next ? { node: next, stop: watchAuthorTitle(next, setSize) } : null;
  });
  useIsomorphicLayoutEffect(
    () => () => {
      watched.current?.stop();
      watched.current = null;
    },
    [],
  );
  return { ref, size: enabled ? size : undefined };
}
