// Arbitraż ZAGNIEŻDŻONYCH kanw bloków (edytor bloków w modalu buildera nad
// edytorem wpisu). Zdarzenia globalne - schowek i klawiatura zaznaczenia -
// obsługuje wyłącznie kanwa, w której leży target; a gdy target jest poza
// jakąkolwiek kanwą (fokus na `<body>`), wygrywa kanwa zamontowana NAJPÓŹNIEJ.
// Bez tego jedno Ctrl+V wklejałoby dwa razy, a Shift+strzałka ruszałaby
// zaznaczenie w obu kanwach naraz.
//
// Rejestr trzyma REFERENCJE, nie elementy: kanwa podmienia węzeł DOM przy
// przejściu pusty dokument <-> lista bloków, a `ref.current` zawsze wskazuje
// żywy element (porównywanie zapamiętanych elementów blokowało zdarzenia po
// takiej podmianie).

import { useEffect } from "react";

export type CanvasRef = React.RefObject<HTMLDivElement | null>;

const MOUNTED_CANVAS_REFS: CanvasRef[] = [];

/** Rejestruje kanwę na czas życia komponentu (kolejność = kolejność montowania). */
export function useCanvasStack(ref: CanvasRef): void {
  useEffect(() => {
    MOUNTED_CANVAS_REFS.push(ref);
    return () => {
      const i = MOUNTED_CANVAS_REFS.indexOf(ref);
      if (i >= 0) MOUNTED_CANVAS_REFS.splice(i, 1);
    };
  }, [ref]);
}

/** Czy `ref` wskazuje kanwę wierzchnią (ostatnio zamontowaną)? */
function isTopmostCanvas(ref: CanvasRef): boolean {
  const top = MOUNTED_CANVAS_REFS[MOUNTED_CANVAS_REFS.length - 1];
  return Boolean(top && ref.current !== null && top.current === ref.current);
}

/**
 * Czy kanwa `ref` ma obsłużyć zdarzenie o tym targecie? Target wewnątrz
 * jakiejś kanwy należy do TEJ kanwy; target poza kanwami - do wierzchniej.
 */
export function canvasOwnsEvent(ref: CanvasRef, target: EventTarget | null): boolean {
  const root = ref.current;
  if (!root) return false;
  const el = target as HTMLElement | null;
  const inSomeCanvas = el?.closest?.("[data-block-canvas]") ?? null;
  if (inSomeCanvas) return inSomeCanvas === root;
  return isTopmostCanvas(ref);
}
