// PREZENCJA POWIERZCHNI DOKU: wejście, obecność, wyjście.
//
// ── PO CO TO ISTNIEJE ────────────────────────────────────────────────────
// React zdejmuje węzeł z drzewa w tej samej klatce, w której warunek
// renderowania przestaje być prawdziwy. Panel doku po prostu ZNIKAŁ - nie
// dlatego, że tak zaprojektowano wyjście, tylko dlatego, że nikt go nie
// zatrzymał. Wejście też nie istniało: panel pojawiał się w stanie końcowym
// w chwili, gdy rozstrzygnął się jego leniwy import.
//
// Ten hak daje obu stronom kształt, bez biblioteki animacji:
//   `entering` - węzeł jest już w drzewie, ale w stanie POCZĄTKOWYM
//                (przesunięty, przezroczysty). Jedna klatka.
//   `entered`  - stan końcowy z włączonym przejściem CSS. Ruch odgrywa
//                przeglądarka, na `transform` i `opacity`, bez JS na klatkę.
//   `exiting`  - warunek już nie obowiązuje, ale węzeł ZOSTAJE tyle
//                milisekund, ile trwa przejście wyjścia. Potem znika.
//
// ── DLACZEGO DWIE KLATKI NA WEJŚCIE, A NIE JEDNA ─────────────────────────
// Przejście CSS odgrywa się tylko wtedy, gdy przeglądarka WIDZIAŁA stan
// początkowy. Zmiana klasy w tym samym cyklu, w którym węzeł wchodzi do
// drzewa, jest dla silnika stylu jedną wartością - ruchu nie ma. Dlatego
// stan `entered` ustawiamy w `requestAnimationFrame`, po pierwszym malowaniu
// stanu `entering`. Ten sam wniosek zapisano w `ChatSideDrawer`
// (`requestAnimationFrame(() => setEntered(true))`) - tutaj jest wyciągnięty
// z komponentu, bo dotyczy czterech paneli i skrzynki, nie jednego miejsca.
//
// ── OGRANICZONY RUCH ─────────────────────────────────────────────────────
// Hak NIE pyta o `prefers-reduced-motion` i to jest decyzja, nie brak.
// Wyciszenie robi CSS (blok `@media (prefers-reduced-motion: reduce)`
// w `styles.css`): stany zostają te same, tylko bez przejść. Gdyby o
// preferencję pytał JS, ten sam warunek żyłby w dwóch miejscach, a stan
// `exiting` musiałby mieć drugą, zerową ścieżkę czasu - czyli więcej kodu
// na to samo zachowanie.
import { useEffect, useRef, useState } from "react";
import { dockExitMs, type DockPresenceState } from "./dockMotion";

export interface DockPresence {
  /** Czy węzeł ma być w drzewie (obejmuje fazę wyjścia). */
  mounted: boolean;
  /** Faza do wystawienia jako `data-state` na animowanym węźle. */
  state: DockPresenceState;
}

/**
 * @param open  czy powierzchnia ma być widoczna
 * @param surface która powierzchnia (decyduje o czasie wyjścia)
 */
export function useDockPresence(open: boolean, surface: "panel" | "drawer"): DockPresence {
  const [mounted, setMounted] = useState(open);
  // Stan POCZĄTKOWY dla otwartej powierzchni to `entering`, nie `entered` -
  // i to jest jedna reguła, nie wyjątek: OTWARCIE ZAWSZE MA RUCH, także gdy
  // powierzchnia jest otwarta już w pierwszym renderze. Ten przypadek jest
  // realny: kliknięcie „Napisz" gdziekolwiek w serwisie wysyła żądanie
  // magistralą, a dok montuje skrzynkę od razu otwartą - i wtedy tym bardziej
  // ma się wysunąć, bo użytkownik właśnie o to poprosił. Deklarowanie tu
  // `entered` byłoby zresztą martwym kodem, bo efekt niżej i tak przestawia
  // stan na `entering` w tym samym cyklu.
  const [state, setState] = useState<DockPresenceState>(open ? "entering" : "exiting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    if (open) {
      setMounted(true);
      setState("entering");
      // Druga klatka: dopiero teraz przeglądarka ma z czego animować.
      const frame = requestAnimationFrame(() => setState("entered"));
      return () => cancelAnimationFrame(frame);
    }

    // Zamknięcie: węzeł zostaje na czas przejścia wyjścia. Jeśli nigdy nie
    // był zamontowany, nie ma czego wygaszać - `mounted` już jest `false`.
    setState("exiting");
    timer.current = setTimeout(() => {
      timer.current = null;
      setMounted(false);
    }, dockExitMs(surface));

    return () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      timer.current = null;
    };
  }, [open, surface]);

  return { mounted, state };
}
