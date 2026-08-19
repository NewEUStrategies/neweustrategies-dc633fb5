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

  it("nagłówek firmy ZAWIERAJĄCY słowo „nazwa”/„name” nadal jest firmą", () => {
    // „Nazwa firmy" i „company name" to najczęstsze nagłówki w eksportach CRM,
    // a pasują do OBU wzorców. Przy odwrotnej kolejności firma lądowała w bazie
    // jako imię i nazwisko odbiorcy, a kolumna firmy przepadała.
    expect(autoMapHeader(["Nazwa firmy"])).toEqual(["company"]);
    expect(autoMapHeader(["company name"])).toEqual(["company"]);
    expect(autoMapHeader(["Nazwa organizacji", "Firma"])).toEqual(["displayName", "company"]);
    // Polska odmiana też: „firmy", „firmie".
    expect(autoMapHeader(["firmy", "W firmie"])).toEqual(["company", "company"]);
  });

  it("„confirmed” NIE jest firmą - granica słowa wyklucza fałszywe dopasowanie", () => {
    // Bez granicy słowa nagłówek daty potwierdzenia mapowałby się na firmę.
    expect(autoMapHeader(["confirmed_at"])).toEqual([""]);
  });

  it("nazwa OSOBY nadal trafia do nazwy wyświetlanej", () => {
    // Pierwszeństwo firmy nie może zabrać nagłówków, które firmy nie dotyczą.
    expect(autoMapHeader(["Nazwa", "Full name", "display name"])).toEqual([
      "displayName",
      "displayName",
      "displayName",
    ]);
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

  it("wariant WIELKĄ literą i regionalny też daje angielski", () => {
    // Pliki z innych systemów mają zwykle „EN", „En" albo „en-GB". Wcześniej
    // taki wiersz dostawał polski szablon wiadomości mimo jawnej deklaracji.
    expect(buildImportRow(["a@example.test", "EN"], mapping).language).toBe("en");
    expect(buildImportRow(["a@example.test", "En"], mapping).language).toBe("en");
    expect(buildImportRow(["a@example.test", "en-GB"], mapping).language).toBe("en");
    expect(buildImportRow(["a@example.test", " english "], mapping).language).toBe("en");
  });

  it("język nierozpoznany schodzi na polski - to nie jest zgoda, więc domyślna jest bezpieczna", () => {
    expect(buildImportRow(["a@example.test", "de"], mapping).language).toBe("pl");
    expect(buildImportRow(["a@example.test", ""], mapping).language).toBe("pl");
  });
});

describe("buildImportRow - status zgody", () => {
  const mapping: FieldKey[] = ["email", "status"];

  it("rozpoznaje statusy słownikowe", () => {
    expect(buildImportRow(["a@example.test", "pending"], mapping).status).toBe("pending");
    expect(buildImportRow(["a@example.test", "unsubscribed"], mapping).status).toBe("unsubscribed");
    expect(buildImportRow(["a@example.test", "subscribed"], mapping).status).toBe("subscribed");
  });

  it("rozpoznaje polskie i angielskie WARIANTY wypisania", () => {
    // Gdyby „unsub" schodził na `pending`, import wysłałby potwierdzenie zapisu
    // komuś, kto się wypisał.
    for (const word of ["unsub", "wypisany", "opt-out", "optout", "NIE", "0", "false"]) {
      expect(buildImportRow(["a@example.test", word], mapping).status, word).toBe("unsubscribed");
    }
  });

  it("rozpoznaje warianty zapisania i oczekiwania", () => {
    for (const word of ["Aktywny", "confirmed", "TAK", "1"]) {
      expect(buildImportRow(["a@example.test", word], mapping).status, word).toBe("subscribed");
    }
    for (const word of ["oczekujacy", "unconfirmed"]) {
      expect(buildImportRow(["a@example.test", word], mapping).status, word).toBe("pending");
    }
  });

  it("wartość NIEROZPOZNANA daje `pending` - nigdy zgody, której nikt nie wyraził", () => {
    // Wcześniej każda nierozpoznana wartość zapisywała ZGODĘ MARKETINGOWĄ,
    // a import nie miał jak tego zgłosić.
    expect(buildImportRow(["a@example.test", "cos-dziwnego"], mapping).status).toBe("pending");
    expect(buildImportRow(["a@example.test", "???"], mapping).status).toBe("pending");
  });

  it("PUSTA komórka w zmapowanej kolumnie statusu też daje `pending`", () => {
    // Brak wartości w kolumnie, którą operator zmapował, znaczy „nie wiem" -
    // a „nie wiem" nie jest zgodą.
    expect(buildImportRow(["a@example.test", ""], mapping).status).toBe("pending");
    expect(buildImportRow(["a@example.test", "   "], mapping).status).toBe("pending");
  });

  it("BRAK kolumny statusu to deklaracja operatora - lista wgrywana jako zapisana", () => {
    // Inna sytuacja niż nieczytelna wartość: operator wgrywa listę, którą
    // deklaruje jako swoją, i nie ma tu żadnej wartości do zignorowania.
    expect(buildImportRow(["a@example.test"], ["email"]).status).toBe("subscribed");
    expect(buildImportRow(["a@example.test", "Anna"], ["email", "firstName"]).status).toBe(
      "subscribed",
    );
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
