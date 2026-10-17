// @vitest-environment node
//
// Wtyczka `nes:office-parser-trim` na PRAWDZIWYM buildzie Vite - dowód, którego
// `officeParserTrim.test.ts` z konstrukcji dać nie może.
//
// TAMTEN PLIK sprawdza założenia o źródłach mammoth i xmldom oraz dopasowanie
// przekierowań. Nie mówi nic o tym, czy bundler w ogóle zapyta naszą wtyczkę
// o `require("./entities")` z wnętrza xmldom (CJS: Rolldown rozwiązuje
// `require()` przez `resolveId` z importerem jako zwykłą ścieżką; Rollup z
// wtyczką commonjs podawał id modułu-proxy), ani o tym, czy bundel z modułami
// zastępczymi DZIAŁA. Ten plik buduje mammoth dwa razy - z wtyczką i bez - tym
// samym `vite build` co produkcja (środowisko przeglądarki, minifikacja Oxc),
// wykonuje oba bundle na prawdziwym pliku .docx złożonym w teście i porównuje
// HTML z wynikiem nietkniętej biblioteki uruchomionej w Node.
//
// Plik testowy niesie wszystko, co przechodzi przez wycięte miejsca: pięć encji
// XML (`&amp; &lt; &gt; &quot; &apos;`) i encję numeryczną - to jedyna droga,
// którą parser sięga po tablicę encji - oraz znaki Symbol/Wingdings (`w:sym`,
// tablica dingbatów) i styl akapitu z mapy stylów, której używa podgląd.
// Drugi plik testowy to Unicode spoza BMP, pismo od prawej, znaki łączące,
// końce linii XML 1.1, tabela, przypis, hiperłącze i osadzony obraz.
// Zastępcy bluebirda, underscore, jszip i xmldom są na ścieżce KAŻDEJ
// konwersji, więc dodatkowo porównujemy oba bundle na wszystkich plikach .docx
// i .zip z testów mammoth (obrazy, przypisy, komentarze, tabele, listy, pola
// tekstowe, błąd zewnętrznego obrazu, format strict, BOM, pusty dokument, zip
// bez dokumentu) i na plikach uszkodzonych.
//
// XML W BUNDLU Z WTYCZKĄ PARSUJE NATYWNY `DOMParser` - w Node podstawiamy
// jsdom (drzewo jak w xmldom - dowód drzewo po drzewie w
// `officeParserTrim.test.ts`; ten sam bundel uruchomiony przy wdrożeniu
// w Chromium przez Playwright dał ten sam HTML na wszystkich plikach tego
// testu, poza CI). Błąd to błąd: komunikaty xmldom
// i jszip różnią się od komunikatów zastępców, a podgląd ich nie pokazuje,
// więc dla plików, których nie da się odczytać, porównujemy tylko to, że
// OBA bundle odrzucają plik.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { officeParserTrimPlugin } from "../../../../scripts/lib/officeParserTrim";

const require = createRequire(import.meta.url);

/** jsdom bez typów (`@types/jsdom` nie jest zależnością) - test bierze z okna tylko `DOMParser`. */
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => {
    window: { DOMParser: typeof DOMParser; document: Document };
  };
};

/** Ten sam `styleMap`, z którym woła `src/lib/files/officeParse.ts#parseDocx`. */
const STYLE_MAP = ["p[style-name='Quote'] => blockquote:fresh"];

type ConvertResult = { value: string; messages: unknown[] };
type Convert = (buffer: ArrayBuffer) => Promise<ConvertResult>;

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:document ${W}><w:body>` +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">' +
  "Raport &amp; &lt;dane&gt; &quot;Q3&quot; &apos;26 &#x17B;ółć</w:t></w:r></w:p>" +
  '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>Cytat</w:t></w:r></w:p>' +
  "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Pogrubione</w:t></w:r>" +
  '<w:r><w:sym w:font="Wingdings" w:char="F04A"/></w:r>' +
  '<w:r><w:sym w:font="Symbol" w:char="F061"/></w:r></w:p>' +
  "</w:body></w:document>";
const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>` +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>' +
  "</w:styles>";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const R = `xmlns:r="${REL}"`;
const RICH_DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<w:document ${W} ${R}><w:body>` +
  "<w:p><w:r><w:t>Zażółć gęślą jaźń 🙂 漢字 مرحبا e\u0301 \u2028linia\u0085dalej</w:t></w:r>" +
  '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
  '<w:p><w:hyperlink r:id="rLink"><w:r><w:t>odnośnik</w:t></w:r></w:hyperlink></w:p>' +
  "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>" +
  "<w:tc><w:p><w:r><w:t>B1 &amp; ż</w:t></w:r></w:p></w:tc></w:tr>" +
  '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>scalone</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
  '<wp:docPr id="1" name="Obraz" descr="opis obrazu"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData>' +
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill>' +
  '<a:blip r:embed="rImage"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>' +
  "</wp:inline></w:drawing></w:r></w:p>" +
  "</w:body></w:document>";
const FOOTNOTES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W}>` +
  '<w:footnote w:id="1"><w:p><w:r><w:t>Przypis ż</w:t></w:r></w:p></w:footnote></w:footnotes>';
/** 1x1 PNG. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** Poprawny .docx: typy zawartości, relacje, dokument, style i części dodatkowe. */
async function docx(
  documentXml = DOCUMENT_XML,
  parts: Record<string, string | Uint8Array> = {},
  relationships = "",
): Promise<ArrayBuffer> {
  const JSZip = require("jszip") as typeof import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      relationships +
      "</Relationships>",
  );
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", STYLES_XML);
  for (const [path, content] of Object.entries(parts)) zip.file(path, content);
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/** Drugi plik testowy: Unicode, końce linii, tabela, przypis, hiperłącze, obraz. */
function richDocx(): Promise<ArrayBuffer> {
  return docx(
    RICH_DOCUMENT_XML,
    { "word/footnotes.xml": FOOTNOTES_XML, "word/media/image1.png": PNG },
    `<Relationship Id="rNotes" Type="${REL}/footnotes" Target="footnotes.xml"/>` +
      `<Relationship Id="rLink" Type="${REL}/hyperlink" Target="https://example.com/ż?a=1&amp;b=2" TargetMode="External"/>` +
      `<Relationship Id="rImage" Type="${REL}/image" Target="media/image1.png"/>`,
  );
}

/** Wejście bundla jako moduł wirtualny - gołe `mammoth` rozwiązuje się od korzenia repo. */
function entryPlugin(): Plugin {
  const id = "\0nes-office-parser-trim-entry";
  return {
    name: "nes-test:entry",
    resolveId: (source) => (source === "virtual:entry" ? id : null),
    load: (loaded) =>
      loaded === id
        ? 'import { convertToHtml } from "mammoth";\n' +
          "export const convert = (arrayBuffer, styleMap) => convertToHtml({ arrayBuffer }, { styleMap });\n"
        : null,
  };
}

let workspace = "";

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "nes-office-parser-trim-"));
});

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

/** Buduje mammoth jak produkcja (przeglądarka, minifikacja Oxc) i ładuje wynik. */
async function bundle(
  name: string,
  plugins: Plugin[],
): Promise<{ convert: Convert; code: string }> {
  const outDir = join(workspace, name);
  await build({
    configFile: false,
    envFile: false,
    root: process.cwd(),
    publicDir: false,
    logLevel: "silent",
    plugins: [entryPlugin(), ...plugins],
    build: {
      outDir,
      emptyOutDir: true,
      minify: "oxc",
      rolldownOptions: {
        input: "virtual:entry",
        preserveEntrySignatures: "strict",
        output: { format: "es", entryFileNames: "entry.mjs" },
      },
    },
  });
  const file = join(outDir, "entry.mjs");
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    convert: (buffer: ArrayBuffer, styleMap: string[]) => Promise<ConvertResult>;
  };
  return { convert: (buffer) => mod.convert(buffer, STYLE_MAP), code: readFileSync(file, "utf8") };
}

/** Wynik albo sam fakt błędu (komunikaty zastępców są inne z założenia). */
async function outcome(convert: Convert, input: ArrayBuffer): Promise<ConvertResult | "ERROR"> {
  try {
    return await convert(input);
  } catch {
    return "ERROR";
  }
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe("nes:office-parser-trim - prawdziwy build mammoth", () => {
  let full: { convert: Convert; code: string };
  let trimmed: { convert: Convert; code: string };
  let reference: ConvertResult;
  let bytes: ArrayBuffer;

  beforeAll(async () => {
    bytes = await docx();
    full = await bundle("full", []);
    trimmed = await bundle("trimmed", [officeParserTrimPlugin()]);
    const mammoth = require("mammoth") as {
      convertToHtml: (input: { buffer: Buffer }, options: object) => Promise<ConvertResult>;
    };
    reference = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes) },
      { styleMap: STYLE_MAP },
    );
    // Bundel z wtyczką parsuje XML natywnym `DOMParser` przeglądarki.
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
  }, 60_000);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("plik testowy przechodzi przez encje, znaki Wingdings/Symbol i mapę stylów", () => {
    expect(reference.value).toBe(
      '<h1>Raport &amp; &lt;dane&gt; "Q3" \'26 Żółć</h1>' +
        "<blockquote>Cytat</blockquote>" +
        "<p><strong>Pogrubione</strong>☺α</p>",
    );
  });

  it("bundel z wtyczką daje TEN SAM HTML i te same komunikaty co nietknięta biblioteka", async () => {
    const result = await trimmed.convert(bytes);
    expect(result.value).toBe(reference.value);
    expect(result.messages).toEqual(reference.messages);
    expect(await full.convert(bytes)).toEqual(result);
  });

  it("Unicode, końce linii, tabela, przypis, hiperłącze i obraz: ten sam HTML", async () => {
    const rich = await richDocx();
    const expected = await full.convert(rich);
    // Treść naprawdę przeszła przez wszystkie gałęzie (a nie: dwa razy pusto).
    expect(expected.value).toContain("Zażółć gęślą jaźń 🙂 漢字 مرحبا e\u0301 \nlinia\ndalej");
    expect(expected.value).toContain("<table>");
    expect(expected.value).toContain('<td colspan="2">');
    expect(expected.value).toContain("Przypis ż");
    expect(expected.value).toContain('href="https://example.com/ż?a=1&amp;b=2"');
    expect(expected.value).toContain('<img alt="opis obrazu" src="data:image/png;base64,');
    expect(await trimmed.convert(rich)).toEqual(expected);
  });

  it("pliki testowe mammoth (.docx i .zip): ten sam HTML i te same komunikaty z obu bundli", async () => {
    const dir = join(require.resolve("mammoth/package.json"), "../test/test-data");
    const files = readdirSync(dir).filter((name) => /\.(docx|zip)$/.test(name));
    expect(files.length).toBeGreaterThanOrEqual(17);
    let converted = 0;
    for (const name of files) {
      const input = toArrayBuffer(readFileSync(join(dir, name)));
      const expected = await outcome(full.convert, input);
      expect(await outcome(trimmed.convert, input), name).toEqual(expected);
      if (expected !== "ERROR") converted++;
    }
    // Dwa archiwa .zip bez dokumentu Worda to błąd w obu bundlach, reszta to HTML.
    expect(converted).toBe(files.length - 2);
  });

  it("pliki uszkodzone: oba bundle odrzucają", async () => {
    const good = new Uint8Array(await docx());
    const broken = (xml: string) => docx(xml);
    const inputs: Record<string, ArrayBuffer> = {
      "obcięty w połowie": toArrayBuffer(good.slice(0, good.length >> 1)),
      "obcięty o ostatni bajt": toArrayBuffer(good.slice(0, -1)),
      "bez pierwszych 30 bajtów": toArrayBuffer(good.slice(30)),
      "losowe bajty": toArrayBuffer(Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)),
      pusty: new ArrayBuffer(0),
      "PDF zamiast .docx": toArrayBuffer(new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n")),
      "niedomknięty element": await broken(`<w:document ${W}><w:body><w:p>`),
      "dwa korzenie": await broken(`<w:document ${W}/><w:document ${W}/>`),
      "nieznana encja": await broken(`<w:document ${W}><w:body>&nbsp;</w:body></w:document>`),
      "zdublowany atrybut": await broken(`<w:document ${W} a="1" a="2"/>`),
      "pusty dokument XML": await broken(""),
      "encja z DTD": await broken(
        `<!DOCTYPE w:document [<!ENTITY e "EE">]><w:document ${W}><w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>`,
      ),
    };
    for (const [label, input] of Object.entries(inputs)) {
      expect(await outcome(full.convert, input), label).toBe("ERROR");
      expect(await outcome(trimmed.convert, input), label).toBe("ERROR");
    }
  });

  it("ZNANA RÓŻNICA: XML niepoprawny składniowo, który przepuszczał xmldom, odrzuca przeglądarka", async () => {
    // Surowe `&` w tekście: xmldom czyta je jako znak, natywny parser zgłasza
    // błąd (tak samo jak Word, który takiego pliku nie otworzy). Pełna lista
    // przypadków w `officeParserTrim.test.ts`.
    const input = await docx(
      `<w:document ${W}><w:body><w:p><w:r><w:t>A & B</w:t></w:r></w:p></w:body></w:document>`,
    );
    expect(await outcome(full.convert, input)).toMatchObject({ value: "<p>A &amp; B</p>" });
    expect(await outcome(trimmed.convert, input)).toBe("ERROR");
  });

  it("z bundla zniknęły wycięte i zastąpione części", () => {
    // `Aacute` - pierwsza pozycja tablicy encji HTML; „Missing element name"
    // - komunikat `XMLElement` z xmlbuilder; „circular promise resolution
    // chain" - błąd bluebirda; „Typeface name" - klucz wierszy tablicy
    // dingbatów; „[xmldom " - prefiks komunikatów parsera xmldom; „1.13.8" -
    // `VERSION` underscore; „removed in JSZip 3.0" - komunikat jszip.
    // Wszystkie są w bundlu bez wtyczki, więc ich brak dowodzi, że
    // przekierowanie zadziałało, a nie że test szuka nieistniejącego napisu.
    for (const marker of [
      "Aacute",
      "Missing element name",
      "circular promise resolution chain",
      "Typeface name",
      "[xmldom ",
      "1.13.8",
      "removed in JSZip 3.0",
    ]) {
      expect(full.code, marker).toContain(marker);
      expect(trimmed.code, marker).not.toContain(marker);
    }
    expect(trimmed.code).toContain("DOMParser");
    expect(trimmed.code.length).toBeLessThan(full.code.length - 400_000);
  });
});
