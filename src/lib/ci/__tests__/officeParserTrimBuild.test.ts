// @vitest-environment node
//
// Wtyczka `nes:office-parser-trim` na PRAWDZIWYM buildzie Vite - dowód, którego
// `officeParserTrim.test.ts` z konstrukcji dać nie może.
//
// TAMTEN PLIK sprawdza założenia o źródłach mammoth i xmldom oraz dopasowanie
// przekierowań. Nie mówi nic o tym, czy Rollup z wtyczką commonjs w ogóle
// zapyta naszą wtyczkę o `require("./entities")` z wnętrza xmldom (importer
// przychodzi wtedy jako id modułu CJS, nie jako zwykła ścieżka), ani o tym, czy
// bundel z modułami zastępczymi DZIAŁA. Ten plik buduje mammoth dwa razy - z
// wtyczką i bez - tym samym `vite build` co produkcja (środowisko przeglądarki,
// esbuild), wykonuje oba bundle na prawdziwym pliku .docx złożonym w teście
// i porównuje HTML z wynikiem nietkniętej biblioteki uruchomionej w Node.
//
// Plik testowy niesie wszystko, co przechodzi przez wycięte miejsca: pięć encji
// XML (`&amp; &lt; &gt; &quot; &apos;`) i encję numeryczną - to jedyna droga,
// którą parser sięga po tablicę encji - oraz znaki Symbol/Wingdings (`w:sym`,
// tablica dingbatów) i styl akapitu z mapy stylów, której używa podgląd.
// Zastępca bluebirda (`promises`) jest na ścieżce KAŻDEJ konwersji, więc
// dodatkowo porównujemy oba bundle na wszystkich plikach .docx z testów
// mammoth: obrazy, przypisy, komentarze, tabele, listy, pola tekstowe, błąd
// zewnętrznego obrazu, format strict, BOM i pusty dokument.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { officeParserTrimPlugin } from "../../../../scripts/lib/officeParserTrim";

const require = createRequire(import.meta.url);

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

/** Minimalny, poprawny .docx: typy zawartości, relacje, dokument i style. */
async function docx(): Promise<ArrayBuffer> {
  const JSZip = require("jszip") as typeof import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
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
      "</Relationships>",
  );
  zip.file("word/document.xml", DOCUMENT_XML);
  zip.file("word/styles.xml", STYLES_XML);
  return zip.generateAsync({ type: "arraybuffer" });
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

/** Buduje mammoth jak produkcja (przeglądarka, esbuild) i ładuje wynik. */
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
      minify: "esbuild",
      rollupOptions: {
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
  }, 60_000);

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

  it("pliki testowe mammoth: ten sam HTML i te same komunikaty z obu bundli", async () => {
    const dir = join(require.resolve("mammoth/package.json"), "../test/test-data");
    const files = readdirSync(dir).filter((name) => name.endsWith(".docx"));
    expect(files.length).toBeGreaterThanOrEqual(15);
    const outcome = async (convert: Convert, input: ArrayBuffer) => {
      try {
        return await convert(input);
      } catch (error) {
        return { error: String(error) };
      }
    };
    for (const name of files) {
      const buffer = readFileSync(join(dir, name));
      const input = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      expect(await outcome(trimmed.convert, input), name).toEqual(
        await outcome(full.convert, input),
      );
    }
  });

  it("z bundla zniknęły wycięte i zastąpione części", () => {
    // `Aacute` - pierwsza pozycja tablicy encji HTML; „Missing element name"
    // - komunikat `XMLElement` z xmlbuilder; „circular promise resolution
    // chain" - błąd bluebirda; „Typeface name" - klucz wierszy tablicy
    // dingbatów. Wszystkie są w bundlu bez wtyczki, więc ich brak dowodzi, że
    // przekierowanie zadziałało, a nie że test szuka nieistniejącego napisu.
    for (const marker of [
      "Aacute",
      "Missing element name",
      "circular promise resolution chain",
      "Typeface name",
    ]) {
      expect(full.code, marker).toContain(marker);
      expect(trimmed.code, marker).not.toContain(marker);
    }
    expect(trimmed.code).toContain("encji HTML jest wycięta");
    expect(trimmed.code.length).toBeLessThan(full.code.length - 250_000);
  });
});
