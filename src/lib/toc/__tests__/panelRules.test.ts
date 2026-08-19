// Reguły panelu spisu treści wyprowadzone z pliku trasy.
//
// KAŻDY deskryptor zwraca KLUCZ i18n, nie tekst - test może więc sprawdzić
// „jaki klucz i jaki kształt", a brzmienie etykiety zostaje sprawą słownika.
// Wcześniej te same decyzje siedziały w warunkach wewnątrz JSX i były pisane po
// polsku na sztywno, więc dla czytelnika EN panel był w połowie polski.
import { describe, it, expect } from "vitest";
import {
  TOC_HEADING_LEVELS,
  TOC_MIN_HEADINGS_BOUNDS,
  TOC_POSITION_BOUNDS,
  tocColorFields,
  tocColumnDescriptors,
  tocLayoutLabelKey,
  tocLayoutOptions,
  tocLevelOptions,
  tocPreviewHeadings,
  tocPreviewIndent,
  tocPreviewListClass,
  tocPreviewListTag,
  tocPreviewStyle,
  tocPreviewTitle,
  tocPreviewWrapperClass,
} from "@/lib/toc/panelRules";
import { TOC_COLUMNS, TOC_DEFAULTS, TOC_LAYOUTS } from "@/lib/toc/settings";

describe("granice pól liczbowych", () => {
  it("pokrywają się ze schematem ustawień (UI i baza nie mogą mieć dwóch zdań)", () => {
    expect(TOC_POSITION_BOUNDS).toEqual({ min: -1, max: 20 });
    expect(TOC_MIN_HEADINGS_BOUNDS).toEqual({ min: 1, max: 20 });
  });
});

describe("tocLayoutOptions / tocLayoutLabelKey", () => {
  it("każdy układ ze schematu ma opcję, w tej samej kolejności", () => {
    expect(tocLayoutOptions().map((o) => o.value)).toEqual([...TOC_LAYOUTS]);
    expect(tocLayoutOptions()).toHaveLength(3);
  });

  it("klucz etykiety jest zbudowany z wartości, nie z tekstu", () => {
    expect(tocLayoutLabelKey("boxed")).toBe("admin.toc.layoutOption.boxed");
    expect(tocLayoutLabelKey("sticky-sidebar")).toBe("admin.toc.layoutOption.sticky-sidebar");
  });

  it("KAŻDY układ ma WŁASNY klucz (nie jedna wspólna nazwa)", () => {
    const keys = tocLayoutOptions().map((o) => o.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith("admin.toc.layoutOption."))).toBe(true);
  });
});

describe("tocColumnDescriptors - karty wyboru kolumn", () => {
  it("trzy warianty ze schematu, każdy z etykietą i podpowiedzią", () => {
    const cols = tocColumnDescriptors();
    expect(cols.map((c) => c.value)).toEqual([...TOC_COLUMNS]);
    expect(cols.every((c) => c.labelKey.length > 0 && c.hintKey.length > 0)).toBe(true);
  });

  it("`col-2` rysuje DWA paski, pozostałe jeden", () => {
    const bars = new Map(tocColumnDescriptors().map((c) => [c.value, c.bars]));
    expect(bars.get("col-2")).toBe(2);
    expect([bars.get("col-1"), bars.get("half")]).toEqual([1, 1]);
  });

  it("tylko wariant `half` ma wąską miniaturę", () => {
    const narrow = tocColumnDescriptors()
      .filter((c) => c.narrowThumb)
      .map((c) => c.value);
    expect(narrow).toEqual(["half"]);
    expect(tocColumnDescriptors().filter((c) => !c.narrowThumb)).toHaveLength(2);
  });

  it("etykieta i podpowiedź to RÓŻNE klucze (podpowiedź nie powtarza nazwy)", () => {
    for (const col of tocColumnDescriptors()) {
      expect(col.labelKey).not.toBe(col.hintKey);
      expect(col.hintKey).toContain(col.value);
    }
  });
});

describe("tocLevelOptions - zakres poziomów nagłówka", () => {
  it("zawsze sześć opcji, H1..H6", () => {
    expect(tocLevelOptions("min", { minLevel: 2, maxLevel: 3 })).toHaveLength(6);
    expect(TOC_HEADING_LEVELS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("dolna granica nie może przeskoczyć górnej", () => {
    const opts = tocLevelOptions("min", { minLevel: 2, maxLevel: 3 });
    expect(opts.filter((o) => o.disabled).map((o) => o.level)).toEqual([4, 5, 6]);
    expect(opts.filter((o) => !o.disabled).map((o) => o.level)).toEqual([1, 2, 3]);
  });

  it("górna granica nie może zejść pod dolną", () => {
    const opts = tocLevelOptions("max", { minLevel: 3, maxLevel: 5 });
    expect(opts.filter((o) => o.disabled).map((o) => o.level)).toEqual([1, 2]);
    expect(opts.filter((o) => !o.disabled).map((o) => o.level)).toEqual([3, 4, 5, 6]);
  });

  it("przy zwiniętym zakresie (min = max) obie listy zostawiają tę jedną wartość", () => {
    const min = tocLevelOptions("min", { minLevel: 4, maxLevel: 4 });
    const max = tocLevelOptions("max", { minLevel: 4, maxLevel: 4 });
    expect(min.find((o) => o.level === 4)?.disabled).toBe(false);
    expect(max.find((o) => o.level === 4)?.disabled).toBe(false);
  });

  it("pełny zakres H1..H6 nie wyłącza niczego", () => {
    const opts = tocLevelOptions("min", { minLevel: 1, maxLevel: 6 });
    expect(opts.some((o) => o.disabled)).toBe(false);
    expect(tocLevelOptions("max", { minLevel: 1, maxLevel: 6 }).some((o) => o.disabled)).toBe(
      false,
    );
  });
});

describe("tocColorFields - pola koloru", () => {
  it("siedem pól, dokładnie te, które ma schemat kolorów", () => {
    const keys = tocColorFields().map((f) => f.key);
    expect(keys).toHaveLength(7);
    expect([...keys].sort()).toEqual(Object.keys(TOC_DEFAULTS.colors).sort());
  });

  it("każde pole ma własny klucz etykiety zbudowany z nazwy pola", () => {
    for (const field of tocColorFields()) {
      expect(field.labelKey).toBe(`admin.toc.colorField.${field.key}`);
    }
    expect(new Set(tocColorFields().map((f) => f.labelKey)).size).toBe(7);
  });

  it("kolejność jest jawna: para jasny/ciemny obok siebie, akcent na końcu", () => {
    expect(tocColorFields().map((f) => f.key)).toEqual([
      "bg",
      "bgDark",
      "border",
      "borderDark",
      "text",
      "textDark",
      "accent",
    ]);
    expect(tocColorFields().at(-1)?.key).toBe("accent");
  });
});

describe("tocPreviewHeadings - nagłówki podglądu", () => {
  it("domyślny zakres H2..H3 zostawia pięć nagłówków, bez H1", () => {
    const headings = tocPreviewHeadings({ minLevel: 2, maxLevel: 3 });
    expect(headings).toHaveLength(5);
    expect(headings.some((h) => h.level === 1)).toBe(false);
  });

  it("zakres H1..H3 wpuszcza nagłówek główny", () => {
    const headings = tocPreviewHeadings({ minLevel: 1, maxLevel: 3 });
    expect(headings).toHaveLength(6);
    expect(headings[0]?.level).toBe(1);
  });

  it("zakres bez pokrycia daje PUSTĄ listę, nie wyjątek", () => {
    expect(tocPreviewHeadings({ minLevel: 5, maxLevel: 6 })).toEqual([]);
    expect(tocPreviewHeadings({ minLevel: 4, maxLevel: 4 })).toHaveLength(0);
  });

  it("każdy nagłówek ma klucz tekstu i UNIKALNĄ zakotwicę", () => {
    const headings = tocPreviewHeadings({ minLevel: 1, maxLevel: 6 });
    expect(headings.every((h) => h.textKey.startsWith("admin.toc.sample."))).toBe(true);
    expect(new Set(headings.map((h) => h.anchor)).size).toBe(headings.length);
  });
});

describe("tocPreviewIndent - wcięcie pozycji", () => {
  it("nagłówek na dolnej granicy nie ma wcięcia", () => {
    expect(tocPreviewIndent(2, 2)).toBe(0);
    expect(tocPreviewIndent(1, 1)).toBe(0);
  });

  it("każdy kolejny poziom to dwanaście pikseli", () => {
    expect(tocPreviewIndent(3, 2)).toBe(12);
    expect(tocPreviewIndent(4, 2)).toBe(24);
  });

  it("poziom PONAD dolną granicą nie daje wcięcia ujemnego", () => {
    expect(tocPreviewIndent(1, 3)).toBe(0);
    expect(tocPreviewIndent(2, 6)).toBe(0);
  });
});

describe("tocPreviewStyle - kolory i zmienne CSS podglądu", () => {
  it("wystawia SIEDEM zmiennych CSS spisu treści", () => {
    const style = tocPreviewStyle(TOC_DEFAULTS) as Record<string, string>;
    const vars = Object.keys(style).filter((k) => k.startsWith("--toc-"));
    expect(vars).toHaveLength(7);
    expect(style["--toc-accent"]).toBe(TOC_DEFAULTS.colors.accent);
  });

  it("układ `inline` nie rysuje ramki, pozostałe rysują ją kolorem z ustawień", () => {
    const inline = tocPreviewStyle({ ...TOC_DEFAULTS, layout: "inline" }) as Record<string, string>;
    const boxed = tocPreviewStyle({ ...TOC_DEFAULTS, layout: "boxed" }) as Record<string, string>;
    expect(inline.border).toBe("none");
    expect(boxed.border).toBe(`1px solid ${TOC_DEFAULTS.colors.border}`);
  });

  it("tło i kolor tekstu idą z ustawień jasnego motywu", () => {
    const style = tocPreviewStyle({
      ...TOC_DEFAULTS,
      colors: { ...TOC_DEFAULTS.colors, bg: "#123456", text: "#abcdef" },
    }) as Record<string, string>;
    expect(style.background).toBe("#123456");
    expect(style.color).toBe("#abcdef");
  });
});

describe("tocPreviewWrapperClass / tocPreviewListClass / tocPreviewListTag", () => {
  it("układ `inline` gubi zaokrąglenie, pozostałe je mają", () => {
    expect(tocPreviewWrapperClass({ ...TOC_DEFAULTS, layout: "inline" })).not.toContain(
      "rounded-lg",
    );
    expect(tocPreviewWrapperClass({ ...TOC_DEFAULTS, layout: "boxed" })).toContain("rounded-lg");
  });

  it("`sticky` dokłada przyklejenie, brak `sticky` nie", () => {
    expect(tocPreviewWrapperClass({ ...TOC_DEFAULTS, sticky: true })).toContain("lg:sticky");
    expect(tocPreviewWrapperClass({ ...TOC_DEFAULTS, sticky: false })).not.toContain("lg:sticky");
  });

  it("wariant `half` ogranicza szerokość do połowy", () => {
    expect(tocPreviewWrapperClass({ ...TOC_DEFAULTS, columns: "half" })).toContain(
      "md:max-w-[50%]",
    );
    expect(tocPreviewWrapperClass({ ...TOC_DEFAULTS, columns: "col-1" })).not.toContain("max-w-");
  });

  it("lista numerowana i punktowana mają różne klasy ORAZ różny znacznik", () => {
    expect(tocPreviewListClass({ ...TOC_DEFAULTS, ordered: true })).toContain("list-decimal");
    expect(tocPreviewListClass({ ...TOC_DEFAULTS, ordered: false })).toContain("list-disc");
    expect(tocPreviewListTag({ ...TOC_DEFAULTS, ordered: true })).toBe("ol");
    expect(tocPreviewListTag({ ...TOC_DEFAULTS, ordered: false })).toBe("ul");
  });

  it("`col-2` dzieli listę na dwie kolumny i pilnuje, by pozycja się nie łamała", () => {
    const two = tocPreviewListClass({ ...TOC_DEFAULTS, columns: "col-2" });
    expect(two).toContain("sm:columns-2");
    expect(two).toContain("break-inside-avoid");
  });

  it("klasy nie mają pustych członów po odsianiu warunków", () => {
    const wrapper = tocPreviewWrapperClass({ ...TOC_DEFAULTS, layout: "inline", sticky: false });
    expect(wrapper).not.toMatch(/\s{2}/);
    expect(wrapper.trim()).toBe(wrapper);
  });
});

describe("tocPreviewTitle - tytuł w języku zakładki", () => {
  it("zakładka PL bierze tytuł polski, EN angielski", () => {
    const settings = { ...TOC_DEFAULTS, titlePl: "Spis", titleEn: "Contents" };
    expect(tocPreviewTitle(settings, "pl")).toBe("Spis");
    expect(tocPreviewTitle(settings, "en")).toBe("Contents");
  });

  it("pusty tytuł jest oddawany jako pusty, bez podstawiania drugiego języka", () => {
    const settings = { ...TOC_DEFAULTS, titlePl: "", titleEn: "Contents" };
    expect(tocPreviewTitle(settings, "pl")).toBe("");
    expect(tocPreviewTitle(settings, "en")).toBe("Contents");
  });
});
