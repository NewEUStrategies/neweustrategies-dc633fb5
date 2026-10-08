// Parser .docx w bundlu przeglądarki bez martwego i przewymiarowanego kodu:
// przekierowania modułów ZAWĘŻONE DO IMPORTERA.
//
// PO CO. Podgląd .docx (`src/lib/files/officeParse.ts` -> `mammoth.convertToHtml`)
// to chunk ~99 KB gzip. Dwie jego części nie wykonują się nigdy, bo żadna
// ścieżka z `convertToHtml` do nich nie prowadzi:
//
//   1. `xmlbuilder` (~9 KB gzip). W mammoth wymaga go tylko
//      `lib/xml/writer.js` (`writeString`), a `writeString` woła wyłącznie
//      `docx/style-map.js#writeStyleMap` - zapis mapy stylów DO pliku, czyli
//      publiczne `embedStyleMap`. Aplikacja tego API nie używa (czyta, nie pisze).
//   2. Tablica encji HTML z `@xmldom/xmldom/lib/entities.js` (~13 KB gzip).
//      `DOMParser#parseFromString` bierze ją tylko dla typu MIME `text/html`
//      (`isHTML ? HTML_ENTITIES : XML_ENTITIES`), a mammoth woła
//      `parseFromString(string)` bez typu - zawsze XML.
//
// Dwie kolejne wykonują się, ale niosą wielokrotnie więcej kodu niż zadanie,
// więc dostają zastępców o TEJ SAMEJ semantyce (wynik konwersji bez zmian):
//
//   3. bluebird (~21 KB gzip) pod `mammoth/lib/promises.js`. Mammoth bierze
//      z niego kilka funkcji i metod łańcucha; `vendor/mammothPromises.ts`
//      daje je na natywnym `Promise`. Przekierowany jest import `promises`
//      z KAŻDEGO pliku mammoth, który go wymaga (lista niżej, test pilnuje
//      kompletności i tego, że mammoth nie woła niczego spoza zastępcy).
//   4. Tablica `dingbat-to-unicode` (~12 KB gzip, 1061 obiektów z pięcioma
//      polami tekstowymi), z której `docx/body-reader.js` czyta jedno: znak
//      Unicode dla `<w:sym>`. `vendor/dingbatToUnicode.ts` niesie te same
//      pary w zwięzłym zapisie; test porównuje z pakietem każde zapytanie.
//
// Bramka `overall` w `scripts/check-bundle-size.ts` liczy ten chunk przy każdym
// buildzie (kronika, wpisy XXII i XXIV); razem to ~55 KB gzip kodu, który albo
// nie ma prawa się wykonać, albo robi to samo co kilka kB zastępcy.
//
// ZASADA: PRZEKIEROWANIE WYŁĄCZNIE PO PARZE (specyfikator, importer). Ten sam
// specyfikator z innego pliku rozwiązuje się normalnie - inny pakiet, który
// kiedyś zacznie używać `xmlbuilder`, dostanie prawdziwą bibliotekę. Encje są
// wspólne dla WSZYSTKICH klientów xmldom, więc dla nich wtyczka dodatkowo
// sprawdza graf: jeśli xmldom ma w bundlu przeglądarki importera spoza mammoth,
// build PADA z nazwą tego importera (nowy klient mógłby parsować HTML).
//
// ZAKRES: tylko `vite build` i tylko środowisko przeglądarki (`client`).
// Serwer, proces arkuszy i dev (esbuild prebundluje mammoth bez wtyczek Rollupa)
// dostają nietknięte pakiety - zachowanie jest to samo, różni się tylko waga.
//
// ZAŁOŻENIA SĄ PRZYPIĘTE TESTAMI: `src/lib/ci/__tests__/officeParserTrim.test.ts`
// czyta źródła mammoth, xmldom i dingbat-to-unicode (aktualizacja pakietu, która
// zmieni którąś ścieżkę, zapali test), a `officeParserTrimBuild.test.ts` buduje
// mammoth z tą wtyczką i porównuje HTML i komunikaty z prawdziwych plików .docx
// (własny plik testu i wszystkie pliki testowe mammoth) z wynikiem nietkniętej
// biblioteki.
//
// Współdzielona przez vite.config.ts i vite.smoke.config.ts (parytet pilnuje
// src/lib/ci/__tests__/viteChunkParity.test.ts).
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

/** Jedno przekierowanie: `require(source)` z pliku `importer` -> `replacement`. */
export interface OfficeParserRedirect {
  /** Specyfikator dokładnie tak, jak stoi w `require()` importera. */
  readonly source: string;
  /** Końcówka ścieżki importera, od `/node_modules/`. */
  readonly importer: string;
  /** Moduł zastępczy, ścieżka od korzenia repozytorium. */
  readonly replacement: string;
}

export const OFFICE_PARSER_REDIRECTS: readonly OfficeParserRedirect[] = [
  {
    source: "xmlbuilder",
    importer: "/node_modules/mammoth/lib/xml/writer.js",
    replacement: "src/lib/files/vendor/mammothXmlWriter.ts",
  },
  {
    source: "./entities",
    importer: "/node_modules/@xmldom/xmldom/lib/dom-parser.js",
    replacement: "src/lib/files/vendor/xmldomXmlEntities.ts",
  },
  {
    source: "dingbat-to-unicode",
    importer: "/node_modules/mammoth/lib/docx/body-reader.js",
    replacement: "src/lib/files/vendor/dingbatToUnicode.ts",
  },
  // `require("…/promises")` z każdego pliku mammoth poza CLI (`lib/main.js`).
  // `lib/unzip.js` i `lib/docx/files.js` w przeglądarce podmienia pole
  // `browser` pakietu, ale para zostaje - gdyby mapa `browser` się zmieniła.
  ...(
    [
      ["./promises", "lib/images.js"],
      ["./promises", "lib/document-to-html.js"],
      ["./promises", "lib/unzip.js"],
      ["../promises", "lib/xml/reader.js"],
      ["../promises", "lib/docx/office-xml-reader.js"],
      ["../promises", "lib/docx/files.js"],
      ["../promises", "lib/docx/docx-reader.js"],
      ["../promises", "lib/docx/style-map.js"],
      ["../lib/promises", "browser/unzip.js"],
      ["../../lib/promises", "browser/docx/files.js"],
    ] as const
  ).map(([source, file]) => ({
    source,
    importer: `/node_modules/mammoth/${file}`,
    replacement: "src/lib/files/vendor/mammothPromises.ts",
  })),
];

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const XMLDOM_DIR = "/node_modules/@xmldom/xmldom/";
const MAMMOTH_DIR = "/node_modules/mammoth/";

/** Id modułu bez sufiksów wirtualnych (`?commonjs-proxy`, `\0`) i z ukośnikami POSIX. */
function normalizeId(id: string): string {
  return id.replaceAll("\\", "/").replace(/^\0/, "").split("?")[0] ?? "";
}

/** Przekierowanie dla pary (specyfikator, importer) albo `undefined`. */
export function matchOfficeParserRedirect(
  source: string,
  importer: string | undefined,
): OfficeParserRedirect | undefined {
  if (importer === undefined) return undefined;
  const from = normalizeId(importer);
  return OFFICE_PARSER_REDIRECTS.find(
    (redirect) => redirect.source === source && from.endsWith(redirect.importer),
  );
}

/** Bezwzględna ścieżka modułu zastępczego. */
export function redirectTarget(redirect: OfficeParserRedirect): string {
  return join(REPO_ROOT, redirect.replacement);
}

/** Podzbiór `Rollup.ModuleInfo` potrzebny do kontroli grafu (testy podają atrapy). */
export interface TrimGraphModule {
  readonly importers: readonly string[];
}

/**
 * Importerzy xmldom spoza samego xmldom i spoza mammoth. Pusta lista = jedynym
 * klientem parsera jest mammoth, czyli tablica encji HTML jest nieosiągalna.
 */
export function foreignXmldomImporters(
  moduleIds: Iterable<string>,
  moduleInfo: (id: string) => TrimGraphModule | null,
): string[] {
  const foreign = new Set<string>();
  for (const id of moduleIds) {
    if (!normalizeId(id).includes(XMLDOM_DIR)) continue;
    for (const importer of moduleInfo(id)?.importers ?? []) {
      const from = normalizeId(importer);
      if (!from.includes(XMLDOM_DIR) && !from.includes(MAMMOTH_DIR)) foreign.add(from);
    }
  }
  return [...foreign].sort();
}

export function officeParserTrimPlugin(): Plugin {
  return {
    name: "nes:office-parser-trim",
    apply: "build",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.config.consumer === "client",
    resolveId(source, importer) {
      const redirect = matchOfficeParserRedirect(source, importer);
      return redirect ? redirectTarget(redirect) : null;
    },
    buildEnd(error) {
      if (error) return;
      const foreign = foreignXmldomImporters(this.getModuleIds(), (id) => this.getModuleInfo(id));
      if (foreign.length > 0) {
        this.error(
          "nes:office-parser-trim: xmldom ma w bundlu przeglądarki importera spoza mammoth " +
            `(${foreign.join(", ")}). Tablica encji HTML jest wycięta (parsujemy tylko XML) - ` +
            "sprawdź, czy nowy klient nie parsuje HTML, i zaktualizuj scripts/lib/officeParserTrim.ts.",
        );
      }
    },
  };
}
