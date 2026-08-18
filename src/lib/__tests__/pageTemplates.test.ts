// SZABLONY STRON - `pageTemplates.ts`. Do 18.08.2026: 0 z 2 funkcji.
// To najsłabsza funkcjonalność całego modułu 4 (3,7% linii).
//
// `findPageTemplate` dostaje wartość Z BAZY (kolumna `page_template`), czyli
// napis, który mógł zostać zapisany przez starszą wersję panelu, import albo
// migrację. Od jego rozstrzygnięcia zależy, czy strona dostanie nagłówek
// i stopkę - nieznana wartość NIE MOŻE dać `undefined`, bo trasa `$.tsx`
// czytałaby wtedy `.bare` z niczego i wywracała render strony publicznej.
import { describe, expect, it } from "vitest";
import { PAGE_TEMPLATES, findPageTemplate, type PageTemplateType } from "@/lib/pageTemplates";

describe("findPageTemplate", () => {
  it("znajduje szablon po identyfikatorze", () => {
    expect(findPageTemplate("landing").id).toBe("landing");
    expect(findPageTemplate("archive_listing").id).toBe("archive_listing");
    expect(findPageTemplate("contact").id).toBe("contact");
  });

  it("NIEZNANY identyfikator spada na szablon standardowy", () => {
    // Wartość z bazy sprzed zmiany katalogu szablonów nie może zostawić trasy
    // bez specyfikacji - to byłby biały ekran na stronie publicznej.
    expect(findPageTemplate("wordpress-legacy-template").id).toBe("default");
  });

  it("brak wartości też spada na standardowy", () => {
    expect(findPageTemplate(null).id).toBe("default");
    expect(findPageTemplate(undefined).id).toBe("default");
    expect(findPageTemplate("").id).toBe("default");
  });

  it("dopasowanie jest ŚCISŁE - wielkość liter ma znaczenie", () => {
    // Pin na stan dzisiejszy: „Landing” nie jest tym samym co „landing”.
    // Gdyby kiedyś miało być, to zmiana zachowania, a nie szczegół.
    expect(findPageTemplate("Landing").id).toBe("default");
    expect(findPageTemplate(" landing ").id).toBe("default");
  });

  it("NIGDY nie zwraca undefined - dla żadnego wejścia", () => {
    for (const input of ["", "x", "landing", "DEFAULT", "null", "undefined"]) {
      const spec = findPageTemplate(input);
      expect(spec).toBeTruthy();
      expect(typeof spec.bare).toBe("boolean");
      expect(typeof spec.fullWidth).toBe("boolean");
    }
  });

  it("pierwszy szablon katalogu JEST szablonem awaryjnym", () => {
    // Fallback bierze `PAGE_TEMPLATES[0]`, więc kolejność w katalogu jest
    // decyzją, nie kosmetyką: przestawienie „landing” na początek zabrałoby
    // nagłówek i stopkę każdej stronie o nieznanym szablonie.
    expect(PAGE_TEMPLATES[0].id).toBe("default");
    expect(findPageTemplate("nieznany")).toBe(PAGE_TEMPLATES[0]);
  });
});

describe("PAGE_TEMPLATES - katalog", () => {
  it("identyfikatory są unikalne", () => {
    const ids = PAGE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("każdy szablon ma etykietę i opis w OBU językach", () => {
    // Brak wersji angielskiej oznacza polski napis w panelu EN - dokładnie ta
    // klasa dziur, którą pilnują bramki i18n w tym repo.
    for (const spec of PAGE_TEMPLATES) {
      expect(spec.label_pl.length, spec.id).toBeGreaterThan(0);
      expect(spec.label_en.length, spec.id).toBeGreaterThan(0);
      expect(spec.description_pl.length, spec.id).toBeGreaterThan(0);
      expect(spec.description_en.length, spec.id).toBeGreaterThan(0);
    }
  });

  it("wersje językowe nie są swoimi kopiami", () => {
    // Skopiowany polski tekst w polu angielskim przechodzi każdą bramkę
    // „klucz istnieje”, a użytkownik EN i tak widzi polszczyznę.
    for (const spec of PAGE_TEMPLATES) {
      expect(spec.label_pl, spec.id).not.toBe(spec.label_en);
      expect(spec.description_pl, spec.id).not.toBe(spec.description_en);
    }
  });

  it("tylko landing zdejmuje nagłówek i stopkę", () => {
    // `bare` decyduje o obecności chrome'u na stronie publicznej - to
    // najbardziej widoczna flaga w tym katalogu.
    const bare = PAGE_TEMPLATES.filter((t) => t.bare).map((t) => t.id);
    expect(bare).toEqual(["landing"]);
  });

  it("każdy szablon bez chrome'u jest też pełnej szerokości", () => {
    // Czyste płótno z ograniczeniem `max-width` byłoby sprzecznością.
    for (const spec of PAGE_TEMPLATES.filter((t) => t.bare)) {
      expect(spec.fullWidth, spec.id).toBe(true);
    }
  });

  it("szablon standardowy jest najbardziej zachowawczy", () => {
    const def = findPageTemplate("default");
    expect(def.bare).toBe(false);
    expect(def.fullWidth).toBe(false);
  });

  it("katalog pokrywa DOKŁADNIE typ szablonu - bez luk i bez nadmiaru", () => {
    // Dopisanie wariantu do typu bez wpisu w katalogu daje szablon, którego
    // panel nie pokaże, a `findPageTemplate` cicho zamieni na standardowy.
    const expected: PageTemplateType[] = [
      "default",
      "full_width",
      "landing",
      "archive_listing",
      "contact",
    ];
    expect(PAGE_TEMPLATES.map((t) => t.id).sort()).toEqual([...expected].sort());
  });
});
