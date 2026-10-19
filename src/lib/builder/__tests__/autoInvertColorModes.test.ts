// Kolor widgetu w trybie, dla którego redakcja go NIE ustawiła.
//
// `resolveColorForMode` stoi na granicy wyświetlania: ramka widgetu
// (`frame.ts` -> `styleToCSS`), karta w `WidgetView` i `ChromeWidgetView`
// wstawiają jego wynik wprost do `style`. Kontrakt (reguła z AGENTS.md o
// akcentach dark): jawna wartość dla trybu zawsze wygrywa, a dopiero bez niej
// działa dotychczasowe odwrócenie koloru drugiego trybu. Heurystyka
// `autoInvertColor` ma przy tym odwracać WYŁĄCZNIE kolory, które na danym tle
// byłyby nieczytelne, i nie psuć zapisów, których nie umie policzyć.
//
// Dowodem są konkretne łańcuchy CSS, które trafiają do `style`. Moduł jest
// czysty (bez I/O), więc nie ma granic do mockowania.
import { describe, expect, it } from "vitest";
import { autoInvertColor, resolveColorForMode } from "../autoInvertColor";

describe("autoInvertColor - heurystyka trybu", () => {
  it("ciemny kolor w dark mode odwraca się na jasny (czarny tekst na ciemnym tle)", () => {
    expect(autoInvertColor("#000", "dark")).toBe("rgb(255, 255, 255)");
    expect(autoInvertColor("#1a1a1a", "dark")).toBe("rgb(229, 229, 229)");
    expect(autoInvertColor("black", "dark")).toBe("rgb(255, 255, 255)");
    expect(autoInvertColor("rgb(10, 20, 30)", "dark")).toBe("rgb(245, 235, 225)");
  });

  it("jasny kolor w light mode odwraca się na ciemny (biel na białym tle)", () => {
    expect(autoInvertColor("#ffffff", "light")).toBe("rgb(0, 0, 0)");
    expect(autoInvertColor("WHITE", "light")).toBe("rgb(0, 0, 0)");
    expect(autoInvertColor("  #EEE  ", "light")).toBe("rgb(17, 17, 17)");
  });

  it("kolor już czytelny na tle trybu wraca jako TEN SAM zapis", () => {
    // Zwrot oryginału, a nie przeformatowanego `rgb()`, trzyma tokeny i zapis
    // redakcji w DOM-ie bez zmian (SSR i hydratacja widzą ten sam łańcuch).
    expect(autoInvertColor("#ffffff", "dark")).toBe("#ffffff");
    expect(autoInvertColor("#111", "light")).toBe("#111");
  });

  it("ton średni (szarość, akcent) przechodzi bez zmian w OBU trybach", () => {
    for (const mid of ["#808080", "#4a90e2"]) {
      expect(autoInvertColor(mid, "dark")).toBe(mid);
      expect(autoInvertColor(mid, "light")).toBe(mid);
    }
  });

  it("alfa przeżywa odwrócenie - półprzezroczysta nakładka zostaje półprzezroczysta", () => {
    expect(autoInvertColor("rgba(0, 0, 0, 0.4)", "dark")).toBe("rgba(255, 255, 255, 0.4)");
    expect(autoInvertColor("#0000", "dark")).toBe("rgba(255, 255, 255, 0)");
  });

  it("zapis niepoliczalny lokalnie wraca bez zmian (bez zgadywania)", () => {
    for (const raw of [
      "",
      "var(--brand)",
      "transparent",
      "currentColor",
      "inherit",
      "oklch(0.2 0 0)",
      "#12345",
      "#ggg",
      "rgb(1, 2)",
    ]) {
      expect(autoInvertColor(raw, "dark")).toBe(raw);
      expect(autoInvertColor(raw, "light")).toBe(raw);
    }
  });

  // NAPRAWIONE 2026-10-18 (defekt znaleziony przy pisaniu testów):
  // WEJSCIE: `rgb(0 0 0 / 50%)` - zapis, który przepuszcza `safeWidgetColor`
  //   i który redakcja wpisuje w pole koloru (składnia CSS Color 4).
  // BYŁO: alfa „50%" czytana przez `parseFloat` dawała 50, czyli „nieprzezroczysty",
  //   więc w dark mode półprzezroczysta czarna nakładka stawała się PEŁNĄ
  //   bielą `rgb(255, 255, 255)` i zakrywała treść pod spodem.
  // KONTRAKT: alfa i kanały w procentach są skalowane jak w CSS.
  it("alfa w procentach zostaje alfą, a nie nieprzezroczystą bielą", () => {
    expect(autoInvertColor("rgb(0 0 0 / 50%)", "dark")).toBe("rgba(255, 255, 255, 0.5)");
    expect(autoInvertColor("rgba(0, 0, 0, 25%)", "dark")).toBe("rgba(255, 255, 255, 0.25)");
  });

  // NAPRAWIONE 2026-10-18: `rgb(100% 100% 100%)` dawało kanały 100/100/100
  // (szarość o jasności 0,39), więc biały tekst w light mode NIE był
  // odwracany - biel na bieli.
  it("kanały w procentach liczą się jak w CSS (100% = 255)", () => {
    expect(autoInvertColor("rgb(100% 100% 100%)", "light")).toBe("rgb(0, 0, 0)");
    expect(autoInvertColor("rgb(0%, 0%, 0%)", "dark")).toBe("rgb(255, 255, 255)");
  });

  // NAPRAWIONE 2026-10-18: `hsl()` (dopuszczany przez `safeWidgetColor`) nie
  // był w ogóle parsowany, więc czarny tekst zapisany jako `hsl(0 0% 0%)`
  // zostawał czarny na ciemnym tle. Parser jest teraz wspólny z luminancją
  // podświetlenia ikon social (`parseColorChannels` w `cssColor.ts`).
  it("hsl() podlega tej samej heurystyce co hex i rgb()", () => {
    expect(autoInvertColor("hsl(0 0% 0%)", "dark")).toBe("rgb(255, 255, 255)");
    expect(autoInvertColor("hsla(0, 0%, 100%, 0.5)", "light")).toBe("rgba(0, 0, 0, 0.5)");
    expect(autoInvertColor("hsl(0 0% 50%)", "dark")).toBe("hsl(0 0% 50%)");
  });

  // NAPRAWIONE 2026-10-18: nazwa koloru szukana w zwykłym obiekcie szła po
  // łańcuchu prototypów - „constructor" zwracał funkcję `Object`, a jej
  // destrukturyzacja rzucała TypeError w trakcie renderu ramki widgetu.
  it("nazwa z prototypu Object nie wywraca renderu - wraca bez zmian", () => {
    expect(autoInvertColor("constructor", "dark")).toBe("constructor");
    expect(autoInvertColor("toString", "light")).toBe("toString");
  });
});

describe("resolveColorForMode - jawny tryb wygrywa, odwrócenie jest fallbackiem", () => {
  it("brak wartości to brak koloru w obu trybach (dziedziczenie z motywu)", () => {
    expect(resolveColorForMode(undefined, "light")).toBeUndefined();
    expect(resolveColorForMode(undefined, "dark")).toBeUndefined();
  });

  it("wartość płaska jest zapisem light: light dostaje ją dosłownie, dark - odwróconą", () => {
    expect(resolveColorForMode("#111111", "light")).toBe("#111111");
    expect(resolveColorForMode("#111111", "dark")).toBe("rgb(238, 238, 238)");
    // Płaski token przechodzi bez zmian także w dark.
    expect(resolveColorForMode("var(--brand)", "dark")).toBe("var(--brand)");
  });

  it("jawne nadpisanie trybu wygrywa i NIE jest odwracane", () => {
    // Ciemny kolor jawnie wybrany dla dark to decyzja redakcji, nie pomyłka.
    const v = { light: "#ffffff", dark: "#222222" };
    expect(resolveColorForMode(v, "dark")).toBe("#222222");
    expect(resolveColorForMode(v, "light")).toBe("#ffffff");
  });

  it("bez nadpisania trybu bierze kolor drugiego trybu przez odwrócenie", () => {
    expect(resolveColorForMode({ light: "#111111" }, "dark")).toBe("rgb(238, 238, 238)");
    expect(resolveColorForMode({ dark: "#eeeeee" }, "light")).toBe("rgb(17, 17, 17)");
    // Ton średni z drugiego trybu przechodzi dosłownie.
    expect(resolveColorForMode({ light: "#808080" }, "dark")).toBe("#808080");
  });

  it("obiekt trybów bez żadnej wartości to brak koloru, nie łańcuch „undefined”", () => {
    expect(resolveColorForMode({ light: undefined }, "dark")).toBeUndefined();
    expect(resolveColorForMode({ dark: undefined }, "light")).toBeUndefined();
  });
});
