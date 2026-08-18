// Reguły importu CSV - warstwa czysta.
//
// Import wprowadza na listę DANE OSOBOWE wraz ze statusem zgody marketingowej.
// Reguły są ciche (regexy nagłówków, słowniki dopuszczalnych wartości), a ich
// pomyłka nie wywala się głośno - zapisuje po prostu inne dane niż w pliku.
// Dlatego każda reguła ma tu przypadek z wartością spodziewaną i z wartością,
// której operator NIE spodziewa się w pliku.
import { describe, it, expect } from "vitest";
import {
  autoMapHeader,
  fieldKeyFromOption,
  optionFromFieldKey,
  SKIP_OPTION,
  buildImportRow,
  buildImportRows,
  looksLikeEmail,
  validRows,
  FIELD_KEYS,
  type FieldKey,
} from "@/components/admin/newsletter/subscribers/importCsvMapping";

describe("autoMapHeader - rozpoznanie kolumn", () => {
  it("rozpoznaje adres w typowych wariantach nagłówka", () => {
    expect(autoMapHeader(["email", "E-Mail", "e_mail", "mail", "Adres e-mail"])).toEqual([
      "email",
      "email",
      "email",
      "email",
      "email",
    ]);
    expect(autoMapHeader(["EMAIL"])).toEqual(["email"]);
  });

  it("rozpoznaje imię i nazwisko po polsku i angielsku", () => {
    expect(autoMapHeader(["Imie", "imię", "First name"])).toEqual([
      "firstName",
      "firstName",
      "firstName",
    ]);
    expect(autoMapHeader(["Nazwisko", "Last name", "surname"])).toEqual([
      "lastName",
      "lastName",
      "lastName",
    ]);
  });

  it("rozpoznaje język, status i źródło", () => {
    expect(autoMapHeader(["jezyk", "language", "lang"])).toEqual([
      "language",
      "language",
      "language",
    ]);
    expect(autoMapHeader(["Status"])).toEqual(["status"]);
    expect(autoMapHeader(["source", "Zrodlo"])).toEqual(["source", "source"]);
  });

  it("rozpoznaje firmę po nagłówku jednowyrazowym", () => {
    expect(autoMapHeader(["company", "Firma"])).toEqual(["company", "company"]);
    expect(autoMapHeader(["FIRMA"])).toEqual(["company"]);
  });

  it("UWAGA: nagłówek firmy ZAWIERAJĄCY słowo „nazwa”/„name” trafia do nazwy osoby", () => {
    // Zachowanie zastane, przeniesione bez zmiany. Reguła `(name|nazwa)` stoi
    // PRZED regułą `(company|firma)`, więc „Nazwa firmy" - najczęstszy nagłówek
    // w polskich eksportach CRM - mapuje się na pełną nazwę SUBSKRYBENTA.
    // Skutek: w bazie ląduje firma jako imię i nazwisko odbiorcy, a kolumna
    // firmy przepada. Naprawa idzie osobnym commitem.
    expect(autoMapHeader(["Nazwa firmy"])).toEqual(["displayName"]);
    expect(autoMapHeader(["company name"])).toEqual(["displayName"]);
  });

  it("ignoruje białe znaki i wielkość liter nagłówka", () => {
    expect(autoMapHeader(["  EMAIL  ", " Imie "])).toEqual(["email", "firstName"]);
    expect(autoMapHeader([""])).toEqual([""]);
  });

  it("nagłówek NIEROZPOZNANY zostaje pominięty - nie zgadujemy", () => {
    expect(autoMapHeader(["notatka", "id_wewnetrzny", "kolumna7"])).toEqual(["", "", ""]);
  });

  it("dopasowanie jest zachłanne - wygrywa PIERWSZA pasująca reguła", () => {
    // „first_name" pasuje i do reguły imienia, i do reguły pełnej nazwy;
    // reguła imienia jest wcześniej, więc to ona wygrywa.
    expect(autoMapHeader(["first_name"])).toEqual(["firstName"]);
    expect(autoMapHeader(["last_name"])).toEqual(["lastName"]);
  });

  it("pusty nagłówek pliku daje puste mapowanie", () => {
    expect(autoMapHeader([])).toEqual([]);
    expect(autoMapHeader([]).length).toBe(0);
  });
});

describe("looksLikeEmail", () => {
  it("przyjmuje adres z domeną i kropką", () => {
    expect(looksLikeEmail("anna@example.test")).toBe(true);
    expect(looksLikeEmail("a.b+tag@sub.example.test")).toBe(true);
  });

  it("odrzuca wartości, które adresem nie są", () => {
    expect(looksLikeEmail("anna")).toBe(false);
    expect(looksLikeEmail("anna@example")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail(undefined)).toBe(false);
  });
});

describe("validRows - które wiersze wejdą do importu", () => {
  const rows = [
    ["anna@example.test", "Anna"],
    ["to nie adres", "Borys"],
    ["", "Cezary"],
    ["cezary@example.test", "Cezary"],
  ];

  it("zostawia wyłącznie wiersze z adresem w zmapowanej kolumnie", () => {
    const result = validRows(rows, 0);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r[0])).toEqual(["anna@example.test", "cezary@example.test"]);
  });

  it("bez zmapowanej kolumny adresu nie ma czego importować", () => {
    expect(validRows(rows, -1)).toEqual([]);
    expect(validRows(rows, -1)).toHaveLength(0);
  });

  it("wiersz KRÓTSZY od nagłówka nie wywraca sprawdzenia", () => {
    expect(validRows([["anna@example.test"]], 3)).toEqual([]);
    expect(validRows([["anna@example.test"]], 0)).toHaveLength(1);
  });

  it("pusty plik daje pustą listę", () => {
    expect(validRows([], 0)).toEqual([]);
  });
});

describe("buildImportRow - składanie ładunku", () => {
  const mapping: FieldKey[] = ["email", "firstName", "lastName", "company"];

  it("przenosi zmapowane kolumny i przycina białe znaki", () => {
    const row = buildImportRow(["  anna@example.test  ", " Anna ", "Nowak", "ACME"], mapping);

    expect(row).toMatchObject({
      email: "anna@example.test",
      firstName: "Anna",
      lastName: "Nowak",
      company: "ACME",
    });
  });

  it("kolumny POMINIĘTE nie trafiają do ładunku", () => {
    const row = buildImportRow(
      ["anna@example.test", "Anna", "Nowak", "ACME"],
      ["email", "", "", ""],
    );

    expect(row.email).toBe("anna@example.test");
    expect(row.firstName).toBeUndefined();
    expect(row.company).toBeUndefined();
  });

  it("puste komórki znikają zamiast zapisywać pustkę", () => {
    const row = buildImportRow(["anna@example.test", "", "   ", ""], mapping);

    expect(row.firstName).toBeUndefined();
    expect(row.lastName).toBeUndefined();
  });

  it("wiersz NADMIAROWY (więcej kolumn niż mapowań) ignoruje nadmiar", () => {
    const row = buildImportRow(
      ["anna@example.test", "Anna", "Nowak", "ACME", "śmieć", "jeszcze"],
      mapping,
    );

    expect(row.email).toBe("anna@example.test");
    expect(Object.values(row)).not.toContain("śmieć");
  });

  it("wiersz KRÓTSZY od mapowania nie wywraca składania", () => {
    const row = buildImportRow(["anna@example.test"], mapping);

    expect(row.email).toBe("anna@example.test");
    expect(row.lastName).toBeUndefined();
  });
});

describe("buildImportRow - język", () => {
  const mapping: FieldKey[] = ["email", "language"];

  it("`en` daje angielski, wszystko inne polski", () => {
    expect(buildImportRow(["a@example.test", "en"], mapping).language).toBe("en");
    expect(buildImportRow(["a@example.test", "pl"], mapping).language).toBe("pl");
  });

  it("brak kolumny języka daje polski", () => {
    expect(buildImportRow(["a@example.test"], ["email"]).language).toBe("pl");
  });

  it("UWAGA: wariant zapisany WIELKĄ literą schodzi na polski", () => {
    // Zachowanie zastane i przeniesione bez zmiany. Plik wyeksportowany
    // z innego systemu ma zwykle „EN"/„En" - taki wiersz dostanie polski
    // szablon wiadomości mimo jawnej deklaracji w pliku.
    expect(buildImportRow(["a@example.test", "EN"], mapping).language).toBe("pl");
    expect(buildImportRow(["a@example.test", "en-GB"], mapping).language).toBe("pl");
  });
});

describe("buildImportRow - status zgody", () => {
  const mapping: FieldKey[] = ["email", "status"];

  it("rozpoznaje statusy słownikowe", () => {
    expect(buildImportRow(["a@example.test", "pending"], mapping).status).toBe("pending");
    expect(buildImportRow(["a@example.test", "unsubscribed"], mapping).status).toBe("unsubscribed");
    expect(buildImportRow(["a@example.test", "subscribed"], mapping).status).toBe("subscribed");
  });

  it("UWAGA: wartość SPOZA słownika staje się `subscribed`", () => {
    // Zachowanie zastane i przeniesione bez zmiany. Konsekwencja jest
    // poważna: plik z kolumną status = „unsub" / „wypisany" / pustą zapisuje
    // ZGODĘ MARKETINGOWĄ, której nikt nie wyraził.
    expect(buildImportRow(["a@example.test", "unsub"], mapping).status).toBe("subscribed");
    expect(buildImportRow(["a@example.test", "wypisany"], mapping).status).toBe("subscribed");
    expect(buildImportRow(["a@example.test", ""], mapping).status).toBe("subscribed");
    expect(buildImportRow(["a@example.test"], ["email"]).status).toBe("subscribed");
  });
});

describe("buildImportRows - cały plik", () => {
  const mapping: FieldKey[] = ["email", "firstName", "status"];

  it("składa wyłącznie wiersze z poprawnym adresem", () => {
    const rows = [
      ["anna@example.test", "Anna", "subscribed"],
      ["to nie adres", "Borys", "subscribed"],
      ["cezary@example.test", "Cezary", "pending"],
    ];

    const result = buildImportRows(rows, mapping);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.email)).toEqual(["anna@example.test", "cezary@example.test"]);
  });

  it("bez zmapowanej kolumny adresu nie powstaje ani jeden wiersz", () => {
    const result = buildImportRows([["anna@example.test", "Anna"]], ["", ""]);

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("UWAGA: duplikat W PLIKU przechodzi dalej - odsiewa go dopiero serwer", () => {
    const rows = [
      ["anna@example.test", "Anna", "subscribed"],
      ["Anna@Example.TEST", "Anna", "subscribed"],
    ];

    const result = buildImportRows(rows, mapping);

    // Dialog obiecuje w opisie „Duplikaty (po e-mail) sa pomijane", ale robi
    // to serwer; licznik w podglądzie pokazuje obie pozycje.
    expect(result).toHaveLength(2);
    expect(result[0]?.email).not.toBe(result[1]?.email);
  });

  it("pusty plik daje pustą listę", () => {
    expect(buildImportRows([], mapping)).toEqual([]);
  });
});

describe("wartości listy wyboru (granica UI)", () => {
  it("„pomiń” ma wartość zastępczą - kontrolka rezerwuje pusty napis", () => {
    // Radix Select traktuje `value=""` jako „brak zaznaczenia” i rzuca
    // wyjątkiem na pozycji listy z pustą wartością - dlatego pole „pomiń”
    // jedzie przez sentinel.
    expect(optionFromFieldKey("")).toBe(SKIP_OPTION);
    expect(SKIP_OPTION).not.toBe("");
  });

  it("pozostałe pola idą przez granicę bez zmiany", () => {
    expect(optionFromFieldKey("email")).toBe("email");
    expect(optionFromFieldKey("company")).toBe("company");
  });

  it("droga powrotna oddaje dokładnie to samo pole", () => {
    for (const key of FIELD_KEYS) {
      expect(fieldKeyFromOption(optionFromFieldKey(key))).toBe(key);
    }
    expect(fieldKeyFromOption(SKIP_OPTION)).toBe("");
  });
});

describe("lista pól do wyboru", () => {
  it("zawiera każde pole docelowe plus pozycję pomijania", () => {
    expect(FIELD_KEYS).toContain("email");
    expect(FIELD_KEYS).toContain("");
    expect(FIELD_KEYS).toHaveLength(9);
  });

  it("adres jest pierwszy - to jedyne pole wymagane", () => {
    expect(FIELD_KEYS[0]).toBe("email");
    expect(FIELD_KEYS.at(-1)).toBe("");
  });
});
