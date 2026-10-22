// Mapowanie kolumn CSV na pola leada - reguła obchodzenia się z DANYMI
// OSOBOWYMI, więc testujemy ją wprost, a nie przez render dialogu.
//
// Parsowania CSV nie dotykamy (`lib/csv/parseCsv` ma własne 100%): wejściem są
// już rozbite wiersze. Wszystkie dane są zmyślone (domena `example.test`).
import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_ROWS,
  IMPORT_MAX_TAGS,
  LEAD_IMPORT_FIELDS,
  LEAD_IMPORT_VALUE_MAX,
  LEAD_IMPORT_FIELD_CHOICES,
  autoMapHeaders,
  fieldForHeader,
  looksLikeEmail,
  mapImportRows,
  normalizeHeader,
  splitTags,
  type LeadImportMapping,
} from "../importMapping";
import { CRM_TAG_MAX } from "@/lib/crm/lifecycle";

describe("normalizeHeader", () => {
  it("ścina BOM, spacje i wielkość liter", () => {
    expect(normalizeHeader("﻿  E-Mail  ")).toBe("e-mail");
  });

  it("skleja wielokrotne spacje", () => {
    expect(normalizeHeader("Adres   e-mail")).toBe("adres e-mail");
  });
});

describe("autoMapHeaders - nagłówki po polsku i po angielsku", () => {
  it("rozpoznaje komplet pól z nagłówków polskich", () => {
    expect(
      autoMapHeaders([
        "E-mail",
        "Imię",
        "Nazwisko",
        "Telefon",
        "Firma",
        "Stanowisko",
        "Kraj",
        "LinkedIn",
        "Tagi",
      ]),
    ).toEqual([
      "email",
      "first_name",
      "last_name",
      "phone",
      "company",
      "position",
      "country",
      "linkedin_url",
      "tags",
    ]);
  });

  it("rozpoznaje komplet pól z nagłówków angielskich", () => {
    expect(
      autoMapHeaders([
        "Email",
        "First name",
        "Last name",
        "Phone",
        "Company",
        "Position",
        "Country",
        "LinkedIn URL",
        "Tags",
      ]),
    ).toEqual([
      "email",
      "first_name",
      "last_name",
      "phone",
      "company",
      "position",
      "country",
      "linkedin_url",
      "tags",
    ]);
  });

  it("kolejność kolumn w pliku nie ma znaczenia", () => {
    expect(autoMapHeaders(["Tagi", "Nazwisko", "E-mail", "Imię"])).toEqual([
      "tags",
      "last_name",
      "email",
      "first_name",
    ]);
  });

  it("wariacje zapisu e-maila trafiają w to samo pole", () => {
    for (const header of ["E-mail", "email", "E_mail", "Mail", "Adres e-mail", "ADRES EMAIL"]) {
      expect(fieldForHeader(header)).toBe("email");
    }
  });

  it("„Adres” to ulica, nie e-mail - zostaje niezmapowany", () => {
    // Regresja: poprzednia reguła (`/^(e-?mail|mail|adres)/`) wpisywała adres
    // pocztowy w pole e-mail, czyli mieszała dwie różne dane osobowe.
    expect(fieldForHeader("Adres")).toBe("");
    expect(fieldForHeader("Adres korespondencyjny")).toBe("");
    expect(fieldForHeader("Address")).toBe("");
  });

  it("kolumna nierozpoznana zostaje niezmapowana, nie zgadywana", () => {
    expect(autoMapHeaders(["NIP", "Uwagi wewnętrzne", "Kolumna 7"])).toEqual(["", "", ""]);
  });

  it("pusty nagłówek zostaje niezmapowany", () => {
    expect(autoMapHeaders(["", "   "])).toEqual(["", ""]);
  });

  it("„Nazwa firmy” trafia w firmę, a nie w nazwisko", () => {
    expect(fieldForHeader("Nazwa firmy")).toBe("company");
    expect(fieldForHeader("Organizacja")).toBe("company");
  });

  it("pole może być przypisane tylko raz - druga kolumna zostaje pusta", () => {
    expect(autoMapHeaders(["E-mail", "E-mail prywatny", "Telefon", "Telefon komórkowy"])).toEqual([
      "email",
      "",
      "phone",
      "",
    ]);
  });

  it("„Imię i nazwisko” trafia w imię (pierwsze dopasowanie), świadomie", () => {
    // Reguła pierwszego dopasowania: kolumna z pełną nazwą ląduje w imieniu,
    // bo import nie ma prawa dzielić nazwiska za człowieka.
    expect(fieldForHeader("Imię i nazwisko")).toBe("first_name");
  });

  it("lista wyboru w interfejsie zawiera wszystkie pola i opcję pominięcia", () => {
    expect(LEAD_IMPORT_FIELD_CHOICES).toEqual([...LEAD_IMPORT_FIELDS, ""]);
  });
});

describe("autoMapHeaders - zgody nie da się zaimportować", () => {
  it("kolumny zgody są odrzucane przed każdą inną regułą", () => {
    for (const header of [
      "Zgoda",
      "Zgoda marketingowa",
      "Consent",
      "marketing_consent",
      "RODO",
      "GDPR",
      "Opt-in",
      "Newsletter",
      "Zgoda na newsletter",
      "E-mail marketing",
    ]) {
      expect(fieldForHeader(header)).toBe("");
    }
  });

  it("wartości „tak/true/1” w kolumnie zgody nie trafiają do żadnego pola", () => {
    const header = ["E-mail", "Zgoda", "Consent", "marketing_consent"];
    const mapping = autoMapHeaders(header);
    expect(mapping).toEqual(["email", "", "", ""]);

    const { rows } = mapImportRows(
      [
        ["anna@example.test", "tak", "true", "1"],
        ["bartek@example.test", "TAK", "TRUE", "1"],
      ],
      mapping,
    );
    // Wiersz importu niesie wyłącznie e-mail: zgoda wymaga dowodu
    // (crm_consent_log), a RPC importu nie przyjmuje takiego pola.
    expect(rows).toEqual([{ email: "anna@example.test" }, { email: "bartek@example.test" }]);
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(["email"]);
    }
  });

  it("ręczne wskazanie kolumny zgody nie jest możliwe - nie ma takiego pola", () => {
    expect(LEAD_IMPORT_FIELDS).not.toContain("marketing_consent");
  });
});

describe("mapImportRows", () => {
  const HEADER = ["E-mail", "Imię", "Nazwisko", "Firma", "Tagi"];
  const MAPPING: LeadImportMapping = autoMapHeaders(HEADER);

  it("mapuje wiersz na pola leada", () => {
    const { rows } = mapImportRows(
      [["anna@example.test", "Anna", "Kowalska", "Acme", "eu|energia"]],
      MAPPING,
    );
    expect(rows).toEqual([
      {
        email: "anna@example.test",
        first_name: "Anna",
        last_name: "Kowalska",
        company: "Acme",
        tags: ["eu", "energia"],
      },
    ]);
  });

  it("bez kolumny e-mail nie powstaje żaden wiersz", () => {
    const { rows, skippedWithoutEmail } = mapImportRows(
      [["Anna", "Kowalska"]],
      ["first_name", "last_name"],
    );
    expect(rows).toEqual([]);
    expect(skippedWithoutEmail).toBe(1);
  });

  it("wiersz bez e-maila i z e-mailem niepoprawnym odpada", () => {
    const { rows, skippedWithoutEmail } = mapImportRows(
      [
        ["", "Anna"],
        ["nie-email", "Bartek"],
        ["anna@example.test", "Anna"],
      ],
      ["email", "first_name"],
    );
    expect(rows.map((r) => r.email)).toEqual(["anna@example.test"]);
    expect(skippedWithoutEmail).toBe(2);
  });

  it("duplikat e-maila w pliku odpada - pierwszy wiersz wygrywa", () => {
    const { rows, inFileDuplicates } = mapImportRows(
      [
        ["anna@example.test", "Anna"],
        [" ANNA@Example.test ", "Anna z drugiego wiersza"],
        ["bartek@example.test", "Bartek"],
      ],
      ["email", "first_name"],
    );
    expect(rows.map((r) => r.first_name)).toEqual(["Anna", "Bartek"]);
    expect(inFileDuplicates).toBe(1);
  });

  it("wiersz z nadmiarową liczbą kolumn ignoruje nadmiar", () => {
    const { rows } = mapImportRows(
      [["anna@example.test", "Anna", "Kowalska", "Acme", "eu", "NADMIAR", "I JESZCZE"]],
      MAPPING,
    );
    expect(rows[0]).toEqual({
      email: "anna@example.test",
      first_name: "Anna",
      last_name: "Kowalska",
      company: "Acme",
      tags: ["eu"],
    });
  });

  it("wiersz krótszy od nagłówka daje po prostu mniej pól", () => {
    const { rows } = mapImportRows([["anna@example.test", "Anna"]], MAPPING);
    expect(rows[0]).toEqual({ email: "anna@example.test", first_name: "Anna" });
  });

  it("wiersz krótszy niż kolumna e-maila odpada jako wiersz bez e-maila", () => {
    // Plik z „poszarpanymi" wierszami: brak komórki nie może udawać pustego
    // adresu ani wywalić importu.
    const { rows, skippedWithoutEmail } = mapImportRows(
      [["Anna"], ["Bartek", "bartek@example.test"]],
      ["first_name", "email"],
    );
    expect(rows.map((r) => r.email)).toEqual(["bartek@example.test"]);
    expect(skippedWithoutEmail).toBe(1);
  });

  it("puste komórki nie tworzą pustych pól", () => {
    const { rows } = mapImportRows([["anna@example.test", "  ", "", "  ", ""]], MAPPING);
    expect(rows[0]).toEqual({ email: "anna@example.test" });
  });

  it("komórka tagów bez treści nie tworzy pustej listy tagów", () => {
    const { rows } = mapImportRows([["anna@example.test", " ; | , "]], ["email", "tags"]);
    expect(rows[0]).toEqual({ email: "anna@example.test" });
  });

  it("pusty plik daje pusty wynik bez błędu", () => {
    expect(mapImportRows([], MAPPING)).toEqual({
      rows: [],
      oversized: [],
      inFileDuplicates: 0,
      skippedWithoutEmail: 0,
      droppedOverLimit: 0,
    });
  });

  it("kolumny pominięte nie trafiają do wiersza importu", () => {
    const mapping = autoMapHeaders(["E-mail", "NIP", "Uwagi"]);
    const { rows } = mapImportRows([["anna@example.test", "1234567890", "cokolwiek"]], mapping);
    expect(rows[0]).toEqual({ email: "anna@example.test" });
  });

  it("e-mail zachowuje oryginalną pisownię, dedup jest bez wielkości liter", () => {
    const { rows } = mapImportRows(
      [["Anna.Kowalska@Example.test", "Anna"]],
      ["email", "first_name"],
    );
    expect(rows[0].email).toBe("Anna.Kowalska@Example.test");
  });

  it("wartość dłuższa niż limit pola NIE jest przycinana - jest zgłaszana z numerem wiersza (Z-I9b-15)", () => {
    const long = "x".repeat(LEAD_IMPORT_VALUE_MAX.company + 1);
    const { rows, oversized } = mapImportRows(
      [
        ["anna@example.test", "Acme"],
        ["jan@example.test", long],
      ],
      ["email", "company"],
    );
    // Wiersz zostaje w całości - poprawia go człowiek, nie import.
    expect(rows[1].company).toBe(long);
    // Nagłówek = wiersz 1, więc drugi wiersz danych to wiersz 3 pliku.
    expect(oversized).toEqual([
      { row: 3, column: 1, field: "company", kind: "length", limit: LEAD_IMPORT_VALUE_MAX.company },
    ]);
  });

  it("wartość równa limitowi przechodzi bez zgłoszenia", () => {
    const exact = "x".repeat(LEAD_IMPORT_VALUE_MAX.first_name);
    const { rows, oversized } = mapImportRows(
      [["anna@example.test", exact]],
      ["email", "first_name"],
    );
    expect(rows[0].first_name).toBe(exact);
    expect(oversized).toEqual([]);
  });

  it(`tag ${CRM_TAG_MAX} znaków przechodzi, ${CRM_TAG_MAX + 1} jest zgłaszany i nieprzycięty`, () => {
    const ok = "t".repeat(CRM_TAG_MAX);
    const tooLong = "u".repeat(CRM_TAG_MAX + 1);
    const { rows, oversized } = mapImportRows(
      [
        ["anna@example.test", `eu|${ok}`],
        ["jan@example.test", `eu|${tooLong}`],
      ],
      ["email", "tags"],
    );
    expect(rows[0].tags).toEqual(["eu", ok]);
    expect(rows[1].tags).toEqual(["eu", tooLong]);
    expect(oversized).toEqual([
      { row: 3, column: 1, field: "tags", kind: "length", limit: CRM_TAG_MAX },
    ]);
  });

  it("ponad limit tagów w komórce to zgłoszenie, nie odcięcie nadmiaru", () => {
    const value = Array.from({ length: IMPORT_MAX_TAGS + 1 }, (_, i) => `tag${i}`).join("|");
    const { rows, oversized } = mapImportRows([["anna@example.test", value]], ["email", "tags"]);
    expect(rows[0].tags).toHaveLength(IMPORT_MAX_TAGS + 1);
    expect(oversized).toEqual([
      { row: 2, column: 1, field: "tags", kind: "count", limit: IMPORT_MAX_TAGS },
    ]);
  });

  it("e-mail ponad limit też jest zgłaszany (serwer odrzuciłby całą porcję)", () => {
    const email = `${"a".repeat(LEAD_IMPORT_VALUE_MAX.email)}@example.test`;
    const { oversized } = mapImportRows([[email]], ["email"]);
    expect(oversized).toEqual([
      { row: 2, column: 0, field: "email", kind: "length", limit: LEAD_IMPORT_VALUE_MAX.email },
    ]);
  });

  it("numery wierszy z parsera (po pustych liniach) wygrywają z indeksem", () => {
    const { oversized } = mapImportRows(
      [["anna@example.test", "x".repeat(LEAD_IMPORT_VALUE_MAX.phone + 1)]],
      ["email", "phone"],
      [7],
    );
    expect(oversized[0]?.row).toBe(7);
  });

  it("duplikat i wiersz bez e-maila nie są zgłaszane - i tak odpadają", () => {
    const long = "x".repeat(LEAD_IMPORT_VALUE_MAX.company + 1);
    const { oversized } = mapImportRows(
      [
        ["anna@example.test", "Acme"],
        ["anna@example.test", long],
        ["bez-maila", long],
      ],
      ["email", "company"],
    );
    expect(oversized).toEqual([]);
  });

  it("liczba wierszy ponad limit jest odcięta i policzona", () => {
    const many = Array.from({ length: IMPORT_MAX_ROWS + 3 }, (_, i) => [`lead${i}@example.test`]);
    const { rows, droppedOverLimit } = mapImportRows(many, ["email"]);
    expect(rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(droppedOverLimit).toBe(3);
  });
});

describe("splitTags", () => {
  it("dzieli po |, ; oraz , i przycina spacje", () => {
    expect(splitTags(" eu | energia ; klimat , polityka ")).toEqual([
      "eu",
      "energia",
      "klimat",
      "polityka",
    ]);
  });

  it("puste człony odpadają", () => {
    expect(splitTags("eu||;,energia")).toEqual(["eu", "energia"]);
  });

  it("liczba tagów NIE jest obcinana - nadmiar zgłasza mapowanie", () => {
    const value = Array.from({ length: IMPORT_MAX_TAGS + 5 }, (_, i) => `tag${i}`).join("|");
    expect(splitTags(value)).toHaveLength(IMPORT_MAX_TAGS + 5);
  });

  it("komórka bez treści nie daje żadnego tagu", () => {
    expect(splitTags("   ")).toEqual([]);
  });
});

describe("looksLikeEmail", () => {
  it("przyjmuje adres z domeną, odrzuca resztę", () => {
    expect(looksLikeEmail("anna@example.test")).toBe(true);
    expect(looksLikeEmail("anna@example")).toBe(false);
    expect(looksLikeEmail("anna")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });
});
