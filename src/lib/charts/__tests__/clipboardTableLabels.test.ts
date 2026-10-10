// ETYKIETY Z HTML-A SCHOWKA - tekst, który sam niesie liczbę, zostaje tekstem.
//
// Surowa wartość (`x:num`) wygrywała w KAŻDEJ komórce z liczbą, także
// w kolumnie kategorii i w wierszu nazw serii: stawki VAT „5% | 8% | 23%"
// z Excela wchodziły na oś jako „5 | 8 | 23", a kody „001" jako „1" - choć
// ten sam zakres z `text/plain` dawał „5%" i „001". Schowek nie wie, która
// komórka będzie etykietą, więc tekst bez rozdzielacza, który daje dokładnie
// liczbę surową, zostaje - wartość z niego jest ta sama.
import { describe, expect, it } from "vitest";
import { readClipboardTable } from "@/lib/charts/clipboardTable";
import { parseImportedNumber, tableToChartData } from "@/lib/charts/importTable";
import { applyPasteAt } from "@/lib/charts/gridModel";

const STAWKI_HTML =
  '<style>.p{mso-number-format:"0%";}</style><table>' +
  "<tr><td>Stawka</td><td>Wpływy</td></tr>" +
  '<tr><td class=p x:num="0.05">5%</td><td x:num="12.5">12,5</td></tr>' +
  '<tr><td class=p x:num="0.08">8%</td><td x:num="20">20</td></tr>' +
  '<tr><td class=p x:num="0.23">23%</td><td x:num="150">150</td></tr></table>';
const STAWKI_TEKST = "Stawka\tWpływy\n5%\t12,5\n8%\t20\n23%\t150\n";

describe("etykiety z HTML-a schowka", () => {
  it("kategorie procentowe zostają „5%”, tak jak z tekstu; wartości bez zmian", () => {
    const zHtml = tableToChartData(readClipboardTable({ html: STAWKI_HTML })?.rows ?? [], {});
    const zTekstu = tableToChartData(readClipboardTable({ text: STAWKI_TEKST })?.rows ?? [], {});
    expect(zHtml.categories).toEqual(["5%", "8%", "23%"]);
    expect(zHtml.categories).toEqual(zTekstu.categories);
    expect(zHtml.series[0]?.values).toEqual([12.5, 20, 150]);
  });

  it("kody z zerami wiodącymi („001”) zostają kodami", () => {
    const html =
      "<table><tr><td>Kod</td><td>Wartość</td></tr>" +
      '<tr><td style=\'mso-number-format:"000"\' x:num="1">001</td><td x:num="7">7</td></tr>' +
      '<tr><td style=\'mso-number-format:"000"\' x:num="2">002</td><td x:num="8">8</td></tr></table>';
    expect(tableToChartData(readClipboardTable({ html })?.rows ?? [], {}).categories).toEqual([
      "001",
      "002",
    ]);
  });

  it("wklejone w kolumnę kategorii siatki - etykiety zostają tekstem z arkusza", () => {
    const rows = readClipboardTable({
      html:
        '<style>.p{mso-number-format:"0%";}</style><table>' +
        '<tr><td class=p x:num="0.05">5%</td><td x:num="1">1</td></tr>' +
        '<tr><td class=p x:num="0.23">23%</td><td x:num="2">2</td></tr></table>',
    })?.rows;
    const { model } = applyPasteAt(
      { categories: ["a", "b"], series: [{ name: "S", values: [null, null], colorSlot: 0 }] },
      rows ?? [],
      { row: 0, col: -1 },
    );
    expect(model.categories).toEqual(["5%", "23%"]);
    expect(model.series[0]?.values).toEqual([1, 2]);
  });

  it("ta sama liczba z tekstu, który został, i z surowej wartości", () => {
    const html =
      '<style>.p{mso-number-format:"0%";}</style><table><tr>' +
      '<td class=p x:num="0.25">25%</td><td x:num="1234">1 234 zł</td><td x:num="-3">(3)</td>' +
      "</tr></table>";
    const rows = readClipboardTable({ html })?.rows ?? [];
    expect(rows).toEqual([["25%", "1 234 zł", "(3)"]]);
    expect(rows[0].map((c) => parseImportedNumber(c))).toEqual([25, 1234, -3]);
  });

  it("tekst zaokrąglony albo zależny od konwencji ustępuje surowej wartości", () => {
    const html =
      "<table><tr>" +
      // Zaokrąglenie: „13%" nad 0,125 to 12,5, a nie 13.
      '<td style="mso-number-format:\'0%\'" x:num="0.125">13%</td>' +
      // „1,234" z angielskiego Excela to tysiąc dwieście trzydzieści cztery.
      '<td x:num="1234">1,234</td>' +
      "</tr></table>";
    expect(readClipboardTable({ html })?.rows).toEqual([["12.5", "1234"]]);
  });
});
