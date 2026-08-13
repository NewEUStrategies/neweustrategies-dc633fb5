// Test jednostkowy bramki dwujęzycznego tekstu w kodzie. Konwencja repo:
// inwariant CI ma test, bo inaczej skaner nie ma jak umrzeć na czerwono, gdy
// przestanie cokolwiek widzieć - a pusta bramka brzmi identycznie jak zielona.
import { describe, expect, it } from "vitest";
import {
  compareWithRatchet,
  countsByKind,
  isScannable,
  ratchetFailed,
  scanHardcodedLanguage,
} from "@/lib/ci/hardcodedLanguage";

const one = (source: string) => scanHardcodedLanguage([{ file: "a.tsx", source }]);

describe("hardcodedLanguage - klasyfikacja", () => {
  it("literał tekstowy w dwóch językach to dług do słownika", () => {
    expect(one('const s = isPl ? "Zapisz" : "Save";')[0].kind).toBe("ternary-isPl");
    expect(one('const s = lang === "pl" ? "Zapisz" : "Save";')[0].kind).toBe("ternary-lang");
    expect(one('const s = l("Zapisz", "Save");')[0].kind).toBe("twin-helper");
  });

  it("`isPl ? \"pl\" : \"en\"` to KOD JĘZYKA, nie tekst - osobna klasa", () => {
    // Ta różnica decyduje o naprawie: tu nie ma czego przenieść do słownika,
    // trzeba użyć `uiLang(i18n.language)`.
    const hits = one('<X lang={isPl ? "pl" : "en"} />');
    expect(hits.map((h) => h.kind)).toEqual(["manual-lang-code"]);
  });

  it("identyczne gałęzie to defekt, nie tłumaczenie", () => {
    const hits = one('const s = lang === "pl" ? "Slug" : "Slug";');
    expect(hits.map((h) => h.kind)).toEqual(["same-both-branches"]);
  });

  it("jedno miejsce daje JEDNO trafienie, nie po jednym na wzorzec", () => {
    // `isPl ? "pl" : "en"` pasuje i do klasy kodu języka, i do klasy ogólnej.
    expect(one('const l = isPl ? "pl" : "en";')).toHaveLength(1);
  });

  it("wybór KOLUMNY jest poza zasięgiem - to robota pickLocalized", () => {
    expect(one("const title = isPl ? row.title_pl : row.title_en;")).toEqual([]);
  });

  it("komentarze są maskowane - bramka nie liczy własnej dokumentacji", () => {
    expect(one('// przykład: isPl ? "Zapisz" : "Save"')).toEqual([]);
    expect(one('/* isPl ? "Zapisz" : "Save" */')).toEqual([]);
  });

  it("numer linii wskazuje realną linię pliku", () => {
    const hits = one(['const a = 1;', 'const b = 2;', 'const s = isPl ? "A" : "B";'].join("\n"));
    expect(hits[0].line).toBe(3);
  });

  it("słowniki i testy są poza skanem", () => {
    expect(isScannable("src/components/X.tsx")).toBe(true);
    expect(isScannable("src/lib/i18n-club.ts")).toBe(false);
    expect(isScannable("src/lib/locale/pl.ts")).toBe(false);
    expect(isScannable("src/lib/__tests__/x.ts")).toBe(false);
    expect(isScannable("src/lib/x.test.tsx")).toBe(false);
  });

  it("rozkład na klasy jest raportowalny", () => {
    // Literały krótsze niż dwa znaki są celowo poza wzorcem bliźniaka - inaczej
    // łapałby wywołania w rodzaju `t("a", "b")` i sypał szumem.
    const hits = one(['const a = isPl ? "Tak" : "Yes";', 'const c = l("Tak", "Yes");'].join("\n"));
    expect(countsByKind(hits).get("ternary-isPl")).toBe(1);
    expect(countsByKind(hits).get("twin-helper")).toBe(1);
  });

  it("jednoznakowe literały NIE są bliźniakiem - próg dwóch znaków tłumi szum", () => {
    expect(one('const c = l("a", "b");')).toEqual([]);
  });
});

describe("hardcodedLanguage - ratchet", () => {
  const hits = one('const a = isPl ? "A" : "B";');

  it("plik poza baseline'em z długiem oblewa - nowy kod startuje od zera", () => {
    const report = compareWithRatchet(hits, new Map());
    expect(report.fresh.map((entry) => entry.file)).toEqual(["a.tsx"]);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("wzrost w znanym pliku oblewa", () => {
    const report = compareWithRatchet(hits, new Map([["a.tsx", 0]]));
    expect(report.grown).toEqual([{ file: "a.tsx", was: 0, now: 1 }]);
    expect(ratchetFailed(report)).toBe(true);
  });

  it("stan równy baseline'owi przechodzi", () => {
    expect(ratchetFailed(compareWithRatchet(hits, new Map([["a.tsx", 1]])))).toBe(false);
  });

  it("POPRAWA nie oblewa, ale jest raportowana do odświeżenia listy", () => {
    // Inaczej każde ścięcie kilku wystąpień wymuszałoby edycję baseline'u w tym
    // samym commicie - i zniechęcało do drobnych porządków.
    const report = compareWithRatchet(hits, new Map([["a.tsx", 5]]));
    expect(ratchetFailed(report)).toBe(false);
    expect(report.improved).toEqual([{ file: "a.tsx", was: 5, now: 1 }]);
  });

  it("plik wyczyszczony do zera też jest raportowany jako poprawa", () => {
    const report = compareWithRatchet([], new Map([["a.tsx", 3]]));
    expect(report.improved).toEqual([{ file: "a.tsx", was: 3, now: 0 }]);
    expect(ratchetFailed(report)).toBe(false);
  });
});
