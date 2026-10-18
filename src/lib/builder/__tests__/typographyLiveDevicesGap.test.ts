// Typografia widgetu poza szablonem HW-2: generator dla wartości spoza białej
// listy, podgląd na żywo per urządzenie i odstęp tytuł-opis z danych importu.
//
// Dowodzimy kontraktów, które widzi redakcja na kanwie i czytelnik na stronie:
//  * rozmiar spoza białej listy (np. `clamp()`) dostaje w podglądzie na żywo
//    warianty per urządzenie - pod tym samym przodkiem, którym renderer i kanwa
//    przełączają układ - więc mobile pokazuje rozmiar mobile;
//  * każda „wspólna" właściwość typografii (krój, grubość, styl, interlinia,
//    światło, transformacja, dekoracja, wyrównanie) trafia do JEDNEJ deklaracji,
//    a znaki pozwalające wyjść z deklaracji lub z `<style>` są usuwane;
//  * odstęp tytuł-opis zapisany napisem (import, ręczny JSON) jest liczbą tylko
//    wtedy, gdy napis JEST liczbą - pusty napis nie skleja tytułu z opisem;
//  * zablokowany `BroadcastChannel` nie odcina podglądu w tej samej karcie.
//
// Granica: `BroadcastChannel` (API przeglądarki) podmieniony na rzucający
// konstruktor tylko w ostatnim teście. Reszta to czyste funkcje.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLiveWidgetTypographyCss, buildWidgetTypographyCss } from "../typographyCss";
import {
  broadcastWidgetTypography,
  normalizeTypographyGapPx,
  subscribeWidgetTypography,
  widgetTypographyTemplate,
} from "../liveTypography";

/** Reguły z deklaracją `font-size` pogrupowane po przodku urządzenia. */
function sizesByAncestor(css: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const rule of css.split("\n")) {
    const size = /\{font-size:([^!]+) !important;\}/.exec(rule)?.[1];
    if (!size) continue;
    const device = /^\[data-(builder-renderer|visual-canvas)\]\[data-device="(\w+)"\]/.exec(rule);
    const key = device ? `${device[1]}:${device[2]}` : "baza";
    (out[key] ??= []).push(size);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...new Set(v)]]));
}

describe("podgląd na żywo - rozmiar spoza białej listy per urządzenie", () => {
  it("baza ma rozmiar desktopu, a renderer i kanwa dostają warianty tabletu i mobile", () => {
    const css = buildLiveWidgetTypographyCss("w1", {
      fontSize: { desktop: "clamp(1rem, 3vw, 2rem)", mobile: "1.1rem" },
    });
    expect(sizesByAncestor(css)).toEqual({
      baza: ["clamp(1rem, 3vw, 2rem)"],
      "builder-renderer:tablet": ["clamp(1rem, 3vw, 2rem)"],
      "visual-canvas:tablet": ["clamp(1rem, 3vw, 2rem)"],
      "builder-renderer:mobile": ["1.1rem"],
      "visual-canvas:mobile": ["1.1rem"],
    });
  });

  it("rozmiary z białej listy zostają w szablonie - generator dokłada tylko resztę", () => {
    const css = buildLiveWidgetTypographyCss("w1", {
      fontSize: { desktop: "28px", mobile: "18px" },
      fontWeight: "800",
    });
    expect(css).toContain("font-weight:800 !important;");
    expect(css).not.toContain("font-size");
    expect(css).not.toContain("data-device");
    expect(buildLiveWidgetTypographyCss("w1", { fontSize: { desktop: "28px" } })).toBe("");
  });
});

describe("generator - wspólne właściwości typografii", () => {
  it("każda właściwość trafia do jednej deklaracji wspólnej dla wszystkich celów tekstu", () => {
    const css = buildWidgetTypographyCss(
      "w2",
      {
        fontFamily: "Inter, sans-serif",
        fontWeight: "600",
        fontStyle: "italic",
        lineHeight: "1.5",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        textDecoration: "underline",
        textAlign: "center",
      },
      "desktop",
    );
    const blocks = css.split("\n").filter((rule) => rule.includes("font-weight:600"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain(
      "{font-family:Inter, sans-serif !important;font-weight:600 !important;" +
        "font-style:italic !important;line-height:1.5 !important;" +
        "letter-spacing:0.05em !important;text-transform:uppercase !important;" +
        "text-decoration:underline !important;text-align:center !important;}",
    );
  });

  it("wartość z panelu nie wychodzi z deklaracji ani z bloku <style>", () => {
    const css = buildWidgetTypographyCss(
      "w2",
      { fontFamily: "Inter;}</style><script>x</script>{", fontWeight: " " },
      "desktop",
    );
    expect(css).toContain("font-family:Inter/stylescriptx/script !important;");
    expect(css).not.toMatch(/<|>/);
    expect(css).not.toContain("font-weight");
  });
});

describe("odstęp tytuł-opis zapisany napisem", () => {
  it("liczba z opcjonalnym px jest przycinana do 0-200", () => {
    expect(normalizeTypographyGapPx("12px")).toBe(12);
    expect(normalizeTypographyGapPx(" 8 PX ")).toBe(8);
    expect(normalizeTypographyGapPx("7.5")).toBe(7.5);
    expect(normalizeTypographyGapPx("-4px")).toBe(0);
    expect(normalizeTypographyGapPx("999")).toBe(200);
    expect(normalizeTypographyGapPx(Number.NaN)).toBeUndefined();
    expect(normalizeTypographyGapPx(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  // NAPRAWIONE 2026-10-18 (defekt znaleziony przy pisaniu testów):
  // WEJSCIE: `titleDescriptionGapPx: ""` (pole wyczyszczone w imporcie / JSON-ie)
  //   albo tekst bez liczby, obok innej typografii widgetu.
  // BYŁO: `Number("".replace(...))` dawało 0, więc ramka ustawiała jawny odstęp
  //   0 px (tytuł sklejony z opisem), a panel pokazywał puste pole „domyślny".
  // KONTRAKT: napis bez liczby to brak odstępu - bez tokenu `g` w `data-wt`.
  it("pusty napis i tekst bez liczby nie ustawiają odstępu 0 px", () => {
    for (const raw of ["", "  ", "auto", "px", "12rem", "1.2.3"]) {
      expect(normalizeTypographyGapPx(raw)).toBeUndefined();
    }
    const template = widgetTypographyTemplate({
      fontWeight: "700",
      titleDescriptionGapPx: "" as unknown as number,
    });
    expect(template.tokens).toBeUndefined();
  });
});

describe("podgląd na żywo bez BroadcastChannel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zablokowany kanał (tryb prywatny, polityka) nie odcina podglądu w tej karcie", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("zablokowane", "SecurityError");
        }
      },
    );
    const seen: unknown[] = [];
    const stop = subscribeWidgetTypography("w-bc", (t) => seen.push(t));
    broadcastWidgetTypography("w-bc", { fontSize: { desktop: "22px" } });
    stop();
    broadcastWidgetTypography("w-bc", undefined);
    expect(seen).toEqual([{ fontSize: { desktop: "22px" } }]);
  });
});
