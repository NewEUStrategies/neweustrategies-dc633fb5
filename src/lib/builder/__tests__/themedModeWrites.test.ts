// Zapis i odczyt wartości light/dark (`themed.ts`) tak, jak robią to panele
// właściwości widgetu i kolumny (`WidgetProperties`, `ColumnProperties`).
//
// Dowodzimy kontraktu, który redakcja widzi w panelu:
//  * zapis w jednym trybie NIE zmienia wartości drugiego trybu;
//  * pierwsza wartość zapisana w light jest płaska (oba tryby razem), dopóki
//    redakcja jawnie nie nadpisze dark;
//  * reset trybu wraca do wartości globalnej TYLKO w tym trybie;
//  * wskaźnik „nadpisane" i odczyt pola zgadzają się z zapisem;
//  * zapis wartości identycznej z obecną nie tworzy nowego obiektu (brak
//    zbędnej zmiany dokumentu, a więc i wpisu w historii cofania).
//
// Moduł jest czysty (bez I/O), więc nie ma czego mockować. Ostatnie opisy
// dotyczą styku z `resolveColorForMode` (ramka widgetu): kolory ramki zapisuje
// rodzina `*Invertible*`, w której wartość płaska = jasny + odwrócenie w dark.
import { describe, expect, it } from "vitest";
import {
  isInvertibleModeOverridden,
  isModeOverridden,
  isThemedValue,
  pickInvertibleOverride,
  pickMode,
  resetInvertibleMode,
  resetMode,
  setInvertibleMode,
  setMode,
} from "../themed";
import { resolveColorForMode } from "../autoInvertColor";
import { parseColorChannels } from "../cssColor";
import type { Themed } from "../types";

type Color = Themed<string> | undefined;

describe("setMode - zapis jednego trybu", () => {
  it("pierwszy zapis w light jest płaski, pierwszy zapis w dark dotyczy tylko dark", () => {
    expect(setMode<string>(undefined, "light", "#111")).toBe("#111");
    expect(setMode<string>(undefined, "dark", "#eee")).toEqual({ dark: "#eee" });
    expect(setMode<string>(undefined, "dark", undefined)).toBeUndefined();
  });

  it("nadpisanie dark na wartości płaskiej zachowuje light bez zmian", () => {
    const next = setMode<string>("#111", "dark", "#eee");
    expect(next).toEqual({ light: "#111", dark: "#eee" });
    expect(pickMode(next, "light")).toBe("#111");
    expect(pickMode(next, "dark")).toBe("#eee");
  });

  it("wyczyszczenie trybu na wartości płaskiej zostawia ją drugiemu trybowi", () => {
    expect(setMode<string>("#111", "dark", undefined)).toEqual({ light: "#111" });
    expect(setMode<string>("#111", "light", undefined)).toEqual({ dark: "#111" });
  });

  it("ta sama wartość nie tworzy nowego zapisu (ta sama referencja)", () => {
    const flat = "#111";
    expect(setMode<string>(flat, "dark", "#111")).toBe(flat);
  });

  it("edycja light na wartości płaskiej zostawia dark jego dotychczasową wartość", () => {
    // Semantyka rendererów BEZ odwracania (kolumna, hover): płaska obowiązywała
    // w obu trybach, więc dark musi dalej wyglądać tak samo.
    const next = setMode<string>("#111", "light", "#222");
    expect(pickMode(next, "light")).toBe("#222");
    expect(pickMode(next, "dark")).toBe("#111");
  });

  it("na wartości per tryb zmienia tylko aktywny tryb, a pusty wynik znika", () => {
    const prev = { light: "#111", dark: "#eee" };
    expect(setMode<string>(prev, "dark", "#ddd")).toEqual({ light: "#111", dark: "#ddd" });
    expect(prev).toEqual({ light: "#111", dark: "#eee" });
    expect(setMode<string>({ dark: "#eee" }, "dark", undefined)).toBeUndefined();
  });
});

describe("resetMode i isModeOverridden - powrót do wartości globalnej", () => {
  it("reset dark na wartości per tryb usuwa tylko dark", () => {
    expect(resetMode<string>({ light: "#111", dark: "#eee" }, "dark")).toEqual({ light: "#111" });
    expect(resetMode<string>({ dark: "#eee" }, "dark")).toBeUndefined();
    expect(resetMode<string>(undefined, "light")).toBeUndefined();
  });

  it("reset jednego trybu na wartości płaskiej przenosi ją do drugiego trybu", () => {
    const next = resetMode<string>("#111", "dark");
    expect(next).toEqual({ light: "#111" });
    expect(isModeOverridden(next, "dark")).toBe(false);
    expect(isModeOverridden(next, "light")).toBe(true);
  });

  it("wskaźnik „nadpisane” odpowiada temu, co zapisano w danym trybie", () => {
    expect(isModeOverridden<string>(undefined, "light")).toBe(false);
    expect(isModeOverridden<string>("#111", "light")).toBe(true);
    expect(isModeOverridden<string>("#111", "dark")).toBe(true);
    expect(isModeOverridden<string>({ dark: "#eee" }, "light")).toBe(false);
    expect(isModeOverridden<string>({ dark: "#eee" }, "dark")).toBe(true);
  });

  it("cykl panelu: kolor light, nadpisanie dark, reset dark wraca do koloru light", () => {
    let v: Color = setMode<string>(undefined, "light", "#123456");
    v = setMode<string>(v, "dark", "#abcdef");
    expect([pickMode(v, "light"), pickMode(v, "dark")]).toEqual(["#123456", "#abcdef"]);
    v = resetMode<string>(v, "dark");
    expect([pickMode(v, "light"), pickMode(v, "dark")]).toEqual(["#123456", "#123456"]);
    expect(isModeOverridden(v, "dark")).toBe(false);
  });
});

describe("pickMode i isThemedValue - odczyt", () => {
  it("brak wartości w trybie bierze wartość drugiego trybu", () => {
    expect(pickMode({ light: "#111" }, "dark")).toBe("#111");
    expect(pickMode({ dark: "#eee" }, "light")).toBe("#eee");
    expect(pickMode<string>(undefined, "dark")).toBeUndefined();
  });

  it("tylko obiekt z kluczem light/dark jest wartością per tryb", () => {
    expect(isThemedValue({ light: "#111" })).toBe(true);
    expect(isThemedValue({ dark: undefined })).toBe(true);
    // Wartość responsywna, tablica i typografia to dane, nie tryby.
    expect(isThemedValue({ desktop: "16px", mobile: "14px" })).toBe(false);
    expect(isThemedValue(["#111"])).toBe(false);
    expect(isThemedValue(null)).toBe(false);
    expect(isThemedValue("#111")).toBe(false);
  });
});

describe("setInvertibleMode - kolory ramki: płaska = light + odwrócenie w dark", () => {
  it("pierwszy zapis w light jest płaski, pierwszy zapis w dark dotyczy tylko dark", () => {
    expect(setInvertibleMode<string>(undefined, "light", "#111")).toBe("#111");
    expect(setInvertibleMode<string>(undefined, "dark", "#eee")).toEqual({ dark: "#eee" });
    expect(setInvertibleMode<string>(undefined, "dark", undefined)).toBeUndefined();
  });

  it("edycja light na płaskiej zostaje płaska, na `{ light, dark }` nie rusza dark", () => {
    expect(setInvertibleMode<string>("#111", "light", "#222")).toBe("#222");
    expect(setInvertibleMode<string>({ light: "#111", dark: "#eee" }, "light", "#222")).toEqual({
      light: "#222",
      dark: "#eee",
    });
  });

  it("edycja dark na płaskiej zachowuje light", () => {
    expect(setInvertibleMode<string>("#111", "dark", "#333")).toEqual({
      light: "#111",
      dark: "#333",
    });
  });

  it("wyczyszczenie i reset dark wracają do wartości płaskiej", () => {
    const themed = { light: "#111", dark: "#333" };
    expect(setInvertibleMode<string>(themed, "dark", undefined)).toBe("#111");
    expect(resetInvertibleMode<string>(themed, "dark")).toBe("#111");
    expect(resetInvertibleMode<string>({ dark: "#333" }, "dark")).toBeUndefined();
  });

  it("reset light na płaskiej usuwa ją całą - dark był z niej tylko wyliczany", () => {
    expect(resetInvertibleMode<string>("#111", "light")).toBeUndefined();
    expect(resetInvertibleMode<string>({ light: "#111", dark: "#333" }, "light")).toEqual({
      dark: "#333",
    });
  });

  it("brak zmiany zwraca tę samą referencję", () => {
    const flat = "#111";
    expect(setInvertibleMode<string>(flat, "light", "#111")).toBe(flat);
    // Dark płaskiej nie był jawny - czyszczenie go nic nie zmienia.
    expect(resetInvertibleMode<string>(flat, "dark")).toBe(flat);
    expect(setInvertibleMode<string>(flat, "dark", undefined)).toBe(flat);
  });

  it("ten sam kolor jawnie w dark to prawdziwe nadpisanie (wyłącza odwrócenie)", () => {
    expect(setInvertibleMode<string>("#111", "dark", "#111")).toEqual({
      light: "#111",
      dark: "#111",
    });
  });

  it("wartość jawna i wskaźnik „nadpisane”: płaska należy tylko do light", () => {
    expect(pickInvertibleOverride<string>("#111", "light")).toBe("#111");
    expect(pickInvertibleOverride<string>("#111", "dark")).toBeUndefined();
    expect(pickInvertibleOverride<string>({ dark: "#333" }, "light")).toBeUndefined();
    expect(pickInvertibleOverride<string>(undefined, "light")).toBeUndefined();
    expect(isInvertibleModeOverridden<string>("#111", "light")).toBe(true);
    expect(isInvertibleModeOverridden<string>("#111", "dark")).toBe(false);
    expect(isInvertibleModeOverridden<string>({ light: "#111", dark: "#333" }, "dark")).toBe(true);
    expect(isInvertibleModeOverridden<string>(undefined, "dark")).toBe(false);
  });
});

describe("setInvertibleMode + resolveColorForMode - styk panelu z ramką widgetu", () => {
  /** Jasność koloru wyrenderowanego w dark (0 = czerń, 1 = biel). */
  const darkLightness = (v: Color): number => {
    const rgba = parseColorChannels(resolveColorForMode(v, "dark") ?? "");
    if (!rgba) throw new Error("kolor dark niepoliczalny");
    return (0.299 * rgba.r + 0.587 * rgba.g + 0.114 * rgba.b) / 255;
  };

  it("płaski ciemny kolor tekstu jest w dark odwracany na jasny", () => {
    expect(darkLightness("#111111")).toBeGreaterThan(0.5);
  });

  // NAPRAWIONE 2026-10-19 (był `it.fails`, zarejestrowany 2026-10-18): płaski
  // kolor `#111111` ramka rysuje w dark odwrócony, a edycja light na `#222222`
  // przez `setMode` stemplowała `{ dark: "#111111", light: "#222222" }` - ramka
  // widziała jawne dark i przestawała odwracać (ciemny tekst na ciemnym tle).
  // Decyzja produktowa: płaska = light + odwrócenie w dark. Panel widgetu
  // zapisuje kolory ramki przez `setInvertibleMode`, które zostawia wartość
  // płaską. Ogólne `setMode` NIE zmieniło semantyki: kolumna (`columnColor`)
  // i hover (`hoverCss`) czytają płaską bez odwracania, więc dla nich
  // stemplowanie dark zachowuje wygląd ciemnego trybu (test wyżej).
  it("edycja light nie gasi odwrócenia w dark", () => {
    const next = setInvertibleMode<string>("#111111", "light", "#222222");
    expect(darkLightness(next)).toBeGreaterThan(0.5);
  });

  it("płaska i `{ light }` bez dark rysują się w obu trybach identycznie", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(resolveColorForMode({ light: "#222222" }, mode)).toBe(
        resolveColorForMode("#222222", mode),
      );
    }
  });

  it("cykl panelu: dark jawny wyłącza odwrócenie, jego wyczyszczenie je przywraca", () => {
    let v: Color = setInvertibleMode<string>("#111111", "light", "#222222");
    v = setInvertibleMode<string>(v, "dark", "#333333");
    expect(resolveColorForMode(v, "dark")).toBe("#333333");
    expect(resolveColorForMode(v, "light")).toBe("#222222");
    v = setInvertibleMode<string>(v, "dark", undefined);
    expect(darkLightness(v)).toBeGreaterThan(0.5);
    expect(resolveColorForMode(v, "light")).toBe("#222222");
  });
});
