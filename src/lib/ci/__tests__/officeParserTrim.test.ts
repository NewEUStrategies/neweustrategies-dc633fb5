// @vitest-environment node
//
// Wtyczka `nes:office-parser-trim` (`scripts/lib/officeParserTrim.ts`) - martwy
// kod parsera .docx poza bundlem przeglądarki.
//
// CZEGO TEN PLIK PILNUJE. Wtyczka nie zmienia zachowania tylko dlatego, że
// dwie ścieżki w CUDZYCH pakietach są dziś nieosiągalne z `convertToHtml`.
// To są fakty o źródłach mammoth i xmldom, nie o naszym kodzie - więc test
// czyta te źródła z `node_modules` i pada przy aktualizacji, która którąś
// ścieżkę otworzy. Bez niego podbicie wersji mammoth mogłoby po cichu wpiąć
// wycięty moduł w ścieżkę podglądu, a pierwszym sygnałem byłby błąd u czytelnika.
//
// Bluebird, underscore, xmldom i tablica `dingbat-to-unicode` są zastąpione,
// a nie wycięte - tu test pilnuje, że mammoth i lop nie wołają niczego, czego
// zastępca nie ma, i że zastępca daje te same wyniki co pakiet (xmldom:
// natywny `DOMParser`, w teście w roli przeglądarki jsdom). Czytnik archiwów
// zamiast jszip ma własny test: `src/lib/files/__tests__/officeZip.test.ts`.
//
// Do tego: dopasowanie przekierowań (wyłącznie para specyfikator + importer),
// kontrola grafu xmldom i moduły zastępcze. Dowód na prawdziwym buildzie -
// HTML z plików .docx identyczny z nietkniętą biblioteką - jest
// w `officeParserTrimBuild.test.ts`.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  OFFICE_PARSER_REDIRECTS,
  foreignXmldomImporters,
  matchOfficeParserRedirect,
  officeParserTrimPlugin,
  redirectTarget,
} from "../../../../scripts/lib/officeParserTrim";
import JSZip from "jszip";

import * as dingbats from "../../files/vendor/dingbatToUnicode";
import * as mammothPromises from "../../files/vendor/mammothPromises";
import * as underscoreShim from "../../files/vendor/mammothUnderscore";
import * as xmlDomShim from "../../files/vendor/mammothXmlDom";
import { create } from "../../files/vendor/mammothXmlWriter";
import { HTML_ENTITIES, XML_ENTITIES, entityMap } from "../../files/vendor/xmldomXmlEntities";

const require = createRequire(import.meta.url);

/** jsdom bez typów (`@types/jsdom` nie jest zależnością) - test bierze z okna tylko `DOMParser`. */
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string) => {
    window: { DOMParser: typeof DOMParser; document: Document };
  };
};
const NM = resolve(process.cwd(), "node_modules");
const read = (path: string) => readFileSync(join(NM, path), "utf8");

/** Wszystkie pliki `.js` pod katalogiem (rekurencyjnie). */
function jsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return path.endsWith(".js") ? [path] : [];
  });
}

/** Pliki źródeł aplikacji (bez testów), w których szukamy wywołań API. */
function appSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : appSources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("założenia o źródłach mammoth i xmldom (pilnują aktualizacji pakietów)", () => {
  it("mammoth woła parseFromString BEZ typu MIME - czyli zawsze ścieżką XML", () => {
    const source = read("mammoth/lib/xml/xmldom.js");
    const calls = [...source.matchAll(/\.parseFromString\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(["string"]);
  });

  it("xmldom bierze tablicę encji HTML wyłącznie dla typu MIME html", () => {
    const source = read("@xmldom/xmldom/lib/dom-parser.js");
    expect(source).toContain("var isHTML = /\\/x?html?$/.test(mimeType);");
    expect(source).toContain("isHTML ? entities.HTML_ENTITIES : entities.XML_ENTITIES");
    // Żadnego innego sięgnięcia po `entities.` poza tym jednym wyborem.
    expect(source.match(/entities\.\w+/g)).toEqual([
      "entities.HTML_ENTITIES",
      "entities.XML_ENTITIES",
    ]);
    for (const other of ["dom.js", "sax.js", "index.js", "conventions.js"]) {
      expect(read(`@xmldom/xmldom/lib/${other}`), other).not.toMatch(/require\(['"]\.\/entities/);
    }
  });

  it("w mammoth `xmlbuilder` wymaga tylko zapis XML, a zapis woła tylko embedStyleMap", () => {
    const lib = join(NM, "mammoth/lib");
    const requiring = jsFiles(lib)
      .filter((file) => /require\(["']xmlbuilder["']\)/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(lib.length + 1));
    expect(requiring).toEqual(["xml/writer.js"]);

    const writing = jsFiles(lib)
      .filter((file) => /\.writeString\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(lib.length + 1));
    expect(writing).toEqual(["docx/style-map.js"]);

    const styleMapWriters = jsFiles(lib)
      .filter((file) => /\.writeStyleMap\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(lib.length + 1));
    expect(styleMapWriters).toEqual(["index.js"]);
    expect(read("mammoth/lib/index.js")).toMatch(
      /function embedStyleMap\([^)]*\) \{[\s\S]*?writeStyleMap\(/,
    );
  });

  it("każdy plik mammoth wymagający `promises` (poza CLI) ma parę przekierowania", () => {
    const root = join(NM, "mammoth");
    const requiring = [...jsFiles(join(root, "lib")), ...jsFiles(join(root, "browser"))]
      .flatMap((file) =>
        [
          ...readFileSync(file, "utf8").matchAll(
            /require\(["']((?:\.{1,2}\/)+(?:lib\/)?promises)["']\)/g,
          ),
        ].map((m) => `${m[1]} <- ${file.slice(root.length + 1)}`),
      )
      .filter((pair) => !pair.endsWith("<- lib/main.js"))
      .sort();
    const redirected = OFFICE_PARSER_REDIRECTS.filter((r) =>
      r.replacement.endsWith("mammothPromises.ts"),
    )
      .map((r) => `${r.source} <- ${r.importer.slice("/node_modules/mammoth/".length)}`)
      .sort();
    expect(redirected).toEqual(requiring);
  });

  it("mammoth woła z `promises` tylko funkcje, które ma zastępca", () => {
    const used = new Set<string>();
    for (const file of [
      ...jsFiles(join(NM, "mammoth/lib")),
      ...jsFiles(join(NM, "mammoth/browser")),
    ]) {
      for (const m of readFileSync(file, "utf8").matchAll(/\bpromises\.(\w+)/g)) used.add(m[1]);
    }
    const exported = Object.keys(mammothPromises);
    for (const name of used) expect(exported, name).toContain(name);
    // Komplet eksportów `mammoth/lib/promises.js` - zastępca nie może być węższy.
    const original = read("mammoth/lib/promises.js");
    for (const m of original.matchAll(/^exports\.(\w+) =/gm))
      expect(exported, m[1]).toContain(m[1]);
  });

  it("metody łańcucha bluebirda, których używa mammoth - migawka do przeglądu przy aktualizacji", () => {
    // Nazwy z prototypu bluebirda spoza `Promise.prototype`, które występują
    // w źródłach jako `.nazwa(`. Na obietnicach mammoth woła tylko `caught`
    // i `tap` (oba ma `MammothPromise`); reszta to TE SAME NAZWY na czym innym:
    // `_.any/_.some/_.filter/_.map` (underscore), `Result.map/value/error`,
    // `Function#bind/call`, tablice, `promises.mapSeries/props` (funkcje modułu).
    // Nowa nazwa w migawce = sprawdź, czy to nie metoda obietnicy.
    const bluebird = (require("bluebird/js/release/promise") as () => { prototype: object })();
    const methods = Object.getOwnPropertyNames(bluebird.prototype).filter(
      (name) => !(name in Promise.prototype) && !name.startsWith("_"),
    );
    const root = join(NM, "mammoth");
    const files = [...jsFiles(join(root, "lib")), ...jsFiles(join(root, "browser"))].filter(
      (file) => !file.endsWith("lib/main.js") && !file.endsWith("lib/promises.js"),
    );
    const sources = files.map((file) => readFileSync(file, "utf8")).join("\n");
    const used = methods.filter((name) =>
      new RegExp(`\\.\\s*${name.replace(/\$/g, "\\$")}\\s*\\(`).test(sources),
    );
    expect(used.sort()).toEqual([
      "any",
      "bind",
      "call",
      "caught",
      "error",
      "filter",
      "map",
      "mapSeries",
      "props",
      "some",
      "tap",
      "value",
    ]);
    for (const name of ["caught", "fail", "tap", "also"]) {
      expect(
        typeof (mammothPromises.MammothPromise.prototype as unknown as Record<string, unknown>)[
          name
        ],
      ).toBe("function");
    }
  });

  it("body-reader pyta `dingbat-to-unicode` wyłącznie o `hex`", () => {
    const lib = join(NM, "mammoth/lib");
    const requiring = jsFiles(lib)
      .filter((file) => /require\(["']dingbat-to-unicode["']\)/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(lib.length + 1));
    expect(requiring).toEqual(["docx/body-reader.js"]);
    const calls = read("mammoth/lib/docx/body-reader.js").match(/dingbatToUnicode\.\w+/g);
    expect([...new Set(calls)]).toEqual(["dingbatToUnicode.hex"]);
  });

  it("każdy plik mammoth i lop wymagający `underscore` ma parę przekierowania", () => {
    const requiring = [
      ...jsFiles(join(NM, "mammoth/lib")),
      ...jsFiles(join(NM, "mammoth/browser")),
      ...jsFiles(join(NM, "lop/lib")),
      join(NM, "lop/index.js"),
    ]
      .filter((file) => /require\(["']underscore["']\)/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(NM.length + 1))
      .filter((file) => file !== "mammoth/lib/main.js")
      .sort();
    const redirected = OFFICE_PARSER_REDIRECTS.filter((r) => r.source === "underscore")
      .map((r) => r.importer.slice("/node_modules/".length))
      .sort();
    expect(redirected).toEqual(requiring);
    expect(
      OFFICE_PARSER_REDIRECTS.filter((r) => r.source === "underscore").every((r) =>
        r.replacement.endsWith("mammothUnderscore.ts"),
      ),
    ).toBe(true);
  });

  it("mammoth i lop sięgają po underscore wyłącznie jako `_.nazwa`, i tylko po funkcje zastępcy", () => {
    const used = new Set<string>();
    for (const file of [
      ...jsFiles(join(NM, "mammoth/lib")),
      ...jsFiles(join(NM, "mammoth/browser")),
      ...jsFiles(join(NM, "lop/lib")),
    ]) {
      const source = readFileSync(file, "utf8");
      if (!/require\(["']underscore["']\)/.test(source)) continue;
      for (const m of source.matchAll(/\b_\.(\w+)/g)) used.add(m[1]);
      // Wywołanie łańcuchowe `_(x)` albo przekazanie `_` dalej wymagałoby
      // pełnego obiektu underscore, nie zbioru funkcji.
      const bare = source
        .replace(/var _ = require\(["']underscore["']\);/, "")
        .match(/(?<![\w$.])_\s*\(|[(,=]\s*_\s*[,);]/g);
      expect(bare, file).toBeNull();
    }
    expect([...used].sort()).toEqual([
      "any",
      "clone",
      "extend",
      "filter",
      "find",
      "findIndex",
      "flatten",
      "foldl",
      "forEach",
      "indexBy",
      "invert",
      "isArray",
      "isEqual",
      "isFunction",
      "isString",
      "last",
      "map",
      "pluck",
      "some",
      "values",
    ]);
    for (const name of used)
      expect(typeof (underscoreShim as Record<string, unknown>)[name], name).toBe("function");
  });

  it("mammoth wymaga jszip tylko w `lib/zipfile.js` i woła z niego wyłącznie odczyt (plus zapis embedStyleMap)", () => {
    const root = join(NM, "mammoth");
    const requiring = [...jsFiles(join(root, "lib")), ...jsFiles(join(root, "browser"))]
      .filter((file) => /require\(["']jszip["']\)/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length + 1));
    expect(requiring).toEqual(["lib/zipfile.js"]);
    const source = read("mammoth/lib/zipfile.js");
    // Migawka WSZYSTKICH sięgnięć po archiwum: `loadAsync`, `file(nazwa)` +
    // `async("uint8array")` (odczyt) oraz `file(nazwa, treść)` i
    // `generateAsync` (zapis - woła je tylko `embedStyleMap`, wycięte).
    expect(source.match(/JSZip\.\w+|zipFile\.\w+\([^)]*\)|\.async\([^)]*\)/g)).toEqual([
      "JSZip.loadAsync",
      "zipFile.file(name)",
      "zipFile.file(name)",
      '.async("uint8array")',
      "zipFile.file(name, contents)",
      'zipFile.generateAsync({type: "arraybuffer"})',
    ]);
    // Zapis archiwum (`write`, `toArrayBuffer` obiektu z `openArrayBuffer`)
    // wołają tylko zapis mapy stylów i `embedStyleMap`.
    const writers = jsFiles(join(root, "lib"))
      .filter((file) => /\bdocxFile\.(write|toArrayBuffer)\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length + 1))
      .sort();
    expect(writers).toEqual(["lib/docx/style-map.js", "lib/index.js"]);
    expect(read("mammoth/lib/index.js")).toMatch(
      /function embedStyleMap\([^)]*\) \{(?:(?!\nfunction )[\s\S])*?docxFile\.toArrayBuffer\(/,
    );
  });

  it("xmldom.js mammoth czyta tylko `xml/reader.js`, a czytnik bierze z niego parseFromString i dwie stałe", () => {
    const root = join(NM, "mammoth");
    const requiring = [...jsFiles(join(root, "lib")), ...jsFiles(join(root, "browser"))]
      .filter((file) => /require\(["']\.\/xmldom["']\)/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length + 1));
    expect(requiring).toEqual(["lib/xml/reader.js"]);
    const reader = read("mammoth/lib/xml/reader.js");
    expect([...new Set(reader.match(/xmldom\.\w+|Node\.\w+/g))].sort()).toEqual([
      "Node.ELEMENT_NODE",
      "Node.TEXT_NODE",
      "xmldom.Node",
      "xmldom.parseFromString",
    ]);
    // Migawka własności węzłów DOM, po które sięga czytnik - nowa pozycja to
    // pytanie, czy natywny DOM daje ją tak samo jak xmldom.
    const properties = reader.match(/\b(?:document|element|node|attribute)\.(\w+)/g);
    expect([...new Set(properties)].sort()).toEqual([
      "attribute.value",
      "document.documentElement",
      "element.attributes",
      "element.childNodes",
      "node.localName",
      "node.namespaceURI",
      "node.nodeType",
      "node.nodeValue",
    ]);
    expect(xmlDomShim.Node.ELEMENT_NODE).toBe(1);
    expect(xmlDomShim.Node.TEXT_NODE).toBe(3);
  });

  it("aplikacja nie woła embedStyleMap (jedynej drogi do wyciętego zapisu)", () => {
    const offenders = appSources(resolve(process.cwd(), "src")).filter((file) =>
      // Wywołanie albo odczyt właściwości - nie wzmianka w komentarzu.
      /\.embedStyleMap\b|\bembedStyleMap\s*\(|\[["']embedStyleMap["']\]/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("dopasowanie przekierowań - wyłącznie para (specyfikator, importer)", () => {
  const writer = "/repo/node_modules/mammoth/lib/xml/writer.js";
  const domParser = "/repo/node_modules/@xmldom/xmldom/lib/dom-parser.js";

  it("przekierowuje zapis XML, encje, tablicę dingbatów i `promises` mammoth", () => {
    expect(matchOfficeParserRedirect("xmlbuilder", writer)?.replacement).toBe(
      "src/lib/files/vendor/mammothXmlWriter.ts",
    );
    expect(matchOfficeParserRedirect("./entities", domParser)?.replacement).toBe(
      "src/lib/files/vendor/xmldomXmlEntities.ts",
    );
    expect(
      matchOfficeParserRedirect(
        "dingbat-to-unicode",
        "/repo/node_modules/mammoth/lib/docx/body-reader.js",
      )?.replacement,
    ).toBe("src/lib/files/vendor/dingbatToUnicode.ts");
    expect(
      matchOfficeParserRedirect("../promises", "/repo/node_modules/mammoth/lib/docx/docx-reader.js")
        ?.replacement,
    ).toBe("src/lib/files/vendor/mammothPromises.ts");
    expect(
      matchOfficeParserRedirect("../lib/promises", "/repo/node_modules/mammoth/browser/unzip.js")
        ?.replacement,
    ).toBe("src/lib/files/vendor/mammothPromises.ts");
  });

  it("przekierowuje xmldom, jszip i underscore mammoth/lop", () => {
    expect(
      matchOfficeParserRedirect("./xmldom", "/repo/node_modules/mammoth/lib/xml/reader.js")
        ?.replacement,
    ).toBe("src/lib/files/vendor/mammothXmlDom.ts");
    expect(
      matchOfficeParserRedirect("jszip", "/repo/node_modules/mammoth/lib/zipfile.js")?.replacement,
    ).toBe("src/lib/files/vendor/officeZip.ts");
    for (const importer of [
      "/repo/node_modules/mammoth/lib/docx/body-reader.js",
      "/repo/node_modules/lop/lib/rules.js",
    ]) {
      expect(matchOfficeParserRedirect("underscore", importer)?.replacement, importer).toBe(
        "src/lib/files/vendor/mammothUnderscore.ts",
      );
    }
  });

  it("jszip, underscore i xmldom spoza tych plików zostają prawdziwymi pakietami", () => {
    for (const [source, importer] of [
      ["jszip", "/repo/src/lib/events/wallet/zip.ts"],
      ["jszip", "/repo/node_modules/mammoth/lib/unzip.js"],
      ["underscore", "/repo/node_modules/other/index.js"],
      ["underscore", "/repo/node_modules/mammoth/lib/main.js"],
      ["./xmldom", "/repo/node_modules/mammoth/lib/xml/index.js"],
      ["@xmldom/xmldom", "/repo/node_modules/mammoth/lib/xml/xmldom.js"],
    ] as const) {
      expect(
        matchOfficeParserRedirect(source, importer),
        `${source} <- ${importer}`,
      ).toBeUndefined();
    }
  });

  it("ten sam specyfikator z innego pliku rozwiązuje się normalnie", () => {
    expect(
      matchOfficeParserRedirect("xmlbuilder", "/repo/node_modules/xml2js/lib/builder.js"),
    ).toBeUndefined();
    expect(
      matchOfficeParserRedirect("./entities", "/repo/node_modules/htmlparser2/lib/x.js"),
    ).toBeUndefined();
    expect(
      matchOfficeParserRedirect("./entities", "/repo/src/lib/files/dom-parser.js"),
    ).toBeUndefined();
    expect(matchOfficeParserRedirect("xmlbuilder", undefined)).toBeUndefined();
    expect(matchOfficeParserRedirect("xmlbuilder2", writer)).toBeUndefined();
    // `promises` i dingbaty: tylko z plików mammoth, nie z dowolnego pakietu.
    expect(
      matchOfficeParserRedirect("./promises", "/repo/node_modules/other/lib/images.js"),
    ).toBeUndefined();
    expect(matchOfficeParserRedirect("../promises", "/repo/src/lib/xml/reader.js")).toBeUndefined();
    expect(
      matchOfficeParserRedirect("dingbat-to-unicode", "/repo/node_modules/other/index.js"),
    ).toBeUndefined();
  });

  it("toleruje prefiks wirtualny, sufiks zapytania i ścieżki Windows", () => {
    expect(matchOfficeParserRedirect("xmlbuilder", `\0${writer}?commonjs-proxy`)).toBeDefined();
    expect(matchOfficeParserRedirect("./entities", domParser.replaceAll("/", "\\"))).toBeDefined();
  });

  it("moduły zastępcze istnieją i są modułami aplikacji, nie pakietami", () => {
    for (const redirect of OFFICE_PARSER_REDIRECTS) {
      const target = redirectTarget(redirect);
      expect(statSync(target).isFile(), target).toBe(true);
      expect(target.startsWith(resolve(process.cwd(), "src/lib/files/vendor/"))).toBe(true);
    }
  });

  it("wtyczka działa tylko w buildzie i tylko dla przeglądarki", () => {
    const plugin = officeParserTrimPlugin();
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("pre");
    const applies = plugin.applyToEnvironment as (env: { config: { consumer: string } }) => boolean;
    expect(applies({ config: { consumer: "client" } })).toBe(true);
    expect(applies({ config: { consumer: "server" } })).toBe(false);
  });
});

describe("kontrola grafu: xmldom tylko dla mammoth", () => {
  const graph: Record<string, string[]> = {
    "/r/node_modules/@xmldom/xmldom/lib/index.js": ["/r/node_modules/mammoth/lib/xml/xmldom.js"],
    "/r/node_modules/@xmldom/xmldom/lib/dom-parser.js": [
      "/r/node_modules/@xmldom/xmldom/lib/index.js",
    ],
    "/r/node_modules/@xmldom/xmldom/lib/dom.js": [
      "\0/r/node_modules/mammoth/lib/xml/xmldom.js?commonjs-proxy",
    ],
  };
  const info = (id: string) => ({ importers: graph[id] ?? [] });

  it("mammoth i sam xmldom to dozwoleni importerzy", () => {
    expect(foreignXmldomImporters(Object.keys(graph), info)).toEqual([]);
  });

  it("nowy klient xmldom jest zgłaszany z nazwy", () => {
    const withForeign = {
      ...graph,
      "/r/node_modules/@xmldom/xmldom/lib/index.js": [
        "/r/node_modules/mammoth/lib/xml/xmldom.js",
        "/r/src/lib/svgSanitize.ts",
      ],
    };
    expect(
      foreignXmldomImporters(Object.keys(withForeign), (id) => ({
        importers: withForeign[id as keyof typeof withForeign] ?? [],
      })),
    ).toEqual(["/r/src/lib/svgSanitize.ts"]);
  });
});

describe("hook buildEnd wtyczki", () => {
  type BuildEndContext = {
    getModuleIds: () => IterableIterator<string>;
    getModuleInfo: (id: string) => { importers: string[] } | null;
    error: (message: string) => never;
  };
  const run = (graph: Record<string, string[]>, error?: Error) => {
    const plugin = officeParserTrimPlugin();
    const hook = plugin.buildEnd as (this: BuildEndContext, error?: Error) => void;
    hook.call(
      {
        getModuleIds: () => Object.keys(graph)[Symbol.iterator](),
        getModuleInfo: (id) => ({ importers: graph[id] ?? [] }),
        error: (message) => {
          throw new Error(message);
        },
      },
      error,
    );
  };
  const xmldom = "/r/node_modules/@xmldom/xmldom/lib/index.js";

  it("przepuszcza graf, w którym xmldom ma tylko mammoth", () => {
    expect(() => run({ [xmldom]: ["/r/node_modules/mammoth/lib/xml/xmldom.js"] })).not.toThrow();
  });

  it("przerywa build z nazwą obcego importera xmldom", () => {
    expect(() => run({ [xmldom]: ["/r/src/lib/svgSanitize.ts"] })).toThrow(
      /importera spoza mammoth \(\/r\/src\/lib\/svgSanitize\.ts\)/,
    );
  });

  it("nie dokłada własnego błędu do builda, który już padł", () => {
    expect(() => run({ [xmldom]: ["/r/src/x.ts"] }, new Error("wcześniejszy"))).not.toThrow();
  });
});

describe("moduły zastępcze", () => {
  it("XML_ENTITIES to dosłowna kopia tablicy xmldom, zamrożona jak oryginał", () => {
    const original = require("@xmldom/xmldom/lib/entities.js") as {
      XML_ENTITIES: Record<string, string>;
    };
    expect({ ...XML_ENTITIES }).toEqual({ ...original.XML_ENTITIES });
    expect(Object.isFrozen(XML_ENTITIES)).toBe(Object.isFrozen(original.XML_ENTITIES));
  });

  it("każdy dostęp do tablicy encji HTML rzuca z nazwą przyczyny", () => {
    expect(() => HTML_ENTITIES["nbsp"]).toThrow(/encji HTML/);
    expect(() => Object.prototype.hasOwnProperty.call(HTML_ENTITIES, "nbsp")).toThrow(/encji HTML/);
    expect(() => "nbsp" in HTML_ENTITIES).toThrow(/encji HTML/);
    expect(() => Object.keys(entityMap)).toThrow(/encji HTML/);
  });

  it("zapis XML mammoth rzuca zamiast oddać częściowy plik", () => {
    expect(() => create()).toThrow(/embedStyleMap/);
  });

  it("dingbaty: każde zapytanie daje to samo co pakiet dingbat-to-unicode", () => {
    const original = require("dingbat-to-unicode") as typeof dingbats;
    const rows = (
      require("dingbat-to-unicode/dist/dingbats") as {
        default: Array<Record<"Typeface name" | "Dingbat dec" | "Dingbat hex", string>>;
      }
    ).default;
    const faces = [...new Set(rows.map((row) => row["Typeface name"]))];
    expect(faces).toEqual(["Symbol", "Webdings", "Wingdings", "Wingdings 2", "Wingdings 3"]);
    const variants = faces.flatMap((face) => [face, face.toUpperCase(), face.toLowerCase()]);
    for (const face of [...variants, "Arial", ""]) {
      for (let value = 0; value <= 0xffff; value++) {
        const expected = original.codePoint(face, value);
        const actual = dingbats.codePoint(face, value);
        if (expected === undefined) {
          if (actual !== undefined) expect(actual, `${face}_${value}`).toBeUndefined();
        } else if (actual?.codePoint !== expected.codePoint || actual.string !== expected.string) {
          expect(actual, `${face}_${value}`).toEqual(expected);
        }
      }
    }
    for (const row of rows) {
      const face = row["Typeface name"];
      const hex = row["Dingbat hex"];
      expect(dingbats.dec(face, row["Dingbat dec"])).toEqual(
        original.dec(face, row["Dingbat dec"]),
      );
      expect(dingbats.hex(face, hex)).toEqual(original.hex(face, hex));
      // `body-reader` pyta najpierw o pełny kod (np. "F04A"), potem o "4A".
      expect(dingbats.hex(face, `F0${hex}`)).toEqual(original.hex(face, `F0${hex}`));
    }
    for (const value of ["", "zz", "F0", "-20", " 4A"]) {
      expect(dingbats.hex("Wingdings", value)).toEqual(original.hex("Wingdings", value));
      expect(dingbats.dec("Wingdings", value)).toEqual(original.dec("Wingdings", value));
    }
  });

  it("promises: `props` czeka na wartości i składa nowy obiekt w kolejności kluczy", async () => {
    const source = { b: Promise.resolve(2), a: 1, c: mammothPromises.resolve("x") };
    const result = await mammothPromises.props(source);
    expect(result).toEqual({ b: 2, a: 1, c: "x" });
    expect(Object.keys(result)).toEqual(["b", "a", "c"]);
    expect(result).not.toBe(source);
  });

  it("promises: `mapSeries` idzie po kolei i podaje (wartość, indeks, długość)", async () => {
    const calls: string[] = [];
    const result = await mammothPromises.mapSeries(
      [Promise.resolve("a"), "b", "c"],
      async (value: string, index, length) => {
        calls.push(`start ${value} ${index}/${length}`);
        await new Promise((ok) => setTimeout(ok, value === "a" ? 5 : 0));
        calls.push(`end ${value}`);
        return value.toUpperCase();
      },
    );
    expect(result).toEqual(["A", "B", "C"]);
    expect(calls).toEqual(["start a 0/3", "end a", "start b 1/3", "end b", "start c 2/3", "end c"]);
  });

  it("promises: `attempt` woła synchronicznie i zamienia wyjątek w odrzucenie", async () => {
    let called = false;
    const ok = mammothPromises.attempt(() => {
      called = true;
      return 1;
    });
    expect(called).toBe(true);
    await expect(ok).resolves.toBe(1);
    const failed = mammothPromises.attempt(() => {
      throw new Error("boom");
    });
    await expect(failed.caught((error) => (error as Error).message)).resolves.toBe("boom");
  });

  it("promises: `tap`, `also`, `fail` i `resolve` zachowują się jak w mammoth na bluebirdzie", async () => {
    const order: string[] = [];
    const tapped = await mammothPromises.resolve(5).tap(async (value) => {
      await Promise.resolve();
      order.push(`tap ${value}`);
      return "ignored";
    });
    expect(tapped).toBe(5);
    expect(order).toEqual(["tap 5"]);

    const merged = await mammothPromises
      .props({ a: 1 })
      .also((value) => ({ b: Promise.resolve((value.a as number) + 1) }));
    expect(merged).toEqual({ a: 1, b: 2 });

    const same = mammothPromises.resolve(1);
    expect(mammothPromises.resolve(same)).toBe(same);
    expect(mammothPromises.when).toBe(mammothPromises.resolve);
    const chained = same.then((value) => value + 1);
    expect(chained).toBeInstanceOf(mammothPromises.MammothPromise);

    await expect(
      mammothPromises.reject(new Error("x")).fail((error) => (error as Error).message),
    ).resolves.toBe("x");
    await expect(
      mammothPromises.all(mammothPromises.resolve([1, Promise.resolve(2)])),
    ).resolves.toEqual([1, 2]);
    const deferred = mammothPromises.defer<number>();
    deferred.resolve(3);
    await expect(deferred.promise).resolves.toBe(3);
  });
});

describe("zastępca underscore: te same wyniki co underscore 1.13.8", () => {
  const original = require("underscore") as Record<string, (...args: unknown[]) => unknown> & {
    VERSION: string;
  };
  const shim = underscoreShim as unknown as Record<string, (...args: unknown[]) => unknown>;

  it("porównujemy z wersją, z której zrobiono port", () => {
    expect(original.VERSION).toBe("1.13.8");
  });

  const proto = { inherited: "z prototypu" };
  const withProto = Object.assign(Object.create(proto) as object, { own: 1, nested: { a: 1 } });
  // Kolekcje, jakie mammoth i lop podają naprawdę (tablice, NodeList/
  // NamedNodeMap jako obiekty tablicopodobne, słowniki, null) plus brzegi.
  const collections = (): unknown[] => [
    [1, 2, 3],
    [],
    [0, "", null, undefined, Number.NaN, false],
    [{ a: 1, value: "x" }, { a: 2, value: "y" }, { b: 3 }],
    "abc",
    "",
    { length: 2, 0: { a: "p" }, 1: { a: "q" } },
    { length: -1, 0: "nie-tablica" },
    { a: 1, b: { a: 2 }, c: null },
    {},
    null,
    undefined,
    42,
    withProto,
    [
      [1, [2, [3]]],
      [4, 5],
    ],
  ];
  const predicates = [
    (value: unknown) => Boolean(value),
    (_value: unknown, key: unknown) => key === 1 || key === "b",
    "a",
    "value",
    0,
    ["a", "b"],
    null,
    undefined,
  ];

  /** Wynik + dziennik wywołań iteratora (wartość, klucz, czy to ta sama kolekcja). */
  function trace(impl: typeof shim, name: string, collection: unknown, iteratee: unknown) {
    const calls: unknown[] = [];
    const wrapped =
      typeof iteratee === "function"
        ? (...args: unknown[]) => {
            calls.push([args[0], args[1], args[2] === collection]);
            return (iteratee as (...a: unknown[]) => unknown)(...args);
          }
        : iteratee;
    let result: unknown;
    try {
      result = impl[name]!(collection, wrapped);
    } catch (error) {
      result = `THROW ${(error as Error).constructor.name}`;
    }
    return { result, calls };
  }

  it.each(["map", "some", "any", "filter", "find", "findIndex", "indexBy"])(
    "%s - każda kolekcja x każdy iterator",
    (name) => {
      for (const collection of collections()) {
        for (const predicate of predicates) {
          const label = `${name}(${JSON.stringify(collection)}, ${String(predicate)})`;
          expect(trace(shim, name, collection, predicate), label).toEqual(
            trace(original, name, collection, predicate),
          );
        }
      }
    },
  );

  it("forEach oddaje kolekcję i woła iterator tak samo", () => {
    for (const collection of collections()) {
      const log = (impl: typeof shim) => {
        const calls: unknown[] = [];
        const out = impl.forEach!(collection, (...args: unknown[]) => {
          calls.push([args[0], args[1], args[2] === collection]);
        });
        return { same: out === collection, calls };
      };
      expect(log(shim), JSON.stringify(collection)).toEqual(log(original));
    }
  });

  it("foldl z wartością początkową i bez niej (także błąd: null bez wartości początkowej)", () => {
    const add = (memo: unknown, value: unknown, key: unknown) =>
      `${String(memo)}|${String(value)}@${String(key)}`;
    const settle = (run: () => unknown) => {
      try {
        return run();
      } catch (error) {
        return `THROW ${(error as Error).constructor.name}`;
      }
    };
    for (const collection of collections()) {
      for (const memo of [[], ["start"], [undefined]]) {
        expect(
          settle(() => shim.foldl!(collection, add, ...memo)),
          `${JSON.stringify(collection)} ${memo.length}`,
        ).toEqual(settle(() => original.foldl!(collection, add, ...memo)));
      }
    }
  });

  it("pluck, values, invert, last, isArray, isString, isFunction", () => {
    const strings = Object.assign(Object.create(null) as object, { a: "x", b: "y", c: "x" });
    for (const value of [...collections(), strings]) {
      const label = JSON.stringify(value);
      for (const key of ["a", "value", 0, "length"]) {
        expect(shim.pluck!(value, key), `${label} ${key}`).toEqual(original.pluck!(value, key));
      }
      expect(shim.values!(value), label).toEqual(original.values!(value));
      expect(shim.invert!(value), label).toEqual(original.invert!(value));
      expect(shim.last!(value), label).toEqual(original.last!(value));
    }
    const kinds = [
      [],
      {},
      "s",
      Object("s"),
      () => 1,
      async () => 1,
      class {},
      function* gen() {},
      null,
      undefined,
      1,
      { length: 0 },
    ];
    for (const value of kinds) {
      for (const name of ["isArray", "isString", "isFunction"]) {
        expect(shim[name]!(value), `${name}(${String(value)})`).toBe(original[name]!(value));
      }
    }
  });

  it("flatten: głęboko, o jeden poziom (`true`), `arguments`, obiekty tablicopodobne", () => {
    function args(..._values: unknown[]) {
      // eslint-disable-next-line prefer-rest-params -- underscore spłaszcza też `arguments`
      return arguments;
    }
    const inputs: unknown[] = [
      [1, [2, [3, [4, [5]]]]],
      [[["a"]], "bc", { length: 1, 0: "x" }, args(1, [2, [3]])],
      [args([1], 2), [], [[]]],
      // eslint-disable-next-line no-sparse-arrays -- dziura w tablicy to też wejście
      [1, , [2, , 3]],
      [],
      "abc",
      null,
      undefined,
      { a: [1] },
    ];
    for (const input of inputs) {
      for (const depth of [undefined, true, false, 1, 2]) {
        expect(shim.flatten!(input, depth), `${JSON.stringify(input)} ${String(depth)}`).toEqual(
          original.flatten!(input, depth),
        );
      }
    }
  });

  it("extend i clone kopiują klucze własne i dziedziczone, pomijając nie-obiekty", () => {
    const target = () => ({ keep: true, own: 0 });
    const sources: unknown[][] = [
      [withProto],
      [{ a: 1 }, null, "str", 5, undefined, { a: 2, b: [1] }],
      [[10, 20]],
      [() => 1],
      [],
    ];
    for (const list of sources) {
      const a = shim.extend!(target(), ...list);
      const b = original.extend!(target(), ...list);
      expect(Object.entries(a as object)).toEqual(Object.entries(b as object));
    }
    expect(shim.extend!(null, { a: 1 })).toBe(original.extend!(null, { a: 1 }));
    expect(shim.extend!(undefined, { a: 1 })).toBe(original.extend!(undefined, { a: 1 }));
    // `nodes.js` rozszerza TABLICĘ prototypem listy elementów.
    const list = shim.extend!([1, 2], { first: () => 1 }) as unknown[] & { first?: unknown };
    expect(Array.isArray(list) && typeof list.first).toBe("function");

    for (const value of [withProto, [1, { a: 1 }], { a: { b: 1 } }, 5, "s", null, () => 1]) {
      const a = shim.clone!(value);
      const b = original.clone!(value);
      expect(a, JSON.stringify(value)).toEqual(b);
      expect(Array.isArray(a)).toBe(Array.isArray(b));
      if (value !== null && typeof value === "object") {
        expect(a).not.toBe(value);
        // Płytko: zagnieżdżony obiekt jest tym samym obiektem.
        const nested = Object.values(value as object).find((v) => typeof v === "object");
        if (nested !== undefined) expect(Object.values(a as object)).toContain(nested);
      }
    }
  });

  it("isEqual: macierz przypadków jak w underscore (w mammoth: atrybuty elementów HTML)", () => {
    const cyclicA: Record<string, unknown> = { name: "a" };
    cyclicA.self = cyclicA;
    const cyclicB: Record<string, unknown> = { name: "a" };
    cyclicB.self = cyclicB;
    const cyclicC: Record<string, unknown> = { name: "a" };
    cyclicC.self = { name: "a", self: cyclicC };
    class Point {
      constructor(readonly x: number) {}
    }
    const nullProto = Object.assign(Object.create(null) as object, { a: 1 });
    const values: unknown[] = [
      0,
      -0,
      1,
      Number.NaN,
      Object(0),
      Object(-0),
      Object(Number.NaN),
      "",
      "a",
      Object("a"),
      true,
      Object(true),
      false,
      null,
      undefined,
      new Date(0),
      new Date(0),
      new Date(1),
      /a/g,
      /a/g,
      /a/i,
      [],
      [1, [2]],
      [1, [2]],
      [1, [3]],
      {},
      { a: "1" },
      { a: "1" },
      { a: "1", b: undefined },
      { b: "1" },
      { class: "x", href: "y" },
      { href: "y", class: "x" },
      nullProto,
      { a: 1 },
      new Point(1),
      { x: 1 },
      cyclicA,
      cyclicB,
      cyclicC,
      Symbol.for("s"),
      Object(Symbol.for("s")),
      () => 1,
    ];
    values.forEach((a, i) => {
      values.forEach((b, j) => {
        expect(shim.isEqual!(a, b), `values[${i}] vs values[${j}]`).toBe(original.isEqual!(a, b));
      });
    });
  });

  it("iterator-wzorzec i dane binarne w isEqual rzucają zamiast liczyć inaczej", () => {
    expect(() => shim.filter!([{ a: 1 }], { a: 1 })).toThrow(/matcher/);
    expect(() => shim.isEqual!(new Uint8Array(1), new Uint8Array(1))).toThrow(/binarnych/);
  });
});

describe("zastępca xmldom: natywny DOMParser daje czytnikowi mammoth to samo drzewo", () => {
  // jsdom w roli przeglądarki. Ten sam korpus przepuszczony przez natywny
  // `DOMParser` Chromium (Playwright, poza CI) daje to samo drzewo z jedną
  // różnicą: Blink stawia deklaracje `xmlns` PRZED pozostałymi atrybutami.
  // Dlatego `tree` porównuje deklaracje jako zbiór, a resztę atrybutów
  // w kolejności. Dla mammoth to bez znaczenia: `reader.js` składa atrybuty
  // w obiekt po nazwie, a czytniki .docx sięgają po nie wyłącznie kluczem;
  // deklaracja ma nazwę `{http://www.w3.org/2000/xmlns/}…`, więc nie
  // nadpisze zwykłego atrybutu. Błąd jsdom zgłasza `<parsererror>`
  // w przestrzeni Gecko - drugą z dwóch, które zastępca rozpoznaje.
  beforeAll(() => {
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const xmldom = require("@xmldom/xmldom") as {
    DOMParser: new (options: object) => { parseFromString(source: string): Document };
  };

  /** `mammoth/lib/xml/xmldom.js#parseFromString` - oryginał, który zastępujemy. */
  function viaXmldom(source: string): Document {
    let error: string | null = null;
    const doc = new xmldom.DOMParser({
      errorHandler: (level: string, message: string) => {
        error = `${level}: ${message}`;
      },
    }).parseFromString(source);
    if (error !== null) throw new Error(error);
    return doc;
  }

  const XMLNS = "http://www.w3.org/2000/xmlns/";

  /** Drzewo tak, jak widzi je `reader.js`: elementy, atrybuty, tekst. */
  function tree(node: Node): unknown {
    if (node.nodeType === 1) {
      const element = node as Element;
      const attrs = Array.from(element.attributes).map((a) => [
        a.namespaceURI || null,
        a.localName,
        a.value,
      ]);
      return {
        ns: element.namespaceURI || null,
        name: element.localName,
        xmlns: attrs.filter(([ns]) => ns === XMLNS).sort(),
        attrs: attrs.filter(([ns]) => ns !== XMLNS),
        children: Array.from(element.childNodes)
          .map(tree)
          .filter((child) => child !== undefined),
      };
    }
    if (node.nodeType === 3) return node.nodeValue;
    return undefined;
  }

  function outcome(parse: (source: string) => Document, source: string) {
    try {
      return tree(parse(source).documentElement);
    } catch {
      return "ERROR";
    }
  }

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const WELL_FORMED: Record<string, string> = {
    deklaracja: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${W}><w:t>a</w:t></w:document>`,
    "domyślna przestrzeń i atrybuty z prefiksem":
      '<a xmlns="urn:x" xmlns:p="urn:p" p:b="1" c="2"><b/></a>',
    "xml:space i xml:lang": `<w:t ${W} xml:space="preserve" xml:lang="pl">  dwie spacje  </w:t>`,
    encje: '<a t="&lt;&amp;&quot;">&amp;&lt;&gt;&quot;&apos;&#x17B;&#380;&#128578;</a>',
    CDATA: "<a>przed<![CDATA[x<y]]>po</a>",
    "komentarze i instrukcje": "<!-- c --><?pi x?><a><!-- w --><?p y?>t</a><!-- po -->",
    "białe znaki między elementami": "<a>\n  <b> </b>\n\t<c/>\n</a>",
    "końce linii w tekście": "<a>1\r\n2\r3\n4\u00855\u20286\r\u00857</a>",
    "końce linii i tabulatory w atrybucie": '<a t="x\r\ny\tz\nq\u2028r"/>',
    "znaki spoza BMP i łączące": "<a>🙂 漢字 مرحبا e\u0301 \u200b</a>",
    "przestrzenie przedefiniowane w potomku":
      '<a xmlns:p="urn:1"><p:b xmlns:p="urn:2" p:c="3"/><p:d/></a>',
    "puste przestrzenie domyślne": '<a xmlns="urn:x"><b xmlns=""/></a>',
    "atrybut xmlns jako atrybut": '<a xmlns:q="urn:q"/>',
  };

  it("korpus syntetyczny: to samo drzewo", () => {
    for (const [label, source] of Object.entries(WELL_FORMED)) {
      const expected = outcome(viaXmldom, source);
      expect(expected, label).not.toBe("ERROR");
      expect(outcome(xmlDomShim.parseFromString, source), label).toEqual(expected);
    }
  });

  it("wszystkie części XML wszystkich plików .docx z testów mammoth: to samo drzewo", async () => {
    const dir = join(NM, "mammoth/test/test-data");
    let parts = 0;
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".docx"))) {
      const zip = await JSZip.loadAsync(readFileSync(join(dir, name)));
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || !/\.(xml|rels)$/.test(path)) continue;
        // Jak `office-xml-reader.js`: dekodowanie UTF-8 i zdjęcie BOM.
        const source = (await entry.async("string")).replace(/^\uFEFF/, "");
        const expected = outcome(viaXmldom, source);
        expect(outcome(xmlDomShim.parseFromString, source), `${name}:${path}`).toEqual(expected);
        parts++;
      }
    }
    expect(parts).toBeGreaterThan(100);
  });

  it("końce linii: ta sama zamiana co w xmldom", () => {
    const xmldomSource = read("@xmldom/xmldom/lib/dom-parser.js");
    expect(xmldomSource).toContain("function normalizeLineEndings(input) {");
    for (const input of [
      "a\r\nb",
      "a\rb",
      "a\r\u0085b",
      "a\u0085b",
      "a\u2028b",
      "\r\r\n\n",
      "bez zmian",
    ]) {
      expect(xmlDomShim.normalizeLineEndings(input)).toBe(
        input.replace(/\r[\n\u0085]/g, "\n").replace(/[\r\u0085\u2028]/g, "\n"),
      );
    }
  });

  it("XML zepsuty dla OBU parserów: błąd w obu", () => {
    for (const source of [
      `<w:p ${W}><w:t>a</w:t>`,
      "<a/><b/>",
      "<a>x&nbsp;y</a>",
      '<a x="1" x="2"/>',
      "<a x=1/>",
      "",
      "   ",
      "<1a/>",
      '<a:b:c xmlns:a="urn:a"/>',
    ]) {
      expect(outcome(viaXmldom, source), source).toBe("ERROR");
      expect(outcome(xmlDomShim.parseFromString, source), source).toBe("ERROR");
    }
  });

  it("ZNANE RÓŻNICE: XML niepoprawny, który xmldom przepuszczał, przeglądarka odrzuca", () => {
    for (const source of [
      ` <?xml version="1.0"?><a/>`,
      "<w:p><w:t>a</w:t></w:p>",
      "<a>a\u000bb</a>",
      "<a>a&#11;b</a>",
      "<a/>śmieci",
      "<a><b></a></b>",
      "<a>x & y</a>",
    ]) {
      expect(outcome(viaXmldom, source), source).not.toBe("ERROR");
      expect(outcome(xmlDomShim.parseFromString, source), source).toBe("ERROR");
    }
  });

  it("DTD odrzucona przed parsowaniem - encje własne nie są rozwijane", () => {
    const parse = vi.fn();
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString = parse;
      },
    );
    const entity = '<!DOCTYPE a [<!ENTITY e "EE">]><a>&e;</a>';
    // Encja własna: xmldom pada, zastępca też (przeglądarka by ją ROZWINĘŁA).
    expect(outcome(viaXmldom, entity)).toBe("ERROR");
    expect(() => xmlDomShim.parseFromString(entity)).toThrow(/DTD/);
    // ZNANA RÓŻNICA: sama deklaracja DTD bez użycia encji - xmldom ją
    // ignorował, zastępca odrzuca (OPC zabrania DTD w częściach pakietu).
    for (const source of [
      '<?xml version="1.0"?>\n<!-- c -->\n<?pi x?>\n<!DOCTYPE a><a/>',
      '\uFEFF<!DOCTYPE a SYSTEM "http://example.com/a.dtd"><a/>',
    ]) {
      expect(outcome(viaXmldom, source), source).not.toBe("ERROR");
      expect(() => xmlDomShim.parseFromString(source), source).toThrow(/DTD/);
    }
    // NEL (U+0085) przed deklaracją: `\s` w JS go nie obejmuje, a normalizacja
    // końców linii robi z niego `\n` - parser widzi poprawny prolog z DTD
    // i rozwija encje (sprawdzone w Chromium: zagnieżdżone encje rozwinięte,
    // bez `<parsererror>`, zanim zadziała bezpiecznik `doctype`). Wyrażenie musi więc
    // sprawdzać napis PO normalizacji, ten sam, który dostaje parser.
    for (const source of [
      `\u0085${entity}`,
      `\r\u0085${entity}`,
      `<?xml version="1.0"?>\u0085${entity}`,
      `\u2028${entity}`,
    ]) {
      expect(() => xmlDomShim.parseFromString(source), JSON.stringify(source)).toThrow(/DTD/);
    }
    expect(parse).not.toHaveBeenCalled();
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
  });

  it("dokument z `doctype` po parsowaniu też jest błędem (drugi bezpiecznik)", () => {
    // Wyrażenie prologu łapie każdą deklarację, jaką dopuszcza składnia XML;
    // ten przypadek podstawia parser oddający dokument z `doctype`, żeby
    // sprawdzić sam bezpiecznik po parsowaniu.
    const doc = new JSDOM("").window.document.implementation.createDocument(null, "a", null);
    const withDoctype = new JSDOM("").window.document.implementation.createDocument(
      null,
      "a",
      new JSDOM("").window.document.implementation.createDocumentType("a", "", ""),
    );
    const results = [doc, withDoctype];
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString = () => results.shift();
      },
    );
    expect(() => xmlDomShim.parseFromString("<a/>")).not.toThrow();
    expect(() => xmlDomShim.parseFromString("<a/>")).toThrow(/DTD/);
    vi.stubGlobal("DOMParser", new JSDOM("").window.DOMParser);
  });

  it("wyrażenie prologu jest liniowe: tysiące instrukcji i komentarzy bez DTD", () => {
    const started = performance.now();
    for (const source of [
      "<?a?>".repeat(20_000) + "<x/>",
      "<?a?".repeat(20_000) + "<x/>",
      "<!--a-->".repeat(20_000) + "<x/>",
      "<!--a--".repeat(20_000) + "<x/>",
    ]) {
      try {
        xmlDomShim.parseFromString(source);
      } catch {
        // Wynik nieistotny - liczy się czas.
      }
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
