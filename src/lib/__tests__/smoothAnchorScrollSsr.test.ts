// @vitest-environment node
//
// Strażniki SSR w `smoothAnchorScroll` - pięć wejść, które MUSZĄ być no-opem
// bez przeglądarki.
//
// PO CO OSOBNY PLIK ZE ŚRODOWISKIEM `node`. Każda funkcja w tym module zaczyna
// się od `typeof window === "undefined"` (albo `document`). W happy-dom te
// gałęzie są NIEOSIĄGALNE - okno istnieje zawsze - więc w pliku obok stały jako
// jedyne niepokryte gałęzie i wyglądały na dług, którym nie są. Środowisko
// `node` jest dokładnie tym, dla którego je napisano.
//
// CO SIĘ STANIE BEZ NICH: moduł jest importowany przez komponenty treści, więc
// wchodzi do grafu SSR. `document.getElementById` na serwerze rzuca
// ReferenceError w RENDERZE - czyli 500 na stronie artykułu, nie zdegradowane
// przewijanie.
//
// CZEGO NIE DUBLUJE. Zachowania w przeglądarce - to plik
// `smoothAnchorScrollAnimation.test.ts` i `smoothAnchorScroll.test.ts`.
import { describe, expect, it } from "vitest";

import {
  getAnchorScrollOffset,
  replaceHashPreservingRouterState,
  smoothScrollToAnchor,
} from "../smoothAnchorScroll";

describe("bez przeglądarki", () => {
  it("kanarek środowiska: brak `window` i `document`", () => {
    // Bez tego cały plik mógłby przejść w happy-dom, nie dowodząc niczego.
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("`getAnchorScrollOffset` zwraca offset domyślny", () => {
    expect(getAnchorScrollOffset()).toBe(80);
    expect(getAnchorScrollOffset(120)).toBe(120);
  });

  it("`replaceHashPreservingRouterState` nie rzuca", () => {
    expect(() => replaceHashPreservingRouterState("sekcja")).not.toThrow();
  });

  it("`smoothScrollToAnchor` nie rzuca i nie woła onFinish", () => {
    // `onFinish` na serwerze oznaczałoby „przewinięto", czego nie da się
    // dotrzymać - wołający mógłby na tej podstawie odsłonić treść.
    let finished = false;
    expect(() =>
      smoothScrollToAnchor("sekcja", {
        onFinish: () => {
          finished = true;
        },
      }),
    ).not.toThrow();
    expect(finished).toBe(false);
  });
});
