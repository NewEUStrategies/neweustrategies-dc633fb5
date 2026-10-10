// JEDNA KOMÓRKA Z ARKUSZA (`singleSheetCell`) - surowa wartość także z Arkuszy Google.
//
// Excel i LibreOffice wkładają jedną skopiowaną komórkę jako tabelę 1×1,
// a Arkusze Google - jako sam element z `data-sheets-value`, bez `<table>`.
// Funkcja szukała tabeli, więc dla Arkuszy oddawała `null`, a komórka siatki
// wklejała `text/plain`: „1,234" z angielskiego arkusza dawało 1,234 zamiast
// 1234 - tysiąc razy za mało, przy tym samym napisie w polu.
import { describe, expect, it } from "vitest";
import { readCellDraft, singleSheetCell } from "../gridCellValue";

/** Jedna komórka z Arkuszy Google - tak, jak trafia do schowka. */
function arkusze(value: string, display: string, numberFormat?: string): string {
  const format = numberFormat === undefined ? "" : ` data-sheets-numberformat="${numberFormat}"`;
  return (
    '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style>' +
    `<span data-sheets-root="1" data-sheets-value="${value}"${format}>${display}</span>` +
    "</google-sheets-html-origin>"
  );
}

describe("singleSheetCell - Arkusze Google bez tabeli", () => {
  it("„1,234” z angielskiego arkusza to 1234, jak w zakresie", () => {
    const html = arkusze("{&quot;1&quot;:3,&quot;3&quot;:1234}", "1,234");
    const komorka = singleSheetCell({ html, text: "1,234" });
    expect(komorka).toBe("1234");
    expect(readCellDraft(komorka ?? "").value).toBe(1234);
  });

  it("procent: surowa wartość · 100", () => {
    const html = arkusze(
      "{&quot;1&quot;:3,&quot;3&quot;:0.125}",
      "12.50%",
      "{&quot;1&quot;:3,&quot;2&quot;:&quot;0.00%&quot;}",
    );
    expect(singleSheetCell({ html, text: "12.50%" })).toBe("12.5");
  });

  it("data zostaje tekstem wyświetlanym, nie numerem dnia", () => {
    const html = arkusze(
      "{&quot;1&quot;:3,&quot;3&quot;:45306}",
      "2024-01-15",
      "{&quot;1&quot;:5,&quot;2&quot;:&quot;yyyy-mm-dd&quot;}",
    );
    expect(singleSheetCell({ html, text: "2024-01-15" })).toBe("2024-01-15");
  });

  it("komórka tekstowa daje swój tekst", () => {
    const html = arkusze("{&quot;1&quot;:2,&quot;2&quot;:&quot;PL&quot;}", "PL");
    expect(singleSheetCell({ html, text: "PL" })).toBe("PL");
  });
});

describe("singleSheetCell - pozostałe źródła", () => {
  it("Excel: tabela 1×1 z `x:num` jak dotąd", () => {
    const html = '<html><body><table><tr><td x:num="1234">1,234</td></tr></table></body></html>';
    expect(singleSheetCell({ html, text: "1,234" })).toBe("1234");
  });

  it("bez komórki arkusza - `null`, komórka wkleja zwykły tekst", () => {
    expect(singleSheetCell({ text: "1,234" })).toBeNull();
    expect(singleSheetCell({ html: "<p>1,234</p>", text: "1,234" })).toBeNull();
  });
});
