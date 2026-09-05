// Kontrast napisu wiersza social po najechaniu - `readableOn` / `luminance`.
//
// DEFEKT, KTÓRY TEN PLIK ZAMYKA. `safeWidgetColor` (`lib/builder/cssColor.ts:31-40`)
// celowo przepuszcza trzynaście zapisów koloru, bo poprzednia walidacja
// wzorcem `/^#([0-9a-f]{3}|[0-9a-f]{6})$/` gubiła po cichu wszystko, co
// commituje `AdminColorPicker`. Ale `luminance` w `socialHover.ts` parsowała
// DOKŁADNIE ten wzorzec, który `cssColor.ts` został napisany, żeby zastąpić -
// więc dla DZIESIĘCIU z trzynastu zapisów zwracała `null`, a `readableOn`
// wpuszczała `null` do gałęzi `#ffffff`. Ustawienie jasnego tła wiersza
// którymkolwiek z nich dawało BIAŁY NAPIS NA JASNYM TLE, a panel obiecywał
// w `schemas.ts` (pole `rowHoverColor`) coś dokładnie odwrotnego.
//
// DLACZEGO TEN TEST LICZY KONTRAST, A NIE SPRAWDZA NAZWY KOLORU. Asercja
// „zwróciło #141414" przechodzi także wtedy, gdy próg jest ustawiony bez sensu
// - a to była właśnie treść defektu (próg 0,42 dawał bieli na tle o tej
// jasności 2,23:1). Dlatego plik ma WŁASNĄ, niezależną implementację wzoru
// WCAG i ocenia wynik współczynnikiem kontrastu, nie tożsamością stringa.
import { describe, expect, it } from "vitest";
import {
  luminance,
  readableOn,
  socialHoverForeground,
  socialHoverGradient,
  socialHoverIconColor,
  socialHoverStyle,
  SOCIAL_ROW_HOVER_MODES,
  type SocialHoverPlan,
} from "../socialHover";

// ---------------------------------------------------------------------------
// Niezależna implementacja odniesienia (WCAG 2.x). Świadomie NIE importuje
// niczego z modułu badanego - inaczej test potwierdzałby sam siebie.
// ---------------------------------------------------------------------------

/** Kanał sRGB 0-255 -> liniowy. */
function refChannel(value255: number): number {
  const v = value255 / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Luminancja odniesienia z trójki 0-255. */
function refLuminance(r: number, g: number, b: number): number {
  return 0.2126 * refChannel(r) + 0.7152 * refChannel(g) + 0.0722 * refChannel(b);
}

/** Współczynnik kontrastu WCAG: (jaśniejsza + 0,05) / (ciemniejsza + 0,05). */
function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Luminancja odniesienia dla zapisu hex - jedyny zapis, jakiego używa tabela wyniku. */
function refLuminanceOfHex(hex: string): number {
  const d = hex.slice(1);
  const pair = (i: number) => parseInt(d.slice(i, i + 2), 16);
  return refLuminance(pair(0), pair(2), pair(4));
}

const L_WHITE = refLuminanceOfHex("#ffffff");
const L_INK = refLuminanceOfHex("#141414");

/**
 * Podłoga UDOWODNIONA dla pary (#ffffff, #141414) przy progu zrównania
 * kontrastów. Wyprowadzenie stoi przy `READABLE_ON_LUMINANCE_THRESHOLD`
 * w `socialHover.ts`; tu jest tylko liczbą, którą test egzekwuje.
 */
const PROVEN_FLOOR = 4.29;
/** Wymaganie WCAG AA dla tekstu zwykłego - patrz `it.fails` na końcu pliku. */
const WCAG_AA = 4.5;

/**
 * Kontrast zwróconego koloru wobec tła o znanej luminancji.
 * `null` = zwrócony kolor jest tokenem motywu, więc nie ma liczbowej luminancji.
 */
function contrastOfResult(result: string, bgLuminance: number): number | null {
  if (result === "#ffffff") return contrastRatio(L_WHITE, bgLuminance);
  if (result === "#141414") return contrastRatio(L_INK, bgLuminance);
  return null;
}

// ---------------------------------------------------------------------------
// Trzynaście zapisów, które `safeWidgetColor` przepuszcza do `rowHoverColor`.
// `luminance` = oczekiwana luminancja odniesienia albo `null`, gdy zapisu nie
// da się policzyć bez layoutu.
// ---------------------------------------------------------------------------
const NOTATIONS: ReadonlyArray<{ zapis: string; luminancja: number | null }> = [
  { zapis: "#ffffff", luminancja: refLuminance(255, 255, 255) },
  { zapis: "#fff", luminancja: refLuminance(255, 255, 255) },
  { zapis: "#f5f5f0", luminancja: refLuminance(245, 245, 240) },
  { zapis: "#ffffffff", luminancja: refLuminance(255, 255, 255) },
  { zapis: "#ffff", luminancja: refLuminance(255, 255, 255) },
  { zapis: "rgb(255,255,255)", luminancja: refLuminance(255, 255, 255) },
  { zapis: "rgba(255,255,255,1)", luminancja: refLuminance(255, 255, 255) },
  { zapis: "hsl(0 0% 100%)", luminancja: refLuminance(255, 255, 255) },
  { zapis: "#101010", luminancja: refLuminance(16, 16, 16) },
  { zapis: "oklch(1 0 0)", luminancja: null },
  { zapis: "var(--background)", luminancja: null },
  { zapis: "transparent", luminancja: null },
  { zapis: "currentcolor", luminancja: null },
];

describe("readableOn - kontrast liczony, nie zgadywany (trzynaście zapisów panelu)", () => {
  it("tabela ma dokładnie trzynaście zapisów - tyle przepuszcza safeWidgetColor", () => {
    expect(NOTATIONS).toHaveLength(13);
  });

  it.each(NOTATIONS)(
    "$zapis - luminancja zgadza się z niezależnym wyliczeniem WCAG",
    ({ zapis, luminancja }) => {
      const measured = luminance(zapis);
      if (luminancja === null) {
        expect(measured).toBeNull();
      } else {
        expect(measured).not.toBeNull();
        expect(measured as number).toBeCloseTo(luminancja, 6);
      }
    },
  );

  it.each(NOTATIONS.filter((n) => n.luminancja !== null))(
    "$zapis - wybrany kolor napisu trzyma udowodnioną podłogę kontrastu",
    ({ zapis, luminancja }) => {
      const result = readableOn(zapis);
      const ratio = contrastOfResult(result, luminancja as number);
      expect(ratio).not.toBeNull();
      expect(ratio as number).toBeGreaterThanOrEqual(PROVEN_FLOOR);
    },
  );

  it.each(NOTATIONS.filter((n) => n.luminancja === null))(
    "$zapis - zapisu NIE da się policzyć, więc napis bierze token motywu, NIE biel",
    ({ zapis }) => {
      const result = readableOn(zapis);
      // To jest asercja regresyjna całego zadania: biel na nieznanym tle była
      // defektem, bo `var(--background)` i `transparent` bywają jasne.
      expect(result).not.toBe("#ffffff");
      expect(result).toBe("var(--foreground)");
    },
  );

  it("jasne tło dostaje ciemny tusz, ciemne tło - biel (obie gałęzie żyją)", () => {
    expect(readableOn("#ffffff")).toBe("#141414");
    expect(readableOn("#101010")).toBe("#ffffff");
  });

  it("przykład z placeholdera panelu (#B85410) jest czytelny - i to bielą", () => {
    const l = luminance("#B85410");
    expect(l).not.toBeNull();
    const ratio = contrastOfResult(readableOn("#B85410"), l as number);
    expect(ratio as number).toBeGreaterThanOrEqual(WCAG_AA);
  });
});

describe("readableOn - przemiatanie całego zakresu jasności", () => {
  // 200 szarości od czerni do bieli. Szarość jest tu wystarczająca, bo funkcja
  // decyduje WYŁĄCZNIE na podstawie luminancji, a szarości pokrywają jej
  // pełny zakres bez luk.
  const GREYS = Array.from({ length: 200 }, (_, i) => Math.round((i * 255) / 199));

  it("dla KAŻDEJ z 200 szarości wybrany napis trzyma udowodnioną podłogę 4,29:1", () => {
    const failures: string[] = [];
    for (const channel of GREYS) {
      const hex = `#${channel.toString(16).padStart(2, "0").repeat(3)}`;
      const l = refLuminance(channel, channel, channel);
      const ratio = contrastOfResult(readableOn(hex), l);
      if (ratio === null || ratio < PROVEN_FLOOR) {
        failures.push(`${hex} -> ${readableOn(hex)} = ${ratio?.toFixed(3) ?? "brak"}`);
      }
    }
    expect(failures).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // DEFEKT: para kolorów (#ffffff, #141414) NIE MOŻE osiągnąć WCAG AA 4,5:1
  // na całym zakresie - przy ŻADNYM progu.
  //
  // WEJŚCIE: tło wiersza o luminancji z pasma (0,1833 ; 0,2065), np. `#767676`.
  // CO PSUJE: biel trzyma 4,5:1 tylko do L = 0,183333, a `#141414` dopiero od
  //   L = 0,206479 (`socialHover.ts`, komentarz przy READABLE_ON_LUMINANCE_THRESHOLD).
  //   Okna się nie stykają, więc w paśmie między nimi ŻADEN z dwóch kolorów
  //   nie osiąga AA. Obecny próg 0,1946 maksymalizuje gwarantowane minimum
  //   (4,292:1), ale minimum to nadal jest poniżej 4,5:1.
  // KONSEKWENCJA: napis wiersza na tle w tym paśmie jest zgodny z AA tylko
  //   „prawie" - czytelny, ale poniżej wymagania dla tekstu zwykłego.
  // WYMAGANA ZMIANA PRODUKCYJNA (nie wykonana tutaj): przyciemnić tusz
  //   `READABLE_INK` do wartości nie jaśniejszej niż `#060606` i ustawić próg
  //   0,1832 - wtedy obie strony domykają 4,5:1. To jest decyzja O PALECIE
  //   (`#141414` jest tokenem `--background` trybu ciemnego, `styles.css:304`),
  //   a nie o tym module, dlatego zostaje zarejestrowana, nie wykonana.
  // -------------------------------------------------------------------------
  it.fails("DEFEKT: para #ffffff/#141414 NIE domyka WCAG AA 4,5:1 w paśmie 0,1833-0,2065", () => {
    const failures: string[] = [];
    for (const channel of GREYS) {
      const hex = `#${channel.toString(16).padStart(2, "0").repeat(3)}`;
      const l = refLuminance(channel, channel, channel);
      const ratio = contrastOfResult(readableOn(hex), l);
      if (ratio === null || ratio < WCAG_AA) failures.push(hex);
    }
    expect(failures).toEqual([]);
  });
});

describe("luminance - zapisy, których policzyć się NIE DA, oraz alfa", () => {
  it.each([
    "hwb(0 0% 0%)",
    "oklab(0.5 0 0)",
    "lab(50 0 0)",
    "lch(50 0 0)",
    "color(srgb 1 1 1)",
    "var(--brand)",
    "",
    "   ",
    "nie-kolor",
    "#12345",
    "#1234567",
    "rgb(255,255)",
    "hsl(0 0 100)",
  ])("%s nie ma policzalnej luminancji", (zapis) => {
    expect(luminance(zapis)).toBeNull();
  });

  it("kolor PÓŁPRZEZROCZYSTY nie ma luminancji - komponuje się z nieznanym tłem", () => {
    expect(luminance("#ffffff80")).toBeNull();
    expect(luminance("#fff8")).toBeNull();
    expect(luminance("rgba(255,255,255,0.5)")).toBeNull();
    expect(luminance("hsla(0 0% 100% / 50%)")).toBeNull();
    // ...a półprzezroczyste tło idzie tą samą drogą co `transparent`.
    expect(readableOn("rgba(255,255,255,0.5)")).toBe("var(--foreground)");
  });

  it("kolor W PEŁNI nieprzezroczysty liczy się normalnie w każdym zapisie alfy", () => {
    const white = refLuminance(255, 255, 255);
    expect(luminance("#ffffffff") as number).toBeCloseTo(white, 6);
    expect(luminance("#ffff") as number).toBeCloseTo(white, 6);
    expect(luminance("rgba(255,255,255,1)") as number).toBeCloseTo(white, 6);
    expect(luminance("rgb(255 255 255 / 100%)") as number).toBeCloseTo(white, 6);
  });

  it("składnia ze spacją i z przecinkiem dają ten sam wynik", () => {
    expect(luminance("rgb(18 52 86)") as number).toBeCloseTo(
      luminance("rgb(18,52,86)") as number,
      12,
    );
    expect(luminance("hsl(210, 50%, 40%)") as number).toBeCloseTo(
      luminance("hsl(210 50% 40%)") as number,
      12,
    );
  });

  it("kanały rgb w procentach są skalowane do 0-255", () => {
    expect(luminance("rgb(100%,100%,100%)") as number).toBeCloseTo(refLuminance(255, 255, 255), 6);
    expect(luminance("rgb(0%,0%,0%)") as number).toBeCloseTo(refLuminance(0, 0, 0), 6);
  });

  it.each([
    { zapis: "hsl(0 100% 50%)", rgb: [255, 0, 0] },
    { zapis: "hsl(60 100% 50%)", rgb: [255, 255, 0] },
    { zapis: "hsl(120 100% 50%)", rgb: [0, 255, 0] },
    { zapis: "hsl(180 100% 50%)", rgb: [0, 255, 255] },
    { zapis: "hsl(240 100% 50%)", rgb: [0, 0, 255] },
    { zapis: "hsl(300 100% 50%)", rgb: [255, 0, 255] },
    { zapis: "hsl(0 0% 0%)", rgb: [0, 0, 0] },
    { zapis: "hsl(360deg 100% 50%)", rgb: [255, 0, 0] },
    { zapis: "hsl(-120 100% 50%)", rgb: [0, 0, 255] },
  ])("$zapis odpowiada rgb($rgb)", ({ zapis, rgb }) => {
    expect(luminance(zapis) as number).toBeCloseTo(refLuminance(rgb[0], rgb[1], rgb[2]), 6);
  });

  it("wartości poza zakresem są przycinane, a nie liczone dziko", () => {
    expect(luminance("rgb(300,300,300)") as number).toBeCloseTo(refLuminance(255, 255, 255), 6);
    expect(luminance("rgb(-20,-20,-20)") as number).toBeCloseTo(refLuminance(0, 0, 0), 6);
    expect(luminance("hsl(0 200% 150%)") as number).toBeCloseTo(refLuminance(255, 255, 255), 6);
  });

  it("białe znaki wokół zapisu nie psują parsowania", () => {
    expect(luminance("  #ffffff  ") as number).toBeCloseTo(refLuminance(255, 255, 255), 6);
  });
});

// ---------------------------------------------------------------------------
// Pozostałe funkcje modułu - wywołane, żeby powierzchnia miała pokrycie
// FUNKCJI, a nie tylko tej jednej gałęzi, na której siedział defekt.
// ---------------------------------------------------------------------------
const plan = (over: Partial<SocialHoverPlan> = {}): SocialHoverPlan => ({
  mode: "brand",
  tone: "amber",
  iconMode: "auto",
  rowColor: "",
  iconColor: "",
  ...over,
});

describe("socialHoverForeground - każdy tryb wiersza", () => {
  it("brand i house piszą bielą na pełnym, ciemnym gradiencie", () => {
    expect(socialHoverForeground(plan({ mode: "brand" }))).toBe("#ffffff");
    expect(socialHoverForeground(plan({ mode: "house" }))).toBe("#ffffff");
  });

  it("custom BEZ własnego koloru zostaje przy bieli (gradient jest wtedy domowy)", () => {
    expect(socialHoverForeground(plan({ mode: "custom", rowColor: "" }))).toBe("#ffffff");
  });

  it("custom z własnym kolorem przechodzi przez readableOn", () => {
    expect(socialHoverForeground(plan({ mode: "custom", rowColor: "#ffffff" }))).toBe("#141414");
    expect(socialHoverForeground(plan({ mode: "custom", rowColor: "#101010" }))).toBe("#ffffff");
    expect(socialHoverForeground(plan({ mode: "custom", rowColor: "var(--brand)" }))).toBe(
      "var(--foreground)",
    );
  });

  it("soft bierze token motywu, outline - tusz marki, none nie zmienia nic", () => {
    expect(socialHoverForeground(plan({ mode: "soft" }))).toBe("var(--foreground)");
    expect(socialHoverForeground(plan({ mode: "outline" }))).toBe("var(--brand-ink, var(--brand))");
    expect(socialHoverForeground(plan({ mode: "none" }))).toBeUndefined();
  });

  it("KAŻDY zadeklarowany tryb ma rozstrzygnięcie (żaden nie wpada przypadkiem w default)", () => {
    for (const mode of SOCIAL_ROW_HOVER_MODES) {
      const result = socialHoverForeground(plan({ mode }));
      if (mode === "none") expect(result).toBeUndefined();
      else expect(typeof result).toBe("string");
    }
  });
});

describe("socialHoverStyle - arkusz instancji dla każdego trybu", () => {
  it.each(SOCIAL_ROW_HOVER_MODES)("tryb %s buduje spójny arkusz albo świadome null", (mode) => {
    const built = socialHoverStyle(plan({ mode, rowColor: "#B85410", iconColor: "#ffffff" }));
    if (mode === "none") {
      expect(built).toBeNull();
      return;
    }
    expect(built).not.toBeNull();
    expect(built?.uid).toMatch(/^sbw-[a-z0-9]+$/i);
    expect(built?.css.length).toBeGreaterThan(0);
    // Uid MUSI zniknąć z gotowego arkusza - inaczej selektor nie istnieje.
    expect(built?.css).not.toContain("%U%");
  });

  it("gradient i kolor ikony odpowiadają na każdy tryb bez wyjątku", () => {
    for (const mode of SOCIAL_ROW_HOVER_MODES) {
      const p = plan({ mode, rowColor: "#B85410", iconColor: "#123456" });
      socialHoverGradient(p, "Facebook");
      socialHoverGradient(p, "Newsletter");
      socialHoverIconColor(p, "Facebook");
      socialHoverIconColor(p, "Newsletter");
    }
    // Sam przebieg wystarcza: kształt wyniku pilnuje socialIconsHover.test.tsx.
    expect(socialHoverGradient(plan({ mode: "none" }), "Facebook")).toBeUndefined();
  });
});
