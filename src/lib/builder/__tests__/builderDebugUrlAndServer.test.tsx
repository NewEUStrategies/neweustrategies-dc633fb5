// Flaga nakładki debug buildera: parametr adresu i HTML z serwera.
//
// Co ten plik udowadnia (uzupełnienie `builderDebug.test.ts`):
//  1. `?debug=1` / `?debug=0` w adresie WYGRYWA z zapamiętanym przełącznikiem -
//     link z `?debug=0` musi wyłączyć nakładkę u kogoś, kto ją kiedyś włączył,
//     a inna wartość parametru nie jest poleceniem i zostawia zapamiętany stan.
//  2. Zablokowany `localStorage` (tryb prywatny, polityka przeglądarki) nie
//     wysadza renderera: odczyt daje „wyłączone", a przełącznik nadal działa
//     w pamięci i powiadamia instancje.
//  3. HTML z serwera nigdy nie ma włączonej nakładki ani właściciela - nawet
//     gdy przełącznik w przeglądarce jest zapamiętany jako włączony - więc
//     hydratacja nie dostaje innego drzewa niż serwer.
// Granica: `window.location` zmieniamy przez `history.replaceState` (ta sama
// domena), `localStorage` - przez szpiegów; adres i magazyn wracają po teście.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  __resetBuilderDebugForTests,
  readInitialDebug,
  toggleBuilderDebug,
  useBuilderDebug,
} from "../builderDebug";

const initialUrl = window.location.href;

beforeEach(() => {
  __resetBuilderDebugForTests();
  window.localStorage.removeItem("builder-debug");
});

afterEach(() => {
  window.history.replaceState(null, "", initialUrl);
  window.localStorage.removeItem("builder-debug");
  __resetBuilderDebugForTests();
  vi.restoreAllMocks();
});

const visit = (search: string) => window.history.replaceState(null, "", `/strona${search}`);

describe("readInitialDebug - adres i zapamiętany przełącznik", () => {
  it.each([
    ["?debug=0 wyłącza mimo zapamiętanego włączenia", "?debug=0", "1", false],
    ["?debug=1 włącza mimo zapamiętanego wyłączenia", "?debug=1", "0", true],
    ["inna wartość parametru zostawia zapamiętane włączenie", "?debug=tak", "1", true],
    ["brak parametru i brak zapisu to wyłączone", "", null, false],
  ])("%s", (_, search, stored, expected) => {
    visit(search);
    if (stored !== null) window.localStorage.setItem("builder-debug", stored);
    expect(readInitialDebug()).toBe(expected);
  });

  it("zablokowany magazyn przeglądarki daje wyłączoną nakładkę zamiast wyjątku", () => {
    visit("");
    window.localStorage.setItem("builder-debug", "1");
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("zablokowane", "SecurityError");
    });
    try {
      expect(readInitialDebug()).toBe(false);
      expect(getItem).toHaveBeenCalledWith("builder-debug");
    } finally {
      // Szpieg na obiekcie `localStorage` happy-dom trzeba zdjąć jawnie -
      // inaczej przeżywa `restoreAllMocks` i psuje kolejne testy.
      getItem.mockRestore();
    }
  });
});

describe("toggleBuilderDebug bez dostępu do magazynu", () => {
  it("przełącza flagę w pamięci i powiadamia instancje mimo błędu zapisu", () => {
    visit("");
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("pełny", "QuotaExceededError");
    });
    try {
      const { result } = renderHook(() => useBuilderDebug());
      expect(result.current.debug).toBe(false);
      act(() => toggleBuilderDebug());
      expect(setItem).toHaveBeenCalledWith("builder-debug", "1");
      expect(result.current.debug).toBe(true);
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("useBuilderDebug - HTML z serwera", () => {
  it("serwer renderuje nakładkę wyłączoną i bez właściciela mimo zapamiętanego włączenia", () => {
    window.localStorage.setItem("builder-debug", "1");
    function Probe() {
      const { debug, isPrimary } = useBuilderDebug();
      return <div data-debug={String(debug)} data-primary={String(isPrimary)} />;
    }
    const html = renderToString(<Probe />);
    expect(html).toContain('data-debug="false"');
    expect(html).toContain('data-primary="false"');
  });
});
