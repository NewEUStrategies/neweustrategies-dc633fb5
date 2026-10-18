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
// Moduł jest czysty (bez I/O), więc nie ma czego mockować. Ostatni opis
// rejestruje defekt styku z `resolveColorForMode` (ramka widgetu).
import { describe, expect, it } from "vitest";
import { isModeOverridden, isThemedValue, pickMode, resetMode, setMode } from "../themed";
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

describe("setMode + resolveColorForMode - styk panelu z ramką widgetu", () => {
  /** Jasność koloru wyrenderowanego w dark (0 = czerń, 1 = biel). */
  const darkLightness = (v: Color): number => {
    const rgba = parseColorChannels(resolveColorForMode(v, "dark") ?? "");
    if (!rgba) throw new Error("kolor dark niepoliczalny");
    return (0.299 * rgba.r + 0.587 * rgba.g + 0.114 * rgba.b) / 255;
  };

  it("płaski ciemny kolor tekstu jest w dark odwracany na jasny", () => {
    expect(darkLightness("#111111")).toBeGreaterThan(0.5);
  });

  // DEFEKT (zarejestrowany 2026-10-18 przy pisaniu testów, poza zakresem pakietu).
  // WEJSCIE: widget ma płaski kolor tekstu `#111111` (pierwszy zapis w light jest
  //   płaski). Ramka (`frame.ts` -> `resolveColorForMode`) traktuje wartość płaską
  //   jako zapis light i w dark ODWRACA ją na `rgb(238, 238, 238)` - czytelnie.
  //   Redakcja, wciąż w light, zmienia kolor na `#222222`.
  // CO PSUJE: `setMode` migruje płaską wartość do `{ dark: "#111111", light:
  //   "#222222" }`, zakładając, że dark „miał" `#111111` (semantyka `pickMode`).
  //   Ramka widzi teraz JAWNE dark i go nie odwraca: dark mode pokazuje ciemny
  //   tekst na ciemnym tle, choć nikt dark nie edytował.
  // WYMAGANA POPRAWKA: decyzja produktowa, co znaczy wartość płaska koloru -
  //   „light + odwrócenie w dark" (ramka widgetu) czy „ta sama w obu trybach"
  //   (`pickMode`, panel, `BuilderRenderer` kolumn). Po niej `setMode` dla zapisu
  //   strony autorskiej (light) powinno zostawić wartość płaską albo stemplować
  //   dark wartością, którą ramka faktycznie rysowała. Zmiana dotyka paneli
  //   widgetu i kolumny oraz renderera kolumn - poza tym pakietem.
  it.fails("DEFEKT: edycja light nie może zgasić odwrócenia w dark", () => {
    const next = setMode<string>("#111111", "light", "#222222");
    expect(darkLightness(next)).toBeGreaterThan(0.5);
  });
});
