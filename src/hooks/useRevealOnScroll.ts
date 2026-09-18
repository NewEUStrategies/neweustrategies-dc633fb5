import { useEffect, useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/react/useIsomorphicLayoutEffect";

export type RevealState = "static" | "armed" | "run";

/**
 * Okno, w którym przerysowanie wykresu czyta się jako WEJŚCIE, a nie jako
 * usterka. Liczone od startu nawigacji (`performance.now()`).
 *
 * Skąd w ogóle próg. Wykres jedzie z SSR namalowany w stanie KOŃCOWYM, więc
 * animacja przy montowaniu musi go najpierw schować, a to znaczy, że coś już
 * narysowanego znika i rysuje się od nowa. Dopóki strona się składa, oko
 * czyta ten ruch jako część wchodzenia treści. Gdy hydracja przyjdzie późno -
 * słabe urządzenie, zapchane łącze - czytelnik zdążył już przeczytać wykres
 * i to samo przerysowanie wygląda na zwiechę renderera, a nie na animację.
 * Dlatego po tym progu wejście przy montowaniu się NIE odpala: lepszy brak
 * animacji niż animacja, która udaje błąd.
 */
const MOUNT_WINDOW_MS = 2000;

/**
 * Czy pierwsza hydracja jest już za nami. Po niej każdy nowy montaż wykresu
 * (nawigacja klientem, rozwinięta zakładka, wykres doładowany leniwie) rysuje
 * się od zera BEZ wcześniejszego malowania z serwera - czyli nie ma czego
 * chować i okno z `MOUNT_WINDOW_MS` przestaje obowiązywać.
 */
let hydrationSettled = false;
if (typeof window !== "undefined") {
  // Makrozadanie, nie mikro: mikrozadanie wykonałoby się jeszcze w trakcie
  // commitu hydracji i flaga zapaliłaby się przedwcześnie.
  window.setTimeout(() => {
    hydrationSettled = true;
  }, 0);
}

function motionReduced(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Czy element stoi w polu widzenia i ma niezerowe pudełko.
 *
 * Pomiar synchroniczny, a nie przez IntersectionObserver, i to jest celowe:
 * uzbrojenie musi zapaść PRZED pierwszym malowaniem, a obserwator oddaje
 * pierwszy odczyt dopiero po nim. Warunek na szerokość i wysokość odcina
 * element schowany (`display: none`, zwinięta zakładka) - taki nie ma czego
 * animować, a uzbrojony zostałby niewidoczny aż do pokazania.
 */
function inViewport(node: Element): boolean {
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  return rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
}

export interface RevealOptions {
  /**
   * Odegraj wejście TAKŻE dla elementu, który przy załadowaniu jest już
   * w polu widzenia - zamiast zostawić go w stanie końcowym.
   *
   * Bez tego wykres nad foldem, czyli ten najczęściej oglądany, nie ruszał
   * się nigdy: hook widział go w viewporcie i zostawiał "static". Animacja
   * rysowania linii istniała w arkuszu, ale na głównych wykresach nie miała
   * jak się odpalić.
   *
   * Uzbrojenie idzie efektem UKŁADU (przed malowaniem), więc pierwsza klatka
   * po hydracji ma już stan początkowy - nie ma przebłysku stanu końcowego
   * między hydracją a startem animacji.
   */
  onMount?: boolean;
}

/**
 * Animacja wejścia przy scrollu BEZ kosztów SSR/CLS/no-JS:
 *
 *  - SSR i pierwszy render klienta: stan "static" - element w stanie KOŃCOWYM
 *    (crawler i użytkownik bez JS widzą pełną treść, hydracja bez rozjazdu),
 *  - pierwszy callback IntersectionObservera: jeśli element JUŻ jest w
 *    viewporcie -> zostaje "static" (zero migotania nad foldem),
 *  - jeśli jest poza viewportem -> "armed" (CSS ustawia stan początkowy
 *    animacji - bezpieczne, bo element jest niewidoczny),
 *  - wejście w viewport -> "run" (CSS transition do stanu końcowego).
 *
 * Z `options.onMount` dochodzi ścieżka czwarta: element w viewporcie przy
 * montowaniu też gra wejście - uzbrojenie przed pierwszym malowaniem, start
 * po jednej klatce. Ścieżka jest ODDZIELNA od obserwatora i nie zostawia
 * elementu uzbrojonego "w oczekiwaniu": gdy warunki nie są spełnione
 * (ograniczony ruch, brak IntersectionObservera, element poza widokiem albo
 * schowany, spóźniona hydracja), po prostu nie uzbraja i wykres zostaje
 * widoczny. Niewidoczny wykres jest awarią większą niż brak animacji.
 *
 * `prefers-reduced-motion` nigdy nie uzbraja animacji (plus pas bezpieczeństwa
 * w CSS). Klasy: revealClassName(state) -> "" | "neh-armed" | "neh-armed neh-run".
 */
export function useRevealOnScroll<T extends Element>(
  enabled: boolean,
  options?: RevealOptions,
): {
  ref: React.RefObject<T | null>;
  state: RevealState;
} {
  const onMount = options?.onMount === true;
  const ref = useRef<T | null>(null);
  const [state, setState] = useState<RevealState>("static");
  /**
   * Wejście odegrane przy montowaniu - obserwator nie ma już czego uzbrajać.
   * Ref, nie stan: ustawiane w efekcie układu i czytane w efekcie zwykłym
   * tego samego commitu, więc dodatkowy render byłby czystym kosztem.
   */
  const playedOnMount = useRef(false);

  // 1. UZBROJENIE PRZED MALOWANIEM. Tylko tryb `onMount` i tylko dla elementu,
  //    który naprawdę stoi w widoku - reszta idzie ścieżką obserwatora niżej.
  useIsomorphicLayoutEffect(() => {
    if (!enabled || !onMount) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (motionReduced()) return;
    if (!hydrationSettled && performance.now() > MOUNT_WINDOW_MS) return;
    if (!inViewport(node)) return;
    playedOnMount.current = true;
    setState("armed");
  }, [enabled, onMount]);

  // 2. START PO PIERWSZEJ KLATCE. Dwie klatki, nie jedna: przejście CSS
  //    odpala się tylko wtedy, gdy przeglądarka zdążyła namalować stan
  //    początkowy. Przy jednej klatce obie wartości trafiały czasem do tego
  //    samego stylu obliczonego i linia pojawiała się skokiem.
  useEffect(() => {
    if (!playedOnMount.current || state !== "armed") return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setState("run"));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [state]);

  // 3. ŚCIEŻKA SCROLLOWA - bez zmian dla elementów poza widokiem.
  useEffect(() => {
    if (!enabled) {
      // Wyłączenie animacji w trakcie życia komponentu (autor przestawia pole
      // "Animacja wejścia" na kanwie buildera) MUSI rozbroić stan. Bez tego
      // element uzbrojony wcześniej (poza foldem, więc CSS ustawił mu stan
      // początkowy: opacity 0 / scale) zostawał niewidoczny aż do remontu -
      // czyli wyłączenie animacji kasowało treść zamiast ją pokazać.
      playedOnMount.current = false;
      setState("static");
      return;
    }
    // Wejście przy montowaniu już poszło - obserwator nie ma tu nic do roboty.
    if (playedOnMount.current) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (motionReduced()) {
      // Ten sam pas bezpieczeństwa: gdy użytkownik włączy "ogranicz ruch" po
      // uzbrojeniu, wracamy do stanu końcowego zamiast zostawić pustkę.
      setState("static");
      return;
    }
    let armed = false;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!armed) {
            if (entry.isIntersecting) {
              // Widoczny przy załadowaniu - nie chowamy niczego, co już
              // zostało namalowane.
              obs.disconnect();
              return;
            }
            armed = true;
            setState("armed");
          } else if (entry.isIntersecting) {
            setState("run");
            obs.disconnect();
            return;
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -5% 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [enabled]);

  return { ref, state };
}

/** Klasy CSS dla stanu reveal (armed zostaje razem z run - patrz styles.css). */
export function revealClassName(state: RevealState): string {
  if (state === "armed") return "neh-armed";
  if (state === "run") return "neh-armed neh-run";
  return "";
}
