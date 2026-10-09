// SCHOWEK -> TABELA: prawdziwe próbki z Excela, Arkuszy Google, LibreOffice
// i Numbers.
//
// Próbki są przepisane z tego, co te programy NAPRAWDĘ wkładają do schowka
// (struktura, atrybuty, komentarze warunkowe Excela, JSON Arkuszy Google),
// skrócone do kilku komórek. Każda niesie pułapkę, która w naiwnym parserze
// daje inną liczbę niż ta, którą redaktor widzi w arkuszu:
//   - data z numerem dnia w `x:num` / `sdval` / `data-sheets-value`,
//   - procent z wartością ułamkową,
//   - waluta i spacja tysięcy w tekście wyświetlanym,
//   - komórki scalone, które przesuwają resztę wiersza,
//   - komórki wielowierszowe i cudzysłowy w TSV.
import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_MAX_CHARS,
  canonicalNumber,
  clipboardPayloadOf,
  isDateFormatCode,
  readClipboardTable,
} from "@/lib/charts/clipboardTable";
import { tableToChartData } from "@/lib/charts/importTable";

/** Excel 365 (Windows, lokalizacja polska): nagłówek z przestrzeniami nazw, style klas, fragment. */
const EXCEL_HTML = `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Excel.Sheet>
<meta name=Generator content="Microsoft Excel 15">
<link id=Main-File rel=Main-File href="file:///C:/Users/red/AppData/Local/Temp/msohtmlclip1/01/clip.htm">
<!--[if gte mso 9]><xml>
 <o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings>
</xml><![endif]-->
<style>
<!--table
	{mso-displayed-decimal-separator:"\\,";
	mso-displayed-thousand-separator:" ";}
@page
	{margin:.75in .7in .75in .7in;}
td
	{padding-top:1px;
	mso-number-format:General;
	white-space:nowrap;}
.xl65
	{mso-number-format:"Short Date";}
.xl66
	{mso-number-format:"0\\.0%";}
.xl67
	{mso-number-format:"\\#\\,\\#\\#0\\.00\\\\ \\0022zł\\0022";}
.xl68
	{mso-number-format:"mm\\.yyyy";}
.xl69
	{mso-number-format:Standard;}
-->
</style>
</head>
<body link="#0563C1" vlink="#954F72">
<table border=0 cellpadding=0 cellspacing=0 width=320 style='border-collapse:
 collapse;width:240pt'>
<!--StartFragment-->
 <col width=64 span=5 style='width:48pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 width=64 style='height:15.0pt;width:48pt'>Okres</td>
  <td width=64 style='width:48pt'>Eksport</td>
  <td width=64 style='width:48pt'>Udział</td>
  <td width=64 style='width:48pt'>Kwota</td>
  <td width=64 style='width:48pt'>Saldo</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl68 align=right style='height:15.0pt' x:num="45292">01.2024</td>
  <td align=right x:num="1234.5678">1234,568</td>
  <td class=xl66 align=right x:num="0.125">12,5%</td>
  <td class=xl67 align=right x:num="1234.5">1 234,50 zł</td>
  <td class=xl69 align=right x:num="1.234">1,23</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 align=right style='height:15.0pt' x:num="45306">15.01.2024</td>
  <td align=right x:num="-3">-3</td>
  <td class=xl66 align=right x:num="7.0000000000000007E-2">7,0%</td>
  <td class=xl67 align=right x:num>12,00 zł</td>
  <td x:str>b.d.</td>
 </tr>
 <![if supportMisalignedColumns]>
 <tr height=0 style='display:none'>
  <td width=64 style='width:48pt'></td>
  <td width=64 style='width:48pt'></td>
 </tr>
 <![endif]>
<!--EndFragment-->
</table>
</body>
</html>`;

/** Arkusze Google: element `google-sheets-html-origin`, JSON w `data-sheets-*`. */
const SHEETS_HTML =
  '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>' +
  '<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1">' +
  '<colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup><tbody>' +
  '<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Kraj</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Wartość</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Data</td></tr>' +
  '<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;PL&quot;}">PL</td>' +
  '<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:1234.5}" data-sheets-numberformat="{&quot;1&quot;:2,&quot;2&quot;:&quot;#,##0.00&quot;,&quot;3&quot;:1}">1,234.50</td>' +
  '<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:45306}" data-sheets-numberformat="{&quot;1&quot;:5,&quot;2&quot;:&quot;yyyy-mm-dd&quot;,&quot;3&quot;:1}">2024-01-15</td></tr>' +
  '<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Multi\\nline&quot;}">Multi<br>line</td>' +
  '<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:0.25}" data-sheets-numberformat="{&quot;1&quot;:3,&quot;2&quot;:&quot;0.00%&quot;,&quot;3&quot;:1}">25.00%</td>' +
  '<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:45307}" data-sheets-numberformat="{&quot;1&quot;:5,&quot;2&quot;:&quot;dd.mm&quot;,&quot;3&quot;:1}">16.01</td></tr>' +
  "</tbody></table></google-sheets-html-origin>";

/** LibreOffice Calc: `sdval` i `sdnum`, komórki scalone przez `colspan` i `rowspan`. */
const LIBRE_HTML = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/><title></title>
<meta name="generator" content="LibreOffice 7.6.4.1 (Linux)"/>
<style type="text/css">body,div,table,thead,tbody,tfoot,tr,th,td,p { font-family:"Liberation Sans"; font-size:x-small }</style>
</head>
<body>
<table cellspacing="0" border="0">
	<colgroup width="85"></colgroup>
	<colgroup span="2" width="85"></colgroup>
	<tr>
		<td height="17" align="left">Region</td>
		<td colspan=2 align="center">Wartości</td>
	</tr>
	<tr>
		<td height="17" align="left" sdval="45306" sdnum="1045;1045;DD.MM.YYYY">15.01.2024</td>
		<td align="right" sdval="1234.5" sdnum="1045;0;# ##0,00">1 234,50</td>
		<td align="right" sdval="0.125" sdnum="1045;0;0,0%">12,5%</td>
	</tr>
	<tr>
		<td rowspan=2 height="34" align="left" valign=middle>Śląsk</td>
		<td align="right" sdval="7" sdnum="1045;">7</td>
		<td align="right" sdval="8" sdnum="1045;">8</td>
	</tr>
	<tr>
		<td align="right" sdval="9" sdnum="1045;">9</td>
		<td align="right" sdval="10" sdnum="1045;">10</td>
	</tr>
</table>
</body></html>`;

describe("schowek - Excel (HTML)", () => {
  const table = readClipboardTable({ html: EXCEL_HTML, text: "nieużywany\tplan B" });

  it("czyta tabelę HTML, a nie tekst", () => {
    expect(table?.source).toBe("html");
    expect(table?.truncated).toBe(false);
  });

  it("liczby z `x:num`, daty i etykiety z tekstu, procent jak w pliku", () => {
    expect(table?.rows).toEqual([
      ["Okres", "Eksport", "Udział", "Kwota", "Saldo"],
      // „01.2024" ma format daty z klasy (mm.yyyy) - NIE numer dnia 45292.
      // Saldo w formacie „Standard" to liczba: surowe 1,234 w zapisie
      // kanonicznym, którego nikt nie weźmie za tysiąc.
      ["01.2024", "1234.5678", "12.5", "1234.5", "1.2340"],
      // Komórka z `x:num` bez wartości zostaje tekstem wyświetlanym.
      ["15.01.2024", "-3", "7", "12,00 zł", "b.d."],
    ]);
  });

  it("ukryty wiersz `supportMisalignedColumns` i komentarze nie dokładają danych", () => {
    expect(table?.rows).toHaveLength(3);
    expect(table?.cells).toBe(15);
  });
});

describe("schowek - Arkusze Google (HTML)", () => {
  it("liczba z `data-sheets-value`, data i procent po formacie", () => {
    const table = readClipboardTable({ html: SHEETS_HTML, text: "x" });
    expect(table?.source).toBe("html");
    expect(table?.rows).toEqual([
      ["Kraj", "Wartość", "Data"],
      // „1,234.50" w lokalizacji angielskiej: bez surowej wartości to byłaby
      // zagadka konwencji; z nią - 1234,5 bez dyskusji.
      ["PL", "1234.5", "2024-01-15"],
      // „16.01" wygląda na liczbę, ale format „dd.mm" mówi: data.
      ["Multi\nline", "25", "16.01"],
    ]);
  });
});

describe("schowek - LibreOffice (HTML)", () => {
  it("`sdval` dla liczb, `sdnum` z datą zostawia tekst, scalenia rozwinięte", () => {
    const table = readClipboardTable({ html: LIBRE_HTML });
    expect(table?.rows).toEqual([
      ["Region", "Wartości", ""],
      ["15.01.2024", "1234.5", "12.5"],
      ["Śląsk", "7", "8"],
      // `rowspan` zajmuje pierwszą kolumnę - bez rozwinięcia 9 i 10 lądowały
      // o kolumnę za wcześnie.
      ["", "9", "10"],
    ]);
  });
});

describe("schowek - HTML ogólnie", () => {
  it("scalenie w środku wiersza przesuwa resztę na właściwe kolumny", () => {
    const html =
      "<table><tr><td>a</td><td colspan=2 rowspan=2>b</td><td>c</td></tr>" +
      "<tr><td>d</td><td>e</td></tr></table>";
    expect(readClipboardTable({ html })?.rows).toEqual([
      ["a", "b", "", "c"],
      ["d", "", "", "e"],
    ]);
  });

  it("tabela zagnieżdżona w komórce nie dokłada wierszy", () => {
    const html =
      "<table><tr><td>a</td><td><table><tr><td>x</td></tr><tr><td>y</td></tr></table></td></tr>" +
      "<tr><td>b</td><td>2</td></tr></table>";
    const rows = readClipboardTable({ html })?.rows;
    expect(rows).toHaveLength(2);
    expect(rows?.[1]).toEqual(["b", "2"]);
  });

  it("styl i skrypt w komórce nie wchodzą do tekstu", () => {
    const html =
      "<table><tr><td>a<style>.x{}</style><script>1</script></td><td>b</td></tr></table>";
    expect(readClipboardTable({ html })?.rows).toEqual([["a", "b"]]);
  });

  it("wiersz bez komórek to pusty wiersz, nie dziura w tablicy", () => {
    const html =
      "<table><tr><td>a</td><td>1</td></tr><tr></tr><tr><td>b</td><td>2</td></tr></table>";
    expect(readClipboardTable({ html })?.rows).toEqual([
      ["a", "1"],
      ["", ""],
      ["b", "2"],
    ]);
  });

  it("komórka BEZ formatu, której tekst wygląda na datę, zostaje tekstem", () => {
    // Bez formatu nie ma pewności, czy `x:num` to liczba, czy numer dnia -
    // tekst wyświetlany jest wtedy bezpieczniejszy niż 45306 na osi.
    const html =
      '<table><tr><td x:num="45306">15.01.2024</td><td x:num="3.5">3,5</td></tr></table>';
    expect(readClipboardTable({ html })?.rows).toEqual([["15.01.2024", "3.5"]]);
  });

  it("HTML bez tabeli oddaje głos tekstowi", () => {
    const table = readClipboardTable({ html: "<p>akapit</p>", text: "a\tb\n1\t2" });
    expect(table?.source).toBe("tsv");
  });

  it("zawyżony colspan nie wysadza pamięci - jest przycięty", () => {
    const html = '<table><tr><td colspan="100000">a</td><td>b</td></tr></table>';
    const rows = readClipboardTable({ html })?.rows;
    expect(rows?.[0]).toHaveLength(257);
    expect(rows?.[0][256]).toBe("b");
  });
});

describe("schowek - tekst z tabulatorami", () => {
  it("TSV z Numbers (LF, bez cytowania)", () => {
    const table = readClipboardTable({ text: "Kraj\tWartość\nPolska\t12,5\nNiemcy\t8\n" });
    expect(table).toEqual({
      rows: [
        ["Kraj", "Wartość"],
        ["Polska", "12,5"],
        ["Niemcy", "8"],
      ],
      source: "tsv",
      cells: 6,
      truncated: false,
    });
  });

  it("Excel: komórka wielowierszowa, podwojony cudzysłów i tabulator w cytowanym polu", () => {
    const text =
      'Nazwa\tOpis\r\n"Kraków\nMałopolska"\t"Cytat ""w środku"" i\ttab"\r\nWarszawa\t2,5\r\n';
    expect(readClipboardTable({ text })?.rows).toEqual([
      ["Nazwa", "Opis"],
      ["Kraków\nMałopolska", 'Cytat "w środku" i\ttab'],
      ["Warszawa", "2,5"],
    ]);
  });

  it("zabłąkany cudzysłów z Arkuszy Google NIE skleja wierszy", () => {
    // Komórka „"abc" i komórka „Z"" - Arkusze ich nie cytują. Przebieg
    // z cytowaniem sklejałby „abc<TAB>1<LF>Z" w jedną komórkę.
    const text = '"abc\t1\nZ"\t2\nQ\t3';
    expect(readClipboardTable({ text })?.rows).toEqual([
      ['"abc', "1"],
      ['Z"', "2"],
      ["Q", "3"],
    ]);
  });

  it("niedomknięty cudzysłów czyta tekst dosłownie", () => {
    expect(readClipboardTable({ text: '"a\tb\nc\td' })?.rows).toEqual([
      ['"a', "b"],
      ["c", "d"],
    ]);
  });

  it("polskie przecinki dziesiętne przechodzą do wykresu jako ułamki", () => {
    const table = readClipboardTable({
      text: "\tWartość\nKraków, Małopolska\t1,5\nWrocław, Dolny Śląsk\t2,5\n",
    });
    expect(table?.rows[1]).toEqual(["Kraków, Małopolska", "1,5"]);
    const dane = tableToChartData(table?.rows ?? [], {});
    expect(dane.categories).toEqual(["Kraków, Małopolska", "Wrocław, Dolny Śląsk"]);
    expect(dane.series[0].values).toEqual([1.5, 2.5]);
  });

  it("puste wiersze i kolumny z końca są obcięte, środkowe zostają", () => {
    expect(readClipboardTable({ text: "a\tb\t\n\t\t\n1\t2\t\n\t\t\n" })?.rows).toEqual([
      ["a", "b"],
      ["", ""],
      ["1", "2"],
    ]);
  });

  it("wiele wierszy bez tabulatora to jedna kolumna (kopia kolumny z Excela)", () => {
    const table = readClipboardTable({ text: "Wartość\r\n1,5\r\n2,5\r\n" });
    expect(table?.source).toBe("text");
    expect(table?.rows).toEqual([["Wartość"], ["1,5"], ["2,5"]]);
  });
});

describe("schowek - to nie jest tabela", () => {
  it("jedna komórka z Excela (z końcowym CRLF) to null", () => {
    expect(readClipboardTable({ text: "12,5\r\n" })).toBeNull();
    expect(
      readClipboardTable({
        html: "<table><tr><td x:num='12.5'>12,5</td></tr></table>",
        text: "12,5",
      }),
    ).toBeNull();
  });

  it("jeden wiersz bez tabulatora to zwykły napis", () => {
    expect(readClipboardTable({ text: "Polska" })).toBeNull();
  });

  it("nic albo same odstępy to null", () => {
    expect(readClipboardTable({})).toBeNull();
    expect(readClipboardTable({ html: null, text: null })).toBeNull();
    expect(readClipboardTable({ text: " \r\n \n" })).toBeNull();
  });
});

describe("schowek - limit długości", () => {
  it("tekst ponad limit jest ucięty na granicy wiersza i oznaczony", () => {
    const row = "Kraj\t1,5\n";
    const text = row.repeat(Math.ceil(CLIPBOARD_MAX_CHARS / row.length) + 10);
    const table = readClipboardTable({ text });
    expect(table?.truncated).toBe(true);
    expect(table?.rows.every((r) => r[0] === "Kraj" && r[1] === "1,5")).toBe(true);
    expect(table?.rows.length).toBeLessThan(text.length / row.length);
  });

  it("HTML ponad limit nie jest parsowany - czyta się tekst", () => {
    const html = `<table><tr><td>a</td><td>b</td></tr></table>${" ".repeat(CLIPBOARD_MAX_CHARS)}`;
    const table = readClipboardTable({ html, text: "x\ty" });
    expect(table?.source).toBe("tsv");
    expect(table?.rows).toEqual([["x", "y"]]);
    expect(table?.truncated).toBe(false);
  });
});

describe("schowek - zdarzenie i formaty", () => {
  it("wyciąga obie postaci ze zdarzenia; pusta postać to null", () => {
    const dane: Record<string, string> = { "text/html": "", "text/plain": "a\tb" };
    const event = { clipboardData: { getData: (type: string) => dane[type] ?? "" } };
    expect(clipboardPayloadOf(event as unknown as ClipboardEvent)).toEqual({
      html: null,
      text: "a\tb",
    });
    expect(clipboardPayloadOf({ clipboardData: null } as unknown as ClipboardEvent)).toEqual({
      html: null,
      text: null,
    });
  });

  it("formaty dat i czasu we wszystkich dialektach", () => {
    for (const data of [
      "Short Date",
      "Medium Time",
      "dd.mm.yyyy",
      "DD.MM.YYYY",
      "mm\\.yyyy",
      "[$-415]d mmmm yyyy",
      "[h]:mm",
      "yyyy-mm-dd",
    ]) {
      expect(isDateFormatCode(data), data).toBe(true);
    }
    for (const liczba of [
      "General",
      "Standard",
      "0.0%",
      "#,##0.00",
      '#,##0.00\\ "zł"',
      "# ##0,00",
      "0.00E+00",
      "[Red]0.00",
      "@",
      "",
    ]) {
      expect(isDateFormatCode(liczba), liczba).toBe(false);
    }
  });

  it("zapis kanoniczny liczby", () => {
    expect(canonicalNumber(1234.5)).toBe("1234.5");
    expect(canonicalNumber(1.234)).toBe("1.2340");
    expect(canonicalNumber(-12.345)).toBe("-12.3450");
    expect(canonicalNumber(0.123)).toBe("0.123");
    expect(canonicalNumber(1e21)).toBe("1e+21");
    expect(canonicalNumber(Number.NaN)).toBe("");
  });
});
