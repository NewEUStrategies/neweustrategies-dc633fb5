// Testy wycinania komentarzy TS dla bramek statycznych.
//
// PO CO OSOBNY PLIK: bramka `check:sql-app-role` skanowała `.ts/.tsx` jako goły
// tekst i wywalała CI na WŁASNEJ dokumentacji - komentarz cytujący wzorzec
// `has_role(uid, 'rola')` liczył się jak żywe wywołanie (cztery doby czerwonego
// kroku w `verify`). Wycinanie komentarzy naprawia fałszywe POZYTYWY, ale zrobione
// regexem wprowadziłoby fałszywe NEGATYWY: `"https://…"` albo `'/*'` w literale
// zjadłyby resztę pliku razem z prawdziwymi wywołaniami. Stąd parser znakowy - i
// stąd te testy.
//
// Ten katalog jest jednocześnie jedynym miejscem, gdzie bramka app_role NIE
// skanuje literałów (fixture'y analizatora), więc można tu trzymać przypadki
// brzegowe bez oszukiwania bramki.
import { describe, expect, it } from "vitest";
import { stripTsComments } from "../../../../scripts/lib/stripComments";

describe("stripTsComments", () => {
  it("wycina komentarz liniowy, zostawia kod", () => {
    const out = stripTsComments(`const a = 1; // has_role(uid, 'rola')\nconst b = 2;`);
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
    expect(out).not.toContain("rola");
  });

  it("wycina komentarz blokowy, także wielolinijkowy", () => {
    const out = stripTsComments(`/* has_role(uid, 'X')\n   druga linia */\nconst a = 1;`);
    expect(out).not.toContain("'X'");
    expect(out).toContain("const a = 1;");
  });

  it("ZACHOWUJE numery linii (komunikaty bramek wskazują to samo miejsce)", () => {
    const source = `// komentarz\n/* blok\n   blok */\nconst a = 1;`;
    expect(stripTsComments(source).split("\n")).toHaveLength(source.split("\n").length);
    expect(stripTsComments(source).split("\n")[3]).toBe("const a = 1;");
  });

  it("NIE tyka `//` ani `/*` wewnątrz literałów tekstowych", () => {
    const single = stripTsComments(`const url = 'https://example.test/a'; const g = '/*';`);
    expect(single).toContain("'https://example.test/a'");
    expect(single).toContain("'/*'");

    const double = stripTsComments(`const url = "https://example.test/b";`);
    expect(double).toContain('"https://example.test/b"');
  });

  it("zachowuje treść szablonów (z interpolacją i nowymi liniami)", () => {
    const out = stripTsComments("const q = `select 1\n  from t`; // ogon");
    expect(out).toContain("select 1");
    expect(out).toContain("from t");
    expect(out).not.toContain("ogon");
  });

  it("nie zjada pliku po niedomkniętym apostrofie w jednej linii", () => {
    const out = stripTsComments(`const a = 'nie domkniete\nconst b = 2;`);
    expect(out).toContain("const b = 2;");
  });

  it("escape'y w literałach nie kończą literału przedwcześnie", () => {
    const out = stripTsComments(`const a = 'it\\'s'; // ogon\nconst b = 2;`);
    expect(out).toContain("it\\'s");
    expect(out).not.toContain("ogon");
    expect(out).toContain("const b = 2;");
  });

  it("plik bez komentarzy wraca bajt w bajt", () => {
    const source = `const a = 1;\nconst b = "x";\n`;
    expect(stripTsComments(source)).toBe(source);
  });
});
