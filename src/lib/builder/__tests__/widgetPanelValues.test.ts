// Warstwa dostępu do wartości pól panelu właściwości widgetu - wyprowadzona
// z `WidgetProperties.tsx` (1 800 linii), gdzie te reguły siedziały jako
// domknięcia wewnątrz komponentu i dały się przetestować wyłącznie przez render
// całego panelu. Audyt 2026-08-18 wskazał dokładnie ten zabieg jako drogę do
// pokrycia `components/admin/builder/**` (13,6% linii, 166 z 2 077 funkcji).
//
// Testy są wyczerpujące CELOWO: to jedyne miejsce, w którym „auto" znaczy brak
// wartości, „100%" znaczy pełną szerokość (a nie procent), a wpis nieliczbowy
// musi zostać ZIGNOROWANY zamiast zapisać `NaN` do CSS.
import { describe, it, expect } from "vitest";
import {
  readDesktopHeight,
  writeDesktopHeight,
  clampWidgetHeight,
  WIDGET_HEIGHT_MIN_PX,
  WIDGET_HEIGHT_MAX_PX,
  readActiveWidgetWidth,
  widgetWidthMode,
  widgetWidthValue,
  seedWidthForMode,
  writeWidgetWidth,
  clampFormElementSize,
  commitSizeInput,
  bumpSize,
  type WidgetWidthMode,
} from "../widgetPanelValues";

describe("readDesktopHeight", () => {
  it("brak zapisu daje `undefined`", () => {
    expect(readDesktopHeight(undefined)).toBeUndefined();
  });

  it("płaska liczba (zapis historyczny) obowiązuje jako desktop", () => {
    expect(readDesktopHeight(320)).toBe(320);
  });

  it("czyta warstwę desktopową zapisu responsywnego", () => {
    expect(readDesktopHeight({ desktop: 400, tablet: 300 })).toBe(400);
  });

  it("`auto` przechodzi jako jawny tryb hug-content", () => {
    expect(readDesktopHeight({ desktop: "auto" })).toBe("auto");
  });

  it("KSZTAŁT poza kontraktem degraduje do `undefined`, a nie do wyjątku", () => {
    // Płaskie `"auto"` na najwyższym poziomie nie jest reprezentowalne w typie
    // (`height?: ResponsiveValue<WidgetSize> | number` - płaska wartość może być
    // tylko liczbą), ale zapis idzie z JSONB, więc funkcja musi to znieść.
    expect(readDesktopHeight("auto" as unknown as number)).toBeUndefined();
    expect(readDesktopHeight("320px" as unknown as number)).toBeUndefined();
  });

  it("zapis BEZ desktopu daje `undefined`, mimo że tablet jest ustawiony", () => {
    // Panel edytuje desktop - brak tej warstwy musi pokazać „nie ustawiono",
    // a nie podstawić cudzą wartość z innego breakpointu.
    expect(readDesktopHeight({ tablet: 300 })).toBeUndefined();
  });

  it("zapis pusty daje `undefined`", () => {
    expect(readDesktopHeight({})).toBeUndefined();
  });
});

describe("writeDesktopHeight", () => {
  it("zapisuje desktop na pustym stanie", () => {
    expect(writeDesktopHeight(undefined, 500)).toEqual({ desktop: 500 });
  });

  it("ZACHOWUJE tablet i mobile przy edycji desktopu", () => {
    // Sedno kontraktu: redaktor zmienia desktop i nie traci nadpisań mobilnych.
    expect(writeDesktopHeight({ tablet: 300, mobile: 200 }, 500)).toEqual({
      desktop: 500,
      tablet: 300,
      mobile: 200,
    });
  });

  it("nadpisuje istniejącą wartość desktopową", () => {
    expect(writeDesktopHeight({ desktop: 100, tablet: 90 }, 500)).toEqual({
      desktop: 500,
      tablet: 90,
    });
  });

  it("`undefined` USUWA nadpisanie desktopowe, resztę zostawia", () => {
    expect(writeDesktopHeight({ desktop: 100, tablet: 90 }, undefined)).toEqual({ tablet: 90 });
  });

  it("usunięcie OSTATNIEJ warstwy zwija zapis do `undefined`", () => {
    // Bez tego w dokumencie zostawałby martwy `height: {}` - szum w diffie
    // i w JSONB, który nic nie robi.
    expect(writeDesktopHeight({ desktop: 100 }, undefined)).toBeUndefined();
    expect(writeDesktopHeight(undefined, undefined)).toBeUndefined();
  });

  it("płaska wartość historyczna jest MIGROWANA na zapis per breakpoint", () => {
    // Asymetria świadoma: od pierwszej edycji ustawienie jest responsywne.
    // Stara płaska wartość NIE jest przenoszona na tablet/mobile.
    expect(writeDesktopHeight(240, 500)).toEqual({ desktop: 500 });
  });

  it("`auto` da się zapisać i skasować", () => {
    expect(writeDesktopHeight(undefined, "auto")).toEqual({ desktop: "auto" });
    expect(writeDesktopHeight({ desktop: "auto" }, undefined)).toBeUndefined();
  });

  it("nie mutuje zapisu wejściowego", () => {
    const prev = { desktop: 100, tablet: 90 };
    writeDesktopHeight(prev, 500);
    expect(prev).toEqual({ desktop: 100, tablet: 90 });
  });

  it("odczyt po zapisie jest spójny (round-trip)", () => {
    for (const v of [40, 500, 2400, "auto"] as const) {
      expect(readDesktopHeight(writeDesktopHeight(undefined, v))).toBe(v);
    }
  });
});

describe("clampWidgetHeight", () => {
  it("przepuszcza wartości z zakresu", () => {
    expect(clampWidgetHeight(500)).toBe(500);
    expect(clampWidgetHeight(WIDGET_HEIGHT_MIN_PX)).toBe(WIDGET_HEIGHT_MIN_PX);
    expect(clampWidgetHeight(WIDGET_HEIGHT_MAX_PX)).toBe(WIDGET_HEIGHT_MAX_PX);
  });

  it("podnosi do minimum i obcina do maksimum", () => {
    expect(clampWidgetHeight(0)).toBe(WIDGET_HEIGHT_MIN_PX);
    expect(clampWidgetHeight(-500)).toBe(WIDGET_HEIGHT_MIN_PX);
    expect(clampWidgetHeight(99_999)).toBe(WIDGET_HEIGHT_MAX_PX);
  });

  it("granice mają sens (min < max, oba dodatnie)", () => {
    expect(WIDGET_HEIGHT_MIN_PX).toBeGreaterThan(0);
    expect(WIDGET_HEIGHT_MIN_PX).toBeLessThan(WIDGET_HEIGHT_MAX_PX);
  });
});

describe("readActiveWidgetWidth", () => {
  it("brak zapisu daje `undefined` na każdym urządzeniu", () => {
    for (const d of ["desktop", "tablet", "mobile"] as const) {
      expect(readActiveWidgetWidth(undefined, d)).toBeUndefined();
    }
  });

  it("płaska wartość (zapis historyczny) obowiązuje wszędzie", () => {
    for (const d of ["desktop", "tablet", "mobile"] as const) {
      expect(readActiveWidgetWidth(320, d)).toBe(320);
    }
  });

  it("bierze warstwę żądanego urządzenia", () => {
    const stored = { desktop: "100%", tablet: "50%", mobile: 320 } as never;
    expect(readActiveWidgetWidth(stored, "desktop")).toBe("100%");
    expect(readActiveWidgetWidth(stored, "tablet")).toBe("50%");
    expect(readActiveWidgetWidth(stored, "mobile")).toBe(320);
  });

  it("spada na desktop, gdy brak warstwy urządzenia", () => {
    const stored = { desktop: "80%" } as never;
    expect(readActiveWidgetWidth(stored, "mobile")).toBe("80%");
    expect(readActiveWidgetWidth(stored, "tablet")).toBe("80%");
  });

  it("bez desktopu i bez własnej warstwy daje `undefined`", () => {
    expect(readActiveWidgetWidth({ tablet: "50%" } as never, "mobile")).toBeUndefined();
  });
});

describe("widgetWidthMode", () => {
  it("`auto` to tryb „do treści”", () => {
    expect(widgetWidthMode("auto")).toBe("wrapped");
  });

  it("`100%` to PEŁNA szerokość, nie procent", () => {
    // Gdyby wpadło w „percent", przełącznik pokazywałby suwak na 100 zamiast
    // zaznaczonego trybu pełnego - i redaktor nie miałby jak wrócić.
    expect(widgetWidthMode("100%")).toBe("full");
  });

  it("inny procent to tryb procentowy", () => {
    expect(widgetWidthMode("50%")).toBe("percent");
    expect(widgetWidthMode("33.5%")).toBe("percent");
    expect(widgetWidthMode("0%")).toBe("percent");
  });

  it("liczba to tryb pikselowy", () => {
    expect(widgetWidthMode(320)).toBe("px");
    expect(widgetWidthMode(0)).toBe("px");
  });

  it("brak wartości i wartość nierozpoznana dają `full` (domyślna szerokość)", () => {
    expect(widgetWidthMode(undefined)).toBe("full");
    expect(widgetWidthMode("szeroko" as never)).toBe("full");
  });
});

describe("widgetWidthValue", () => {
  it("procent czyta liczbę z łańcucha", () => {
    expect(widgetWidthValue("50%", "percent")).toBe(50);
    expect(widgetWidthValue("33.5%", "percent")).toBe(33.5);
  });

  it("procent nieparsowalny spada na 50", () => {
    expect(widgetWidthValue("abc%" as never, "percent")).toBe(50);
  });

  it("procent równy 0 spada na 50 (`||`, nie `??`)", () => {
    // Utrwalone świadomie: 0% to szerokość niewidoczna, więc panel pokazuje
    // wartość użyteczną zamiast zera.
    expect(widgetWidthValue("0%", "percent")).toBe(50);
  });

  it("piksele czytają liczbę, a śmieć spada na 320", () => {
    expect(widgetWidthValue(480, "px")).toBe(480);
    expect(widgetWidthValue("abc" as never, "px")).toBe(320);
    expect(widgetWidthValue(0, "px")).toBe(320);
  });

  it("tryb pełny to zawsze 100, niezależnie od zapisu", () => {
    expect(widgetWidthValue(undefined, "full")).toBe(100);
    expect(widgetWidthValue("100%", "full")).toBe(100);
  });

  it("tryb „do treści” nie ma liczby", () => {
    expect(widgetWidthValue("auto", "wrapped")).toBe(0);
  });
});

describe("seedWidthForMode", () => {
  it("każdy tryb ma wartość startową", () => {
    expect(seedWidthForMode("full")).toBe("100%");
    expect(seedWidthForMode("percent")).toBe("50%");
    expect(seedWidthForMode("px")).toBe(320);
    expect(seedWidthForMode("wrapped")).toBe("auto");
  });

  it("wartość startowa wraca do TEGO SAMEGO trybu (pętla domknięta)", () => {
    // Gdyby seed dla „percent" był `100%`, przełącznik natychmiast skakałby
    // na „full" - klik w tryb procentowy byłby nieklikalny.
    const modes: WidgetWidthMode[] = ["full", "percent", "px", "wrapped"];
    for (const mode of modes) {
      expect(widgetWidthMode(seedWidthForMode(mode))).toBe(mode);
    }
  });
});

describe("writeWidgetWidth", () => {
  it("zapisuje wartość dla wskazanego urządzenia", () => {
    expect(writeWidgetWidth(undefined, "desktop", "50%")).toEqual({ desktop: "50%" });
    expect(writeWidgetWidth(undefined, "mobile", 320)).toEqual({ mobile: 320 });
  });

  it("nie rusza warstw innych urządzeń", () => {
    expect(writeWidgetWidth({ desktop: "100%" } as never, "mobile", "50%")).toEqual({
      desktop: "100%",
      mobile: "50%",
    });
  });

  it("`undefined` usuwa TYLKO warstwę tego urządzenia", () => {
    expect(
      writeWidgetWidth({ desktop: "100%", mobile: 320 } as never, "mobile", undefined),
    ).toEqual({ desktop: "100%" });
  });

  it("usunięcie ostatniej warstwy zwija zapis do `undefined`", () => {
    expect(writeWidgetWidth({ mobile: 320 } as never, "mobile", undefined)).toBeUndefined();
    expect(writeWidgetWidth(undefined, "desktop", undefined)).toBeUndefined();
  });

  it("płaska wartość historyczna jest migrowana na zapis per urządzenie", () => {
    expect(writeWidgetWidth(320, "desktop", "50%")).toEqual({ desktop: "50%" });
  });

  it("nie mutuje zapisu wejściowego", () => {
    const prev = { desktop: "100%" } as never;
    writeWidgetWidth(prev, "mobile", 320);
    expect(prev).toEqual({ desktop: "100%" });
  });

  it("odczyt po zapisie jest spójny na każdym urządzeniu", () => {
    for (const d of ["desktop", "tablet", "mobile"] as const) {
      expect(readActiveWidgetWidth(writeWidgetWidth(undefined, d, "50%"), d)).toBe("50%");
    }
  });
});

describe("clampFormElementSize", () => {
  it("przycina do zakresu pola", () => {
    expect(clampFormElementSize(50, 10, 40)).toBe(40);
    expect(clampFormElementSize(5, 10, 40)).toBe(10);
    expect(clampFormElementSize(25, 10, 40)).toBe(25);
  });

  it("ZAOKRĄGLA - rozmiar w px nie ma sensu ułamkowego", () => {
    expect(clampFormElementSize(20.4, 10, 40)).toBe(20);
    expect(clampFormElementSize(20.6, 10, 40)).toBe(21);
  });

  it("zaokrąglenie zachodzi PRZED przycięciem do granicy", () => {
    expect(clampFormElementSize(40.4, 10, 40)).toBe(40);
  });
});

describe("commitSizeInput", () => {
  it("pusty wpis znaczy „wróć do auto”, nie „ustaw zero”", () => {
    // Kluczowa różnica: `clear` prowadzi do USUNIĘCIA klucza z treści widgetu.
    // Zapis zera dałby element o zerowym rozmiarze.
    expect(commitSizeInput("", 10, 40)).toEqual({ kind: "clear" });
    expect(commitSizeInput("   ", 10, 40)).toEqual({ kind: "clear" });
  });

  it("wpis NIELICZBOWY jest ignorowany, nie zapisywany jako NaN", () => {
    // `NaN` doszedłby do CSS jako `NaNpx` i element traciłby rozmiar.
    expect(commitSizeInput("abc", 10, 40)).toEqual({ kind: "ignore" });
    expect(commitSizeInput("12px", 10, 40)).toEqual({ kind: "ignore" });
  });

  it("liczba jest zapisywana po przycięciu", () => {
    expect(commitSizeInput("25", 10, 40)).toEqual({ kind: "set", value: 25 });
    expect(commitSizeInput("100", 10, 40)).toEqual({ kind: "set", value: 40 });
    expect(commitSizeInput("1", 10, 40)).toEqual({ kind: "set", value: 10 });
  });

  it("zero jest liczbą POPRAWNĄ (przyciętą do minimum), nie czyszczeniem", () => {
    expect(commitSizeInput("0", 10, 40)).toEqual({ kind: "set", value: 10 });
  });

  it("ułamek jest zaokrąglany", () => {
    expect(commitSizeInput("20.6", 10, 40)).toEqual({ kind: "set", value: 21 });
  });

  it("wartość ujemna wjeżdża na minimum, a nie jest ignorowana", () => {
    expect(commitSizeInput("-5", 10, 40)).toEqual({ kind: "set", value: 10 });
  });
});

describe("bumpSize", () => {
  it("krok od wartości ustawionej", () => {
    expect(bumpSize(20, 16, +1, 10, 40)).toBe(21);
    expect(bumpSize(20, 16, -1, 10, 40)).toBe(19);
  });

  it("krok od „auto” startuje od ZMIERZONEGO rozmiaru, nie od minimum", () => {
    // Bez tego pierwsze kliknięcie widocznie zeskakiwało drobne rozmiary tekstu
    // na wartość minimalną pola.
    expect(bumpSize(null, 16, +1, 10, 40)).toBe(17);
    expect(bumpSize(null, 16, -1, 10, 40)).toBe(15);
  });

  it("krok nie wyprowadza poza zakres", () => {
    expect(bumpSize(40, 16, +1, 10, 40)).toBe(40);
    expect(bumpSize(10, 16, -1, 10, 40)).toBe(10);
  });

  it("krok z „auto” też jest przycinany", () => {
    expect(bumpSize(null, 999, +1, 10, 40)).toBe(40);
    expect(bumpSize(null, 0, -1, 10, 40)).toBe(10);
  });

  it("krok większy niż 1 działa tak samo", () => {
    expect(bumpSize(20, 16, +10, 10, 40)).toBe(30);
    expect(bumpSize(20, 16, -100, 10, 40)).toBe(10);
  });
});
