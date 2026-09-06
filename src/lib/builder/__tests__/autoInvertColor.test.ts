// Testy heurystyki auto-inwersji kolorów widgetów.
//
// Dlaczego to jest kod ryzykowny, a nie kosmetyka: `resolveColorForMode` jest
// jedynym miejscem, które decyduje, jaki kolor DOSTANIE tekst i ikona, gdy
// redakcja ustawiła kolor tylko dla jednego trybu. Zła decyzja nie wywraca
// renderu - po prostu daje czarny tekst na czarnym tle, czego żaden test
// renderujący nie widzi. Dowodem musi więc być KONKRETNY łańcuch wyjściowy,
// a nie „nie rzuciło".
//
// Dwie osie są tu istotne:
//  1) PARSER - co jest kolorem, a co nie. Wartość spoza katalogu (hsl, nazwa
//     CSS inna niż white/black, ucięty hex) MUSI wrócić nietknięta, bo lepiej
//     zostawić kolor autora niż podstawić coś wymyślonego.
//  2) PRÓGI - 0,45 dla dark i 0,55 dla light. Testujemy wartości graniczne po
//     obu stronach, bo to jedyne miejsce, gdzie „prawie" znaczy „odwrotnie".
import { describe, expect, it } from "vitest";
import { autoInvertColor, resolveColorForMode } from "@/lib/builder/autoInvertColor";
import type { Themed } from "@/lib/builder/types";

/** Kanały wyniku - do sprawdzania, czy zostały w gamucie 0-255. */
function channelsOf(css: string): number[] {
  const match = css.match(/^rgba?\(([^)]+)\)$/);
  if (!match) return [];
  return match[1]
    .split(/[\s,]+/)
    .slice(0, 3)
    .map((part) => Number.parseFloat(part));
}

describe("autoInvertColor - parser wejścia", () => {
  it("nazwy white i black są rozpoznawane i odwracane", () => {
    expect(autoInvertColor("white", "light")).toBe("rgb(0, 0, 0)");
    expect(autoInvertColor("black", "dark")).toBe("rgb(255, 255, 255)");
  });

  it("wielkie litery i spacje wokół wartości nie psują rozpoznania", () => {
    expect(autoInvertColor("  #FFFFFF  ", "light")).toBe("rgb(0, 0, 0)");
  });

  it("transparent, currentColor i inherit wracają NIETKNIĘTE", () => {
    // To nie są kolory, tylko odesłania. Podstawienie tu czegokolwiek zabrałoby
    // widgetowi dziedziczenie po kontenerze.
    expect(autoInvertColor("transparent", "dark")).toBe("transparent");
    expect(autoInvertColor("currentColor", "dark")).toBe("currentColor");
    expect(autoInvertColor("inherit", "light")).toBe("inherit");
  });

  it("pusty łańcuch wraca pusty - nie ma czego odwracać", () => {
    expect(autoInvertColor("", "dark")).toBe("");
  });

  it("hex 3-znakowy jest rozwijany do pełnych kanałów", () => {
    // #123 -> rgb(17, 34, 51), luminancja 0,12 -> w dark odwracamy.
    expect(autoInvertColor("#123", "dark")).toBe("rgb(238, 221, 204)");
  });

  it("hex 4-znakowy czyta kanał alfa i zwraca zapis rgba", () => {
    expect(autoInvertColor("#0000", "dark")).toBe("rgba(255, 255, 255, 0)");
  });

  it("hex 8-znakowy z alfą FF jest w pełni krycia - zapis rgb bez alfy", () => {
    expect(autoInvertColor("#000000ff", "dark")).toBe("rgb(255, 255, 255)");
  });

  it("hex 8-znakowy z alfą częściową zachowuje przezroczystość", () => {
    // 0x80 / 255 = 0,50196..., więc alfa musi przejść LICZBOWO, bez zaokrąglania.
    expect(autoInvertColor("#00000080", "dark")).toBe(`rgba(255, 255, 255, ${128 / 255})`);
  });

  it("hex o długości spoza {3,4,6,8} wraca nietknięty", () => {
    expect(autoInvertColor("#12345", "dark")).toBe("#12345");
    expect(autoInvertColor("#1", "dark")).toBe("#1");
  });

  it("hex z niedozwolonymi znakami wraca nietknięty", () => {
    expect(autoInvertColor("#gg0", "dark")).toBe("#gg0");
    expect(autoInvertColor("#zzzzzz", "dark")).toBe("#zzzzzz");
  });

  it("rgb z przecinkami i rgb ze spacjami dają ten sam wynik", () => {
    expect(autoInvertColor("rgb(0, 0, 0)", "dark")).toBe("rgb(255, 255, 255)");
    expect(autoInvertColor("rgb(0 0 0)", "dark")).toBe("rgb(255, 255, 255)");
  });

  it("rgba zachowuje alfę autora", () => {
    expect(autoInvertColor("rgba(0, 0, 0, 0.5)", "dark")).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("rgb z częściami ułamkowymi jest zaokrąglany do całych kanałów", () => {
    expect(autoInvertColor("rgb(10.4, 10.6, 10.5)", "dark")).toBe("rgb(245, 244, 244)");
  });

  it("rgb z mniej niż trzema składowymi wraca nietknięty", () => {
    expect(autoInvertColor("rgb(0, 0)", "dark")).toBe("rgb(0, 0)");
  });

  it("rgb ze składowymi nieliczbowymi wraca nietknięty", () => {
    expect(autoInvertColor("rgb(a, b, c)", "dark")).toBe("rgb(a, b, c)");
  });

  it("formaty spoza katalogu parsera (hsl, oklch, nazwa CSS) wracają nietknięte", () => {
    // Świadomy brak wsparcia: lepiej zostawić kolor autora niż odwrócić
    // wartość, której nie umiemy policzyć.
    expect(autoInvertColor("hsl(210 100% 50%)", "dark")).toBe("hsl(210 100% 50%)");
    expect(autoInvertColor("oklch(0.6 0.2 250)", "dark")).toBe("oklch(0.6 0.2 250)");
    expect(autoInvertColor("rebeccapurple", "dark")).toBe("rebeccapurple");
    expect(autoInvertColor("var(--brand)", "dark")).toBe("var(--brand)");
  });
});

describe("autoInvertColor - progi luminancji", () => {
  it("dark: kolor CIEMNIEJSZY od progu 0,45 jest odwracany", () => {
    // 114/255 = 0,447 - pod progiem.
    expect(autoInvertColor("rgb(114, 114, 114)", "dark")).toBe("rgb(141, 141, 141)");
  });

  it("dark: kolor DOKŁADNIE na progu 0,45 i wyżej zostaje bez zmian", () => {
    // 115/255 = 0,451 - próg jest ostry (<), więc ta wartość przechodzi.
    expect(autoInvertColor("rgb(115, 115, 115)", "dark")).toBe("rgb(115, 115, 115)");
  });

  it("light: kolor JAŚNIEJSZY od progu 0,55 jest odwracany", () => {
    // 141/255 = 0,553 - nad progiem.
    expect(autoInvertColor("rgb(141, 141, 141)", "light")).toBe("rgb(114, 114, 114)");
  });

  it("light: kolor DOKŁADNIE na progu 0,55 i niżej zostaje bez zmian", () => {
    // 140/255 = 0,549 - pod progiem.
    expect(autoInvertColor("rgb(140, 140, 140)", "light")).toBe("rgb(140, 140, 140)");
  });

  it("kolor środkowy (szarość 50%) przechodzi bez zmian w OBU trybach", () => {
    // Strefa martwa między progami to celowa decyzja: akcenty marki czytają
    // się na obu tłach, więc ich nie ruszamy.
    expect(autoInvertColor("#808080", "dark")).toBe("#808080");
    expect(autoInvertColor("#808080", "light")).toBe("#808080");
  });

  it("luminancja waży kanały percepcyjnie - zielony jaśniejszy niż niebieski", () => {
    // Czysty zielony (0,587) jest nad progiem light -> odwracany.
    expect(autoInvertColor("#00FF00", "light")).toBe("rgb(255, 0, 255)");
    // Czysty niebieski (0,114) jest pod progiem dark -> odwracany.
    expect(autoInvertColor("#0000FF", "dark")).toBe("rgb(255, 255, 0)");
    // ...i odwrotnie: niebieski w light zostaje, zielony w dark zostaje.
    expect(autoInvertColor("#0000FF", "light")).toBe("#0000FF");
    expect(autoInvertColor("#00FF00", "dark")).toBe("#00FF00");
  });
});

describe("resolveColorForMode", () => {
  it("brak wartości daje undefined - widget bierze token z global colors", () => {
    expect(resolveColorForMode(undefined, "light")).toBeUndefined();
    expect(resolveColorForMode(null as unknown as Themed<string>, "dark")).toBeUndefined();
  });

  it("wartość PŁASKA w trybie light jest oddawana dosłownie", () => {
    // Konwencja: light to strona autorska, więc tam nie zgadujemy.
    expect(resolveColorForMode("#111111", "light")).toBe("#111111");
  });

  it("wartość PŁASKA w trybie dark jest auto-odwracana", () => {
    expect(resolveColorForMode("#111111", "dark")).toBe("rgb(238, 238, 238)");
  });

  it("jawny override dla żądanego trybu wygrywa bez żadnej inwersji", () => {
    const themed: Themed<string> = { light: "#111111", dark: "#EEEEEE" };
    expect(resolveColorForMode(themed, "light")).toBe("#111111");
    expect(resolveColorForMode(themed, "dark")).toBe("#EEEEEE");
  });

  it("brak override dla trybu bierze DRUGI tryb i go odwraca", () => {
    expect(resolveColorForMode({ dark: "#EEEEEE" }, "light")).toBe("rgb(17, 17, 17)");
    expect(resolveColorForMode({ light: "#111111" }, "dark")).toBe("rgb(238, 238, 238)");
  });

  it("obiekt themed z pustymi oboma trybami daje undefined", () => {
    // `{ light: undefined }` NADAL jest obiektem themed (klucz istnieje), więc
    // ta gałąź to jedyna droga do „brak override w obu trybach".
    expect(resolveColorForMode({ light: undefined }, "light")).toBeUndefined();
    expect(resolveColorForMode({ dark: undefined }, "dark")).toBeUndefined();
  });

  it("null w slocie trybu jest traktowany jak brak override, nie jak kolor", () => {
    const themed = { light: null, dark: "#EEEEEE" } as unknown as Themed<string>;
    expect(resolveColorForMode(themed, "light")).toBe("rgb(17, 17, 17)");
  });

  it("wartość nieodwracalna w drugim trybie wraca dosłownie", () => {
    // Fallback przechodzi przez autoInvertColor, ale parser jej nie rozumie -
    // więc autor dostaje swój token, nie wymyśloną wartość.
    expect(resolveColorForMode({ dark: "var(--brand)" }, "light")).toBe("var(--brand)");
  });
});

describe("autoInvertColor - defekty", () => {
  // DEFEKT: ALFA ZAPISANA PROCENTOWO JEST CICHO GUBIONA.
  //
  // WEJSCIE: kolor w składni CSS Color 4 z ukośnikiem i procentem -
  //   `rgb(0 0 0 / 50%)`. Tak zwraca kopiowanie koloru z DevToolsów i tak
  //   serializuje część współczesnych pickerów, więc taka wartość realnie
  //   trafia do `content` widgetu.
  // CO PSUJE: `parseColor` (src/lib/builder/autoInvertColor.ts:49-55) rozbija
  //   wnętrze nawiasu po `[\s,/]+`, więc ukośnik znika i czwarta część to
  //   łańcuch "50%". `parseFloat("50%")` daje 50, a nie 0,5. Potem `format`
  //   (:66) sprawdza `a < 1` - 50 nie jest mniejsze od 1 - i buduje zapis
  //   `rgb(...)` BEZ alfy.
  // KONSEKWENCJA: półprzezroczysta nakładka/tekst po auto-inwersji staje się
  //   w 100% kryjąca. Na sekcji z tłem obrazkowym oznacza to zasłonięcie
  //   treści, a nie tylko inny odcień - i nie widać tego w żadnym teście
  //   renderującym, bo element jest na miejscu i ma poprawny kolor.
  // WYMAGANA POPRAWKA: `parseColor` musi rozpoznać procentową alfę
  //   (dzielić przez 100), a wartości poza zakresem 0-1 przycinać, żeby
  //   krycie wyjścia było ZAWSZE takie jak na wejściu.
  it.fails("DEFEKT: alfa procentowa (rgb(0 0 0 / 50%)) MUSI zostać zachowana", () => {
    expect(autoInvertColor("rgb(0 0 0 / 50%)", "dark")).toBe("rgba(255, 255, 255, 0.5)");
  });

  // DEFEKT: KANAŁY SPOZA ZAKRESU 0-255 DAJĄ NIEPRAWIDŁOWY CSS.
  //
  // WEJSCIE: kolor z kanałem poza gamutem, np. `rgb(300, -5, 0)` - taki zapis
  //   powstaje z importu obcej treści albo z ręcznej edycji JSON-a widgetu.
  //   Przeglądarka przycina go przy parsowaniu do `rgb(255, 0, 0)`.
  // CO PSUJE: `parseColor` przyjmuje każdą liczbę skończoną (:55), a
  //   `autoInvertColor` (:80, :84) odejmuje ją od 255 BEZ przycięcia. Dla
  //   300 wychodzi -45, dla -5 wychodzi 260.
  // KONSEKWENCJA: `format` produkuje `rgb(-45, 260, 255)` - łańcuch, którego
  //   CSS nie przyjmuje. Deklaracja jest odrzucana W CAŁOŚCI, więc element
  //   traci kolor i spada do wartości dziedziczonej. Efekt jest ten sam co
  //   przy braku ustawienia, tylko bez żadnego śladu w danych.
  // WYMAGANA POPRAWKA: przyciąć kanały do 0-255 (na wejściu przy parsowaniu
  //   albo na wyjściu przy składaniu), żeby wynik był ZAWSZE poprawnym CSS.
  it.fails("DEFEKT: wynik MUSI mieć kanały w zakresie 0-255", () => {
    const out = autoInvertColor("rgb(300, -5, 0)", "dark");
    const channels = channelsOf(out);
    expect(channels).toHaveLength(3);
    for (const channel of channels) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});
