// CZYSTE FUNKCJE importu/eksportu CSV słownika imion - tabele `it.each`.
//
// CO TEN PLIK DOWODZI.
// Cała ta logika mieszkała do teraz w `src/routes/admin.names.tsx` i miała 0%
// pokrycia, bo jedyną drogą do niej było klikanie: zbuduj `File`, podaj go do
// ukrytego inputu, przeczytaj wynik z tabeli podglądu. Po wyprowadzeniu do
// `src/lib/admin/namesCsv.ts` te reguły są funkcjami - jedno wejście, jedno
// wyjście - więc sprawdza je tu TABELA, wariant po wariancie:
//
//   1. KSZTAŁT PLIKU: pusty, BOM, separator `;`, cudzysłowy (cudzysłów
//      wewnątrz pola ORAZ przecinek wewnątrz cudzysłowów), CRLF vs LF, wiersz
//      z samymi separatorami, brak końcowego przełamania.
//   2. MAPOWANIE KOLUMN: nagłówek w innej kolejności, brakujące kolumny,
//      aliasy dwujęzyczne i bezdiakrytyczne (`wolacz`/`wołacz`).
//   3. POLSKIE ZNAKI: `ł ą ę ó ś ż ź ć ń` w formach gramatycznych NIE MOGĄ
//      zginąć ani w imporcie, ani w eksporcie - to jest cała wartość tego
//      słownika, bo z niego bierze się wołacz w powitaniu użytkownika.
//   4. DEDUPE PO `key` Z UZUPEŁNIANIEM: duplikat nie jest odrzucany z
//      automatu - jeśli wnosi wartość do PUSTEJ kolumny, wchodzi do scalenia,
//      a łatka nigdy nie nadpisuje tego, co redakcja wpisała ręcznie.
//   5. NORMALIZACJA KRAJU: kod ISO, nazwa PL, nazwa EN, przymiotnik językowy
//      i zapis z kropkami dają JEDEN kanoniczny kod - inaczej filtr kraju
//      rozjeżdża się na trzy warianty tego samego państwa.
//   6. ROUND TRIP: eksport zaimportowany z powrotem daje te same pola.
//      To jedyna asercja, która pilnuje ZGODNOŚCI dwóch niezależnych list
//      nazw kolumn (`NAMES_CSV_COLUMNS` w eksporcie vs aliasy w imporcie).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - SKLEJENIA TRASY: że panel woła te funkcje, pokazuje ich wynik w podglądzie
//   i respektuje decyzję „dodaj/scal/pomiń” przy zapisie - to jest przedmiotem
//   `src/routes/__tests__/adminNamesRoute.test.tsx`. Tutaj nie ma ani jednego
//   renderu.
// - `normalize()` z `@/lib/greetings/greetings` - własny test silnika powitań.
//   Tu używamy go PRAWDZIWEGO (nie atrapy), bo klucz dedupe musi zgadzać się
//   z kluczem, po którym powitanie szuka wołacza; atrapa ukryłaby rozjazd.
// - AUTORYTETU BAZY: unikalność `key`, NOT NULL na `gender`, RLS na
//   `name_dictionary`. Funkcja buduje ŁADUNEK; czy baza go przyjmie, rozstrzyga
//   warstwa SQL.
//
// DEFEKTY ZGŁOSZONE `it.fails` (produkcja bez naprawy - konwencja repo):
// cztery sztuki, każdy z opisem przy swoim teście na końcu pliku.
import { describe, expect, it } from "vitest";
import {
  NAMES_CSV_COLUMNS,
  NAME_MERGE_CHECK_FIELDS,
  NAME_ORIGIN_COUNTRIES,
  buildNameInsertPayload,
  buildNameMergePatch,
  classifyNameImportRow,
  escapeCsvValue,
  indexNamesByKey,
  nameRowKey,
  normalizeCountryInput,
  normalizeCsvHeaders,
  parseCsvMatrix,
  parseNameCsvRow,
  parseNamesCsv,
  planNamesImport,
  resolveCountry,
  resolveOriginCode,
  serializeNamesCsv,
  type NameDictionaryFields,
  type NameImportAction,
  type ParsedNameCsvRow,
} from "@/lib/admin/namesCsv";

/** Znacznik kolejności bajtów, jaki Excel dokłada przed pierwszym znakiem pliku. */
const BOM = "﻿";

/**
 * Wiersz słownika w kształcie, jaki widzi dedupe. Wszystko puste domyślnie -
 * test dopisuje TYLKO to, co jest przedmiotem dowodu, więc z sygnatury wywołania
 * widać, która kolumna decyduje o wyniku.
 */
function dictRow(overrides: Partial<NameDictionaryFields> = {}): NameDictionaryFields {
  return {
    name: "Anna",
    name_normalized: "anna",
    key: "anna",
    display_name: "Anna",
    gender: "female",
    origin_country: null,
    origin: null,
    vocative_pl: null,
    instrumental_pl: null,
    genitive_pl: null,
    dative_pl: null,
    vocative_en: null,
    english_form: null,
    is_compound: false,
    notes: null,
    ...overrides,
  };
}

/** Wiersz CSV po zmapowaniu - jak `dictRow`, tylko dla strony wejściowej. */
function csvRow(overrides: Partial<ParsedNameCsvRow> = {}): ParsedNameCsvRow {
  return {
    key: "anna",
    display_name: "Anna",
    vocative_pl: null,
    instrumental_pl: null,
    genitive_pl: null,
    dative_pl: null,
    english_form: null,
    gender: "female",
    is_compound: false,
    origin: null,
    notes: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. KSZTAŁT PLIKU
// ---------------------------------------------------------------------------

describe("parseCsvMatrix - kształt pliku", () => {
  const cases: { nazwa: string; text: string; matrix: string[][] }[] = [
    { nazwa: "plik pusty", text: "", matrix: [] },
    { nazwa: "same białe znaki", text: "   \n \t \n", matrix: [] },
    { nazwa: "sam nagłówek, LF", text: "key,display_name", matrix: [["key", "display_name"]] },
    {
      nazwa: "LF - dwa wiersze",
      text: "key,display_name\nanna,Anna",
      matrix: [
        ["key", "display_name"],
        ["anna", "Anna"],
      ],
    },
    {
      nazwa: "CRLF - wynik identyczny jak LF",
      text: "key,display_name\r\nanna,Anna",
      matrix: [
        ["key", "display_name"],
        ["anna", "Anna"],
      ],
    },
    {
      nazwa: "samo CR (stare arkusze Mac OS) też dzieli wiersze",
      text: "key,display_name\ranna,Anna",
      matrix: [
        ["key", "display_name"],
        ["anna", "Anna"],
      ],
    },
    {
      nazwa: "końcowe przełamanie nie tworzy pustego wiersza",
      text: "key\nanna\n",
      matrix: [["key"], ["anna"]],
    },
    {
      nazwa: "wiersz z samymi separatorami wypada",
      text: "key,display_name\n,,\nanna,Anna",
      matrix: [
        ["key", "display_name"],
        ["anna", "Anna"],
      ],
    },
    {
      nazwa: "wiersz z separatorami i spacjami też wypada",
      text: "key,display_name\n ,  \nanna,Anna",
      matrix: [
        ["key", "display_name"],
        ["anna", "Anna"],
      ],
    },
    {
      nazwa: "przecinek WEWNĄTRZ cudzysłowów zostaje w polu",
      text: 'notes\n"Anna, po prostu"',
      matrix: [["notes"], ["Anna, po prostu"]],
    },
    {
      nazwa: "cudzysłów wewnątrz pola zapisany jako podwójny",
      text: 'notes\n"cytat ""w środku"" pola"',
      matrix: [["notes"], ['cytat "w środku" pola']],
    },
    {
      nazwa: "przełamanie linii wewnątrz cudzysłowów NIE dzieli wiersza",
      text: 'notes\n"pierwsza\ndruga"',
      matrix: [["notes"], ["pierwsza\ndruga"]],
    },
    {
      nazwa: "cudzysłów zamknięty w środku pola - reszta dokleja się dalej",
      text: 'notes\n"Anna"Maria',
      matrix: [["notes"], ["AnnaMaria"]],
    },
    {
      nazwa: "BOM ZOSTAJE w pierwszej komórce - parser go nie zdejmuje",
      text: `${BOM}key,display_name`,
      matrix: [[`${BOM}key`, "display_name"]],
    },
    {
      nazwa: "separator `;` NIE jest separatorem - cały wiersz to jedna komórka",
      text: "key;display_name\nanna;Anna",
      matrix: [["key;display_name"], ["anna;Anna"]],
    },
    {
      nazwa: "polskie znaki przechodzą bez zmian",
      text: "display_name,vocative\nŻaneta,Żaneto",
      matrix: [
        ["display_name", "vocative"],
        ["Żaneta", "Żaneto"],
      ],
    },
  ];

  it.each(cases)("$nazwa", ({ text, matrix }) => {
    expect(parseCsvMatrix(text)).toEqual(matrix);
  });
});

describe("normalizeCsvHeaders", () => {
  it("obcina spacje i sprowadza do małych liter", () => {
    expect(normalizeCsvHeaders([" Key ", "DISPLAY_NAME", "Wołacz"])).toEqual([
      "key",
      "display_name",
      "wołacz",
    ]);
  });

  it("pusta lista nagłówków zostaje pustą listą", () => {
    expect(normalizeCsvHeaders([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. SERIALIZACJA
// ---------------------------------------------------------------------------

describe("escapeCsvValue", () => {
  const cases: { nazwa: string; input: string; output: string }[] = [
    { nazwa: "pusty napis nie dostaje cudzysłowów", input: "", output: "" },
    { nazwa: "zwykłe słowo bez zmian", input: "Anna", output: "Anna" },
    {
      nazwa: "przecinek wymusza cudzysłowy",
      input: "Anna, po prostu",
      output: '"Anna, po prostu"',
    },
    { nazwa: "cudzysłów jest podwajany", input: 'cytat "w polu"', output: '"cytat ""w polu"""' },
    { nazwa: "średnik też wymusza cudzysłowy", input: "a;b", output: '"a;b"' },
    { nazwa: "LF wymusza cudzysłowy", input: "a\nb", output: '"a\nb"' },
    { nazwa: "CR wymusza cudzysłowy", input: "a\rb", output: '"a\rb"' },
    { nazwa: "polskie znaki nie wymuszają cudzysłowów", input: "Żanetą", output: "Żanetą" },
  ];

  it.each(cases)("$nazwa", ({ input, output }) => {
    expect(escapeCsvValue(input)).toBe(output);
  });
});

describe("serializeNamesCsv", () => {
  it("pusty słownik daje SAM nagłówek w kolejności kanonicznej", () => {
    expect(serializeNamesCsv([])).toBe(NAMES_CSV_COLUMNS.join(","));
  });

  const cases: { nazwa: string; row: NameDictionaryFields; wiersz: string }[] = [
    {
      nazwa: "wiersz kompletny",
      row: dictRow({
        key: "zaneta",
        display_name: "Żaneta",
        vocative_pl: "Żaneto",
        instrumental_pl: "Żanetą",
        genitive_pl: "Żanety",
        dative_pl: "Żanecie",
        english_form: "Janet",
        gender: "female",
        is_compound: false,
        origin: "PL",
        notes: "wariant",
      }),
      wiersz: "zaneta,Żaneta,Żaneto,Żanetą,Żanety,Żanecie,Janet,female,false,PL,wariant",
    },
    {
      nazwa: "brak `key` i `display_name` - w zapasie stare kolumny",
      row: dictRow({ key: null, display_name: null, name: "Śledzik", name_normalized: "sledzik" }),
      wiersz: "sledzik,Śledzik,,,,,,female,false,,",
    },
    {
      nazwa: "brak `english_form` - w zapasie `vocative_en`",
      row: dictRow({ english_form: null, vocative_en: "Ann" }),
      wiersz: "anna,Anna,,,,,Ann,female,false,,",
    },
    {
      nazwa: "brak `origin` - w zapasie `origin_country`",
      row: dictRow({ origin: null, origin_country: "GB" }),
      wiersz: "anna,Anna,,,,,,female,false,GB,",
    },
    {
      nazwa: "imię złożone wychodzi jako `true`",
      row: dictRow({
        is_compound: true,
        gender: "male",
        display_name: "Jan-Paweł",
        key: "jan-pawel",
      }),
      wiersz: "jan-pawel,Jan-Paweł,,,,,,male,true,,",
    },
    {
      nazwa: "`is_compound` z `null` (wiersz przedmigracyjny) wychodzi jako `false`",
      row: dictRow({ is_compound: null }),
      wiersz: "anna,Anna,,,,,,female,false,,",
    },
    {
      nazwa: "notatka z przecinkiem jest cytowana",
      row: dictRow({ notes: "forma rzadka, regionalna" }),
      wiersz: 'anna,Anna,,,,,,female,false,,"forma rzadka, regionalna"',
    },
    {
      nazwa: "notatka ze średnikiem też jest cytowana",
      row: dictRow({ notes: "a;b" }),
      wiersz: 'anna,Anna,,,,,,female,false,,"a;b"',
    },
  ];

  it.each(cases)("$nazwa", ({ row, wiersz }) => {
    const [head, body] = serializeNamesCsv([row]).split("\n");
    expect(head).toBe(NAMES_CSV_COLUMNS.join(","));
    expect(body).toBe(wiersz);
  });

  it("wiele wierszy to wiele linii po nagłówku", () => {
    const csv = serializeNamesCsv([dictRow(), dictRow({ key: "michal", display_name: "Michał" })]);
    expect(csv.split("\n")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 3. NORMALIZACJA KRAJU
// ---------------------------------------------------------------------------

describe("normalizeCountryInput", () => {
  const cases: { nazwa: string; input: string; output: string }[] = [
    { nazwa: "kropki i podkreślenia stają się spacjami", input: "U.S.A.", output: "u s a" },
    {
      nazwa: "wielokrotne spacje są zwijane",
      input: "  United   States  ",
      output: "united states",
    },
    { nazwa: "diakrytyki rozkładalne są zdejmowane", input: "Türkiye", output: "turkiye" },
    { nazwa: "`ł` NIE jest zdejmowane (brak rozkładu NFKD)", input: "Włochy", output: "włochy" },
    { nazwa: "pusty napis zostaje pusty", input: "   ", output: "" },
  ];

  it.each(cases)("$nazwa", ({ input, output }) => {
    expect(normalizeCountryInput(input)).toBe(output);
  });
});

describe("resolveCountry", () => {
  const cases: { nazwa: string; input: string | null | undefined; code: string | null }[] = [
    { nazwa: "kod ISO wielkimi literami", input: "PL", code: "PL" },
    { nazwa: "kod ISO małymi literami", input: "pl", code: "PL" },
    { nazwa: "nazwa polska", input: "Polska", code: "PL" },
    { nazwa: "nazwa angielska", input: "Poland", code: "PL" },
    { nazwa: "przymiotnik językowy PL", input: "polskie", code: "PL" },
    { nazwa: "przymiotnik językowy EN", input: "german", code: "DE" },
    { nazwa: "zapis z kropkami", input: "U.S.A.", code: "US" },
    { nazwa: "alias z diakrytykiem rozkładalnym", input: "Türkiye", code: "TR" },
    { nazwa: "alias francuski z cedyllą", input: "français", code: "FR" },
    { nazwa: "nazwa polska z `ł`", input: "Włochy", code: "IT" },
    { nazwa: "nazwa polska BEZ `ł` już NIE trafia", input: "Wlochy", code: null },
    { nazwa: "kraj kosza", input: "Inny", code: "OTHER" },
    { nazwa: "kraj nieznany", input: "Atlantyda", code: null },
    { nazwa: "napis pusty", input: "", code: null },
    { nazwa: "same spacje", input: "   ", code: null },
    { nazwa: "wartość `null`", input: null, code: null },
    { nazwa: "wartość `undefined`", input: undefined, code: null },
  ];

  it.each(cases)("$nazwa", ({ input, code }) => {
    expect(resolveCountry(input)?.code ?? null).toBe(code);
  });

  it("tabela krajów nie ma zduplikowanych kodów", () => {
    const codes = NAME_ORIGIN_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("każdy kod ISO rozwiązuje się na SIEBIE - inaczej filtr kraju nie znajdzie wierszy", () => {
    for (const country of NAME_ORIGIN_COUNTRIES) {
      expect(resolveCountry(country.code)?.code).toBe(country.code);
    }
  });
});

describe("resolveOriginCode", () => {
  const cases: { nazwa: string; input: string | null; output: string | null }[] = [
    { nazwa: "kraj rozpoznany daje kod ISO", input: "Polska", output: "PL" },
    { nazwa: "kraj nierozpoznany PRZECHODZI surowy", input: "Atlantyda", output: "Atlantyda" },
    { nazwa: "brak wartości daje `null`", input: null, output: null },
  ];

  it.each(cases)("$nazwa", ({ input, output }) => {
    expect(resolveOriginCode(input)).toBe(output);
  });
});

// ---------------------------------------------------------------------------
// 4. MAPOWANIE WIERSZA
// ---------------------------------------------------------------------------

describe("parseNameCsvRow - mapowanie kolumn", () => {
  it("nagłówek w INNEJ kolejności mapuje się po nazwie, nie po pozycji", () => {
    const row = parseNameCsvRow(
      ["gender", "vocative", "display_name", "key"],
      ["female", "Anno", "Anna", "klucz-jawny"],
    );
    expect(row).toMatchObject({
      key: "klucz-jawny",
      display_name: "Anna",
      gender: "female",
      vocative_pl: "Anno",
    });
  });

  it("wiersz bez imienia (`display_name` i `name` puste) to `null`", () => {
    expect(parseNameCsvRow(["display_name", "name"], ["", ""])).toBeNull();
  });

  it("`name` jest zapasem dla `display_name`", () => {
    expect(parseNameCsvRow(["name"], ["Anna"])?.display_name).toBe("Anna");
  });

  it("brakujące komórki na końcu wiersza czytają się jako puste", () => {
    const row = parseNameCsvRow(["display_name", "vocative", "notes"], ["Anna"]);
    expect(row).toMatchObject({ display_name: "Anna", vocative_pl: null, notes: null });
  });

  it("kolumna nieznana jest ignorowana, a nie wywala mapowania", () => {
    expect(parseNameCsvRow(["display_name", "kolumna_z_kosmosu"], ["Anna", "x"])).toMatchObject({
      display_name: "Anna",
    });
  });

  const genderCases: { nazwa: string; raw: string; gender: string }[] = [
    { nazwa: "`female`", raw: "female", gender: "female" },
    { nazwa: "`f`", raw: "f", gender: "female" },
    { nazwa: "`ż` (skrót polski)", raw: "ż", gender: "female" },
    { nazwa: "`z` (skrót polski bez diakrytyku)", raw: "z", gender: "female" },
    { nazwa: "`FEMALE` wielkimi literami", raw: "FEMALE", gender: "female" },
    { nazwa: "`neutral`", raw: "neutral", gender: "neutral" },
    { nazwa: "`n`", raw: "n", gender: "neutral" },
    { nazwa: "`male`", raw: "male", gender: "male" },
    { nazwa: "`m` spada do `male`", raw: "m", gender: "male" },
    { nazwa: "kolumna pusta spada do `male`", raw: "", gender: "male" },
    { nazwa: "wartość obca spada do `male`", raw: "hermafrodyta", gender: "male" },
  ];

  it.each(genderCases)("płeć: $nazwa", ({ raw, gender }) => {
    expect(parseNameCsvRow(["display_name", "gender"], ["Anna", raw])?.gender).toBe(gender);
  });

  const compoundCases: { nazwa: string; column: string; raw: string; compound: boolean }[] = [
    { nazwa: "`is_compound=1`", column: "is_compound", raw: "1", compound: true },
    { nazwa: "`is_compound=true`", column: "is_compound", raw: "true", compound: true },
    { nazwa: "`is_compound=TRUE`", column: "is_compound", raw: "TRUE", compound: true },
    { nazwa: "`is_compound=tak`", column: "is_compound", raw: "tak", compound: true },
    { nazwa: "`is_compound=yes`", column: "is_compound", raw: "yes", compound: true },
    { nazwa: "`is_compound=y`", column: "is_compound", raw: "y", compound: true },
    { nazwa: "`is_compound=t`", column: "is_compound", raw: "t", compound: true },
    { nazwa: "`is_compound=0`", column: "is_compound", raw: "0", compound: false },
    { nazwa: "`is_compound=false`", column: "is_compound", raw: "false", compound: false },
    { nazwa: "`is_compound=nie`", column: "is_compound", raw: "nie", compound: false },
    { nazwa: "`is_compound` pusta", column: "is_compound", raw: "", compound: false },
    { nazwa: "alias `compound`", column: "compound", raw: "true", compound: true },
    { nazwa: "alias `zlozone`", column: "zlozone", raw: "tak", compound: true },
    { nazwa: "alias `złożone`", column: "złożone", raw: "tak", compound: true },
  ];

  it.each(compoundCases)("złożone: $nazwa", ({ column, raw, compound }) => {
    expect(parseNameCsvRow(["display_name", column], ["Anna", raw])?.is_compound).toBe(compound);
  });

  const aliasCases: { nazwa: string; column: string; pole: keyof ParsedNameCsvRow }[] = [
    { nazwa: "wołacz: `vocative`", column: "vocative", pole: "vocative_pl" },
    { nazwa: "wołacz: `vocative_pl`", column: "vocative_pl", pole: "vocative_pl" },
    { nazwa: "wołacz: `wolacz`", column: "wolacz", pole: "vocative_pl" },
    { nazwa: "wołacz: `wołacz`", column: "wołacz", pole: "vocative_pl" },
    { nazwa: "narzędnik: `instrumental`", column: "instrumental", pole: "instrumental_pl" },
    { nazwa: "narzędnik: `instrumental_pl`", column: "instrumental_pl", pole: "instrumental_pl" },
    { nazwa: "narzędnik: `narzednik`", column: "narzednik", pole: "instrumental_pl" },
    { nazwa: "narzędnik: `narzędnik`", column: "narzędnik", pole: "instrumental_pl" },
    { nazwa: "dopełniacz: `genitive`", column: "genitive", pole: "genitive_pl" },
    { nazwa: "dopełniacz: `genitive_pl`", column: "genitive_pl", pole: "genitive_pl" },
    { nazwa: "dopełniacz: `dopelniacz`", column: "dopelniacz", pole: "genitive_pl" },
    { nazwa: "dopełniacz: `dopełniacz`", column: "dopełniacz", pole: "genitive_pl" },
    { nazwa: "celownik: `dative`", column: "dative", pole: "dative_pl" },
    { nazwa: "celownik: `dative_pl`", column: "dative_pl", pole: "dative_pl" },
    { nazwa: "celownik: `celownik`", column: "celownik", pole: "dative_pl" },
    { nazwa: "forma EN: `english_form`", column: "english_form", pole: "english_form" },
    { nazwa: "forma EN: `vocative_en`", column: "vocative_en", pole: "english_form" },
    { nazwa: "forma EN: `english`", column: "english", pole: "english_form" },
    { nazwa: "notatka: `notes`", column: "notes", pole: "notes" },
  ];

  it.each(aliasCases)("alias kolumny - $nazwa", ({ column, pole }) => {
    const row = parseNameCsvRow(["display_name", column], ["Anna", "WARTOŚĆ"]);
    expect(row?.[pole]).toBe("WARTOŚĆ");
  });

  const originCases: { nazwa: string; column: string; raw: string; origin: string | null }[] = [
    { nazwa: "`origin` z nazwą polską", column: "origin", raw: "Polska", origin: "PL" },
    { nazwa: "`origin_country` z kodem", column: "origin_country", raw: "DE", origin: "DE" },
    { nazwa: "`country` z nazwą angielską", column: "country", raw: "Ukraine", origin: "UA" },
    { nazwa: "`kraj` po polsku", column: "kraj", raw: "Czechy", origin: "CZ" },
    {
      nazwa: "kraj nieznany przechodzi surowy",
      column: "origin",
      raw: "Atlantyda",
      origin: "Atlantyda",
    },
    { nazwa: "kolumna kraju pusta daje `null`", column: "origin", raw: "", origin: null },
  ];

  it.each(originCases)("kraj - $nazwa", ({ column, raw, origin }) => {
    expect(parseNameCsvRow(["display_name", column], ["Anna", raw])?.origin).toBe(origin);
  });

  const keyCases: { nazwa: string; headers: string[]; cells: string[]; key: string }[] = [
    {
      nazwa: "`key` jawny jest sprowadzany do małych liter",
      headers: ["key", "display_name"],
      cells: ["ANNA-MARIA", "Anna Maria"],
      key: "anna-maria",
    },
    {
      nazwa: "brak `key` - klucz z imienia (`ł` -> `l`)",
      headers: ["display_name"],
      cells: ["Michał"],
      key: "michal",
    },
    {
      nazwa: "brak `key` - `Ł` na początku też schodzi do `l`",
      headers: ["display_name"],
      cells: ["Łucja"],
      key: "lucja",
    },
    {
      nazwa: "brak `key` - ogonki i kreski schodzą",
      headers: ["display_name"],
      cells: ["Żaneta-Ćwiąkała"],
      key: "zaneta-cwiakala",
    },
    {
      nazwa: "brak `key` - diakrytyk obcy też schodzi",
      headers: ["display_name"],
      cells: ["Zoë"],
      key: "zoe",
    },
    {
      nazwa: "spacje wokół wartości są obcinane",
      headers: ["key", "display_name"],
      cells: ["  anna  ", "  Anna  "],
      key: "anna",
    },
  ];

  it.each(keyCases)("klucz - $nazwa", ({ headers, cells, key }) => {
    expect(parseNameCsvRow(headers, cells)?.key).toBe(key);
  });
});

// ---------------------------------------------------------------------------
// 5. CAŁY PLIK - PRZYPADKI WYMAGANE PRZEZ ZLECENIE
// ---------------------------------------------------------------------------

describe("parseNamesCsv - przypadki brzegowe całego pliku", () => {
  const cases: {
    nazwa: string;
    text: string;
    headers: string[];
    rows: Partial<ParsedNameCsvRow>[];
  }[] = [
    { nazwa: "CSV pusty - zero nagłówków i zero wierszy", text: "", headers: [], rows: [] },
    {
      nazwa: "CSV z samym nagłówkiem - zero wierszy do zapisu",
      text: "key,display_name",
      headers: ["key", "display_name"],
      rows: [],
    },
    {
      // Znacznik BOM przechodzi z parsera do pierwszej komórki, ale
      // `normalizeCsvHeaders` zdejmuje go przez `trim()`: U+FEFF jest w
      // specyfikacji ECMAScript białym znakiem. Dowód poniżej, w osobnym
      // teście - bez niego zamiana `trim()` na własne obcinanie spacji
      // po cichu zepsułaby KAŻDY plik z Excela.
      nazwa: "CSV z BOM - kolumna `key` jest rozpoznana, znacznik zdjęty",
      text: `${BOM}key,display_name\nklucz-jawny,Anna`,
      headers: ["key", "display_name"],
      rows: [{ key: "klucz-jawny", display_name: "Anna" }],
    },
    {
      nazwa: "CSV z separatorem `;` - nagłówki nierozpoznane, ZERO wierszy",
      text: "key;display_name;gender\nanna;Anna;female",
      headers: ["key;display_name;gender"],
      rows: [],
    },
    {
      nazwa: "CSV z cudzysłowami - przecinek i cudzysłów wewnątrz pola",
      text: 'display_name,notes\nAnna,"forma ""Anno"", wołacz"',
      headers: ["display_name", "notes"],
      rows: [{ display_name: "Anna", notes: 'forma "Anno", wołacz' }],
    },
    {
      nazwa: "CSV z brakującymi kolumnami - reszta pól schodzi na `null`",
      text: "display_name\nAnna",
      headers: ["display_name"],
      rows: [
        {
          key: "anna",
          display_name: "Anna",
          vocative_pl: null,
          instrumental_pl: null,
          genitive_pl: null,
          dative_pl: null,
          english_form: null,
          gender: "male",
          is_compound: false,
          origin: null,
          notes: null,
        },
      ],
    },
    {
      nazwa: "CSV z wierszem bez imienia - wiersz WYPADA, resztę czytamy dalej",
      text: "key,display_name\nsierotka,\nanna,Anna",
      headers: ["key", "display_name"],
      rows: [{ key: "anna", display_name: "Anna" }],
    },
    {
      nazwa: "CSV z DUPLIKATEM `key` - oba wiersze przechodzą do planu",
      text: "key,display_name,vocative,instrumental\nanna,Anna,,Anną\nanna,Anna,Anno,",
      headers: ["key", "display_name", "vocative", "instrumental"],
      rows: [
        { key: "anna", vocative_pl: null, instrumental_pl: "Anną" },
        { key: "anna", vocative_pl: "Anno", instrumental_pl: null },
      ],
    },
    {
      nazwa: "CSV z polskimi znakami - `ł ą ę ó ś ż ź ć ń` nie giną",
      text: "display_name,vocative,instrumental,genitive,dative,notes\nŁucja,Łucjo,Łucją,Łucji,Łucji,ćma ńć óź śę",
      headers: ["display_name", "vocative", "instrumental", "genitive", "dative", "notes"],
      rows: [
        {
          key: "lucja",
          display_name: "Łucja",
          vocative_pl: "Łucjo",
          instrumental_pl: "Łucją",
          genitive_pl: "Łucji",
          dative_pl: "Łucji",
          notes: "ćma ńć óź śę",
        },
      ],
    },
    {
      nazwa: "CSV z CRLF - wynik identyczny jak z LF",
      text: "key,display_name\r\nanna,Anna\r\nmichal,Michał\r\n",
      headers: ["key", "display_name"],
      rows: [{ key: "anna" }, { key: "michal", display_name: "Michał" }],
    },
    {
      nazwa: "CSV z wierszem z SAMYCH separatorów - wiersz wypada",
      text: "key,display_name\n,\nanna,Anna",
      headers: ["key", "display_name"],
      rows: [{ key: "anna", display_name: "Anna" }],
    },
    {
      nazwa: "CSV z nagłówkiem w INNEJ kolejności kolumn",
      text: "notes,gender,display_name,wołacz,key\nuwaga,female,Anna,Anno,anna",
      headers: ["notes", "gender", "display_name", "wołacz", "key"],
      rows: [
        {
          key: "anna",
          display_name: "Anna",
          gender: "female",
          vocative_pl: "Anno",
          notes: "uwaga",
        },
      ],
    },
  ];

  it.each(cases)("$nazwa", ({ text, headers, rows }) => {
    const parsed = parseNamesCsv(text);
    expect([...parsed.headers]).toEqual(headers);
    expect(parsed.rows).toHaveLength(rows.length);
    rows.forEach((expected, index) => {
      expect(parsed.rows[index]).toMatchObject(expected);
    });
  });
});

describe("BOM - na czym stoi jego obsługa", () => {
  it("parser NIE zdejmuje znacznika - zostaje w pierwszej komórce", () => {
    expect(parseCsvMatrix(`${BOM}key,display_name`)[0][0]).toBe(`${BOM}key`);
  });

  it("znacznik zdejmuje normalizacja nagłówka, bo `trim()` liczy U+FEFF jako biały znak", () => {
    expect(normalizeCsvHeaders([`${BOM}key`])).toEqual(["key"]);
    // Inwariant, na którym to stoi - jawnie, żeby regresja miała adres.
    expect(`${BOM}key`.trim()).toBe("key");
  });

  it("plik z Excela (BOM + CRLF) czyta się kompletnie", () => {
    const parsed = parseNamesCsv(`${BOM}key,display_name,vocative\r\nlucja,Łucja,Łucjo\r\n`);
    expect(parsed.rows).toEqual([
      {
        key: "lucja",
        display_name: "Łucja",
        vocative_pl: "Łucjo",
        instrumental_pl: null,
        genitive_pl: null,
        dative_pl: null,
        english_form: null,
        gender: "male",
        is_compound: false,
        origin: null,
        notes: null,
      },
    ]);
  });
});

describe("round trip eksport -> import", () => {
  it("nagłówek eksportu jest w całości rozumiany przez import", () => {
    const source = dictRow({
      key: "zaneta",
      display_name: "Żaneta",
      vocative_pl: "Żaneto",
      instrumental_pl: "Żanetą",
      genitive_pl: "Żanety",
      dative_pl: "Żanecie",
      english_form: "Janet",
      gender: "female",
      is_compound: true,
      origin: "PL",
      notes: "notatka, z przecinkiem",
    });
    const parsed = parseNamesCsv(serializeNamesCsv([source]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({
      key: "zaneta",
      display_name: "Żaneta",
      vocative_pl: "Żaneto",
      instrumental_pl: "Żanetą",
      genitive_pl: "Żanety",
      dative_pl: "Żanecie",
      english_form: "Janet",
      gender: "female",
      is_compound: true,
      origin: "PL",
      notes: "notatka, z przecinkiem",
    });
  });
});

// ---------------------------------------------------------------------------
// 6. DEDUPE PO `key`
// ---------------------------------------------------------------------------

describe("nameRowKey i indexNamesByKey", () => {
  it("`key` wygrywa, gdy jest", () => {
    expect(nameRowKey({ key: "anna", name_normalized: "inna" })).toBe("anna");
  });

  it("bez `key` czytamy `name_normalized` (wiersz przedmigracyjny)", () => {
    expect(nameRowKey({ key: null, name_normalized: "anna" })).toBe("anna");
  });

  it("indeks trzyma wiersze pod kluczem dedupe", () => {
    const index = indexNamesByKey([dictRow(), dictRow({ key: null, name_normalized: "michal" })]);
    expect([...index.keys()].sort()).toEqual(["anna", "michal"]);
  });

  it("duplikat klucza W BAZIE - w indeksie wygrywa wiersz PÓŹNIEJSZY", () => {
    const index = indexNamesByKey([
      dictRow({ vocative_pl: "pierwszy" }),
      dictRow({ vocative_pl: "drugi" }),
    ]);
    expect(index.size).toBe(1);
    expect(index.get("anna")?.vocative_pl).toBe("drugi");
  });
});

describe("classifyNameImportRow", () => {
  const cases: {
    nazwa: string;
    existing: NameDictionaryFields | undefined;
    row: ParsedNameCsvRow;
    action: NameImportAction;
  }[] = [
    { nazwa: "brak wiersza w słowniku - DODAJ", existing: undefined, row: csvRow(), action: "add" },
    {
      nazwa: "wszystko puste po obu stronach - POMIŃ",
      existing: dictRow(),
      row: csvRow(),
      action: "skip",
    },
    {
      nazwa: "wiersz wnosi wołacz do pustej kolumny - SCAL",
      existing: dictRow(),
      row: csvRow({ vocative_pl: "Anno" }),
      action: "merge",
    },
    {
      nazwa: "wiersz wnosi narzędnik - SCAL",
      existing: dictRow(),
      row: csvRow({ instrumental_pl: "Anną" }),
      action: "merge",
    },
    {
      nazwa: "wiersz wnosi dopełniacz - SCAL",
      existing: dictRow(),
      row: csvRow({ genitive_pl: "Anny" }),
      action: "merge",
    },
    {
      nazwa: "wiersz wnosi celownik - SCAL",
      existing: dictRow(),
      row: csvRow({ dative_pl: "Annie" }),
      action: "merge",
    },
    {
      nazwa: "wiersz wnosi formę EN - SCAL",
      existing: dictRow(),
      row: csvRow({ english_form: "Ann" }),
      action: "merge",
    },
    {
      nazwa: "wiersz wnosi kraj - SCAL",
      existing: dictRow(),
      row: csvRow({ origin: "PL" }),
      action: "merge",
    },
    {
      nazwa: "wiersz wnosi notatkę - SCAL",
      existing: dictRow(),
      row: csvRow({ notes: "uwaga" }),
      action: "merge",
    },
    {
      nazwa: "kolumna w słowniku JUŻ wypełniona - POMIŃ (import nie nadpisuje)",
      existing: dictRow({ vocative_pl: "Anno" }),
      row: csvRow({ vocative_pl: "Aniu" }),
      action: "skip",
    },
    {
      nazwa: "pusty NAPIS w słowniku liczy się jako brak - SCAL",
      existing: dictRow({ vocative_pl: "" }),
      row: csvRow({ vocative_pl: "Anno" }),
      action: "merge",
    },
    {
      nazwa: "pusty napis w CSV nie jest wartością - POMIŃ",
      existing: dictRow(),
      row: csvRow({ vocative_pl: "" }),
      action: "skip",
    },
    {
      nazwa: "spacja w CSV JEST wartością (brak obcinania w dedupe) - SCAL",
      existing: dictRow(),
      row: csvRow({ vocative_pl: " " }),
      action: "merge",
    },
    {
      nazwa: "jedna kolumna zajęta, druga wolna - SCAL",
      existing: dictRow({ vocative_pl: "Anno" }),
      row: csvRow({ vocative_pl: "Aniu", dative_pl: "Annie" }),
      action: "merge",
    },
    {
      nazwa: "sama flaga złożenia nie liczy się do decyzji - POMIŃ",
      existing: dictRow(),
      row: csvRow({ is_compound: true }),
      action: "skip",
    },
  ];

  it.each(cases)("$nazwa", ({ existing, row, action }) => {
    expect(classifyNameImportRow(existing, row)).toBe(action);
  });

  it("lista pól decydujących o scaleniu to DOKŁADNIE siedem kolumn tekstowych", () => {
    expect([...NAME_MERGE_CHECK_FIELDS]).toEqual([
      "vocative_pl",
      "instrumental_pl",
      "genitive_pl",
      "dative_pl",
      "english_form",
      "origin",
      "notes",
    ]);
  });
});

describe("buildNameMergePatch - uzupełnianie brakujących pól", () => {
  it("puste kolumny są uzupełniane, wypełnione zostają NIETKNIĘTE", () => {
    const patch = buildNameMergePatch(
      dictRow({ vocative_pl: "Anno", notes: "stara notatka" }),
      csvRow({ vocative_pl: "Aniu", dative_pl: "Annie", notes: "nowa notatka" }),
    );
    expect(patch).toEqual({ dative_pl: "Annie" });
  });

  it("łatka pustego wiersza CSV jest PUSTA - nie ma po co jechać do bazy", () => {
    expect(buildNameMergePatch(dictRow(), csvRow())).toEqual({});
  });

  it("forma EN uzupełnia OBIE kolumny: nową i historyczną", () => {
    expect(buildNameMergePatch(dictRow(), csvRow({ english_form: "Ann" }))).toEqual({
      english_form: "Ann",
      vocative_en: "Ann",
    });
  });

  it("gdy `english_form` jest zajęte, uzupełniamy TYLKO historyczne `vocative_en`", () => {
    expect(
      buildNameMergePatch(dictRow({ english_form: "Ann" }), csvRow({ english_form: "Anne" })),
    ).toEqual({ vocative_en: "Anne" });
  });

  it("gdy `vocative_en` jest zajęte, uzupełniamy TYLKO `english_form`", () => {
    expect(
      buildNameMergePatch(dictRow({ vocative_en: "Ann" }), csvRow({ english_form: "Anne" })),
    ).toEqual({ english_form: "Anne" });
  });

  it("kraj z CSV jest zapisywany jako KOD ISO do obu kolumn", () => {
    expect(buildNameMergePatch(dictRow(), csvRow({ origin: "Polska" }))).toEqual({
      origin: "PL",
      origin_country: "PL",
    });
  });

  it("kraj nierozpoznany trafia do bazy surowy - informacja od człowieka nie ginie", () => {
    expect(buildNameMergePatch(dictRow(), csvRow({ origin: "Atlantyda" }))).toEqual({
      origin: "Atlantyda",
      origin_country: "Atlantyda",
    });
  });

  it("gdy `origin` jest zajęte, uzupełniamy tylko `origin_country`", () => {
    expect(buildNameMergePatch(dictRow({ origin: "GB" }), csvRow({ origin: "Poland" }))).toEqual({
      origin_country: "PL",
    });
  });

  it("flaga złożenia uzupełnia się TYLKO na wierszu przedmigracyjnym (`null`)", () => {
    expect(
      buildNameMergePatch(dictRow({ is_compound: null }), csvRow({ is_compound: true })),
    ).toEqual({ is_compound: true });
  });

  it("`is_compound: false` w słowniku NIE jest brakiem - flaga zostaje nieuzupełniona", () => {
    // To jest gałąź praktycznie nieosiągalna w produkcji: w wygenerowanych
    // typach kolumna jest NOT NULL, więc realny wiersz ma tu `true`/`false`,
    // a `false` nie liczy się jako brak. Opis przy `buildNameMergePatch`.
    expect(
      buildNameMergePatch(dictRow({ is_compound: false }), csvRow({ is_compound: true })),
    ).toEqual({});
  });

  it("wszystkie cztery przypadki gramatyczne naraz", () => {
    expect(
      buildNameMergePatch(
        dictRow(),
        csvRow({
          vocative_pl: "Łucjo",
          instrumental_pl: "Łucją",
          genitive_pl: "Łucji",
          dative_pl: "Łucji",
        }),
      ),
    ).toEqual({
      vocative_pl: "Łucjo",
      instrumental_pl: "Łucją",
      genitive_pl: "Łucji",
      dative_pl: "Łucji",
    });
  });

  it("polskie znaki w łatce nie są normalizowane - do bazy jedzie forma z ogonkami", () => {
    const patch = buildNameMergePatch(dictRow(), csvRow({ notes: "ćma ńć óź śę żźć" }));
    expect(patch.notes).toBe("ćma ńć óź śę żźć");
  });
});

describe("buildNameInsertPayload", () => {
  it("buduje pełny ładunek nowego wiersza z kodem ISO w obu kolumnach kraju", () => {
    expect(
      buildNameInsertPayload(
        csvRow({
          key: "lucja",
          display_name: "Łucja",
          vocative_pl: "Łucjo",
          instrumental_pl: "Łucją",
          genitive_pl: "Łucji",
          dative_pl: "Łucji",
          english_form: "Lucy",
          gender: "female",
          is_compound: false,
          origin: "Polska",
          notes: "uwaga",
        }),
      ),
    ).toEqual({
      name: "Łucja",
      name_normalized: "lucja",
      key: "lucja",
      display_name: "Łucja",
      gender: "female",
      origin_country: "PL",
      origin: "PL",
      vocative_pl: "Łucjo",
      instrumental_pl: "Łucją",
      genitive_pl: "Łucji",
      dative_pl: "Łucji",
      english_form: "Lucy",
      vocative_en: "Lucy",
      is_compound: false,
      notes: "uwaga",
    });
  });

  it("`name_normalized` powstaje z imienia, nie z klucza z pliku", () => {
    const payload = buildNameInsertPayload(csvRow({ key: "obcy-klucz", display_name: "Żaneta" }));
    expect(payload.key).toBe("obcy-klucz");
    expect(payload.name_normalized).toBe("zaneta");
  });

  it("brak kraju zostaje `null` w obu kolumnach", () => {
    const payload = buildNameInsertPayload(csvRow({ origin: null }));
    expect(payload.origin).toBeNull();
    expect(payload.origin_country).toBeNull();
  });

  it("flaga złożenia przechodzi bez zmian", () => {
    expect(buildNameInsertPayload(csvRow({ is_compound: true })).is_compound).toBe(true);
  });
});

describe("planNamesImport", () => {
  it("liczy trzy kubełki i zwraca akcje W KOLEJNOŚCI wejściowej", () => {
    const existing = indexNamesByKey([
      dictRow({ key: "anna" }),
      dictRow({ key: "michal", vocative_pl: "Michale" }),
    ]);
    const plan = planNamesImport(
      [
        csvRow({ key: "nowa", display_name: "Nowa" }),
        csvRow({ key: "anna", vocative_pl: "Anno" }),
        csvRow({ key: "michal", vocative_pl: "Michale" }),
      ],
      existing,
    );
    expect([...plan.actions]).toEqual(["add", "merge", "skip"]);
    expect(plan.willAdd).toBe(1);
    expect(plan.willMerge).toBe(1);
    expect(plan.willSkip).toBe(1);
  });

  it("pusty plik daje plan zerowy", () => {
    expect(planNamesImport([], new Map())).toEqual({
      actions: [],
      willAdd: 0,
      willMerge: 0,
      willSkip: 0,
    });
  });

  it("pusty słownik znaczy, że KAŻDY wiersz jest do dodania", () => {
    const plan = planNamesImport([csvRow(), csvRow({ key: "michal" })], new Map());
    expect(plan).toMatchObject({ willAdd: 2, willMerge: 0, willSkip: 0 });
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY - produkcja NIEZMIENIONA, zgłoszenie w teście
// ---------------------------------------------------------------------------

describe("defekty zgłoszone, produkcja bez naprawy", () => {
  it.fails("DEFEKT: separator `;` odrzuca CAŁY plik, mimo że eksport go cytuje", () => {
    // CO: parser zna wyłącznie przecinek. Plik rozdzielony średnikiem daje
    // jedną komórkę na wiersz, więc `display_name` nie jest rozpoznane
    // i `parseNameCsvRow` zwraca `null` dla każdego wiersza.
    // GDZIE: `src/lib/admin/namesCsv.ts`, `parseCsvMatrix` - gałąź
    // `ch === ","` jest jedynym separatorem, choć `escapeCsvValue` CYTUJE pola
    // ze średnikiem, czyli autor wiedział, że `;` jest separatorem w arkuszach.
    // KONSEKWENCJA: Excel w polskiej lokalizacji zapisuje CSV ze średnikiem.
    // Administrator dostaje „Brak prawidłowych wierszy” na pliku, który sam
    // wyeksportował z tego panelu i otworzył w arkuszu - i nie ma z komunikatu
    // żadnej wskazówki, co poprawić.
    const parsed = parseNamesCsv("key;display_name;gender\nanna;Anna;female");
    expect(parsed.rows).toHaveLength(1);
  });

  it.fails("DEFEKT: duplikat `key` W JEDNYM PLIKU nie jest scalany, tylko liczony dwa razy", () => {
    // CO: `planNamesImport` klasyfikuje KAŻDY wiersz wejściowy osobno wobec
    // słownika, nie wobec wierszy wcześniejszych z tego samego pliku. Dwa
    // wiersze o kluczu `anna` przy pustym słowniku dają dwa razy „dodaj”.
    // GDZIE: `src/lib/admin/namesCsv.ts`, `planNamesImport` (brak zwinięcia
    // wejścia po `key`) - przeniesione 1:1 z `admin.names.tsx`.
    // KONSEKWENCJA: podgląd obiecuje dwa nowe imiona, a zapis wstawia jedno
    // (drugi INSERT łamie unikalność `key` i ląduje w kubełku „pominięto”),
    // przy czym wołacz z DRUGIEGO wiersza przepada bezpowrotnie - nie zostaje
    // ani scalony, ani zgłoszony. Poprawne zachowanie: zwinąć wiersze po
    // kluczu, uzupełniając brakujące pola z wiersza późniejszego.
    const plan = planNamesImport(
      [csvRow({ instrumental_pl: "Anną" }), csvRow({ vocative_pl: "Anno" })],
      new Map(),
    );
    expect(plan.willAdd).toBe(1);
  });

  it.fails("DEFEKT: sama flaga złożenia rozjeżdża podgląd z zapisem", () => {
    // CO: `classifyNameImportRow` patrzy na siedem kolumn tekstowych
    // (`NAME_MERGE_CHECK_FIELDS`), a `buildNameMergePatch` uzupełnia dodatkowo
    // `is_compound`, `vocative_en` i `origin_country`. Wiersz, który wnosi
    // WYŁĄCZNIE flagę złożenia, jest w podglądzie oznaczony „Pomiń”, a przy
    // zapisie daje niepustą łatkę i wchodzi do kubełka „scalono”.
    // GDZIE: `src/lib/admin/namesCsv.ts` - rozjazd między
    // `NAME_MERGE_CHECK_FIELDS` i ładunkiem `buildNameMergePatch`.
    // KONSEKWENCJA: liczniki z podglądu nie zgadzają się z komunikatem po
    // imporcie, a administrator nie wie, które z dwóch liczb są prawdziwe.
    const existing = dictRow({ is_compound: null });
    const row = csvRow({ is_compound: true });
    const decision = classifyNameImportRow(existing, row);
    const patch = buildNameMergePatch(existing, row);
    expect(decision === "skip" && Object.keys(patch).length === 0).toBe(true);
  });
});
