// PAMIĘĆ SZEROKOŚCI PASKA BOCZNEGO PANELU.
//
// CO TO DOWODZI. `AdminShell` liczy szerokość paska z `theme_options.sidebars.style`
// (`style-4` = pasek zwinięty, 3 rem zamiast 14 rem), a `/admin` jest trasą
// `ssr: false`: pierwszy render klienta nie ma tego ustawienia i maluje pasek
// rozwinięty, po czym zwęża go o 176 px razem z całą treścią. Ten moduł jest
// jedynym miejscem, z którego pierwszy render może poznać docelowy wariant,
// więc jego kontrakt to: (1) zwrócić TYLKO znany wariant, (2) nigdy nie rzucić,
// gdy `localStorage` jest niedostępny.
//
// PUNKT (2) NIE JEST OSTROŻNOŚCIĄ NA WYROST: dostęp do `localStorage` RZUCA
// w trybie prywatnym Safari i przy zablokowanych danych witryny, a rzut
// w inicjalizatorze `useState` wywraca cały panel - czyli "optymalizacja"
// pierwszego malowania zamieniłaby się w biały ekran.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readRememberedSidebarStyle, rememberSidebarStyle } from "../sidebarStylePreference";

const KEY = "nes.admin.sidebar-style";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("readRememberedSidebarStyle", () => {
  it("bez zapisu nie zgaduje - zwraca null", () => {
    expect(readRememberedSidebarStyle()).toBeNull();
  });

  it("zwraca zapisany wariant", () => {
    rememberSidebarStyle("style-4");
    expect(readRememberedSidebarStyle()).toBe("style-4");
  });

  it.each(["style-7", "compact", "", "null", '{"style":"style-4"}'])(
    "odrzuca wartość spoza listy wariantów (%s)",
    (raw) => {
      window.localStorage.setItem(KEY, raw);
      // Nieznany wariant jest gorszy od braku: `AdminShell` przepuściłby go
      // do porównania `=== "style-4"` i dostałby szerokość z fallbacku, ale
      // reszta stylowania paska czyta ten sam atrybut `data-sidebar-style`.
      expect(readRememberedSidebarStyle()).toBeNull();
    },
  );

  it("niedostępny storage NIE rzuca - pierwszy render panelu nie może paść", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage zablokowany");
    });
    expect(() => readRememberedSidebarStyle()).not.toThrow();
    expect(readRememberedSidebarStyle()).toBeNull();
  });
});

describe("rememberSidebarStyle", () => {
  it("nadpisuje poprzedni zapis", () => {
    rememberSidebarStyle("style-4");
    rememberSidebarStyle("style-1");
    expect(readRememberedSidebarStyle()).toBe("style-1");
  });

  it("niedostępny storage NIE rzuca - to preferencja widoku, nie dane", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage zablokowany");
    });
    expect(() => rememberSidebarStyle("style-4")).not.toThrow();
  });
});
