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
// Do tego: dopasowanie przekierowań (wyłącznie para specyfikator + importer),
// kontrola grafu xmldom i oba moduły zastępcze. Dowód na prawdziwym buildzie -
// HTML z pliku .docx identyczny z nietkniętą biblioteką - jest
// w `officeParserTrimBuild.test.ts`.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OFFICE_PARSER_REDIRECTS,
  foreignXmldomImporters,
  matchOfficeParserRedirect,
  officeParserTrimPlugin,
  redirectTarget,
} from "../../../../scripts/lib/officeParserTrim";
import { create } from "../../files/vendor/mammothXmlWriter";
import { HTML_ENTITIES, XML_ENTITIES, entityMap } from "../../files/vendor/xmldomXmlEntities";

const require = createRequire(import.meta.url);
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

  it("przekierowuje dokładnie dwa importy", () => {
    expect(matchOfficeParserRedirect("xmlbuilder", writer)?.replacement).toBe(
      "src/lib/files/vendor/mammothXmlWriter.ts",
    );
    expect(matchOfficeParserRedirect("./entities", domParser)?.replacement).toBe(
      "src/lib/files/vendor/xmldomXmlEntities.ts",
    );
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
  });

  it("toleruje sufiksy wirtualne Rollupa i ścieżki Windows", () => {
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
});
