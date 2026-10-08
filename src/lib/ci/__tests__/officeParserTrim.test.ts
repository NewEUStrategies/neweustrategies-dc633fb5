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
// Bluebird i tablica `dingbat-to-unicode` są zastąpione, a nie wycięte - tu
// test pilnuje, że mammoth nie woła niczego, czego zastępca nie ma, i że
// zastępca daje te same wyniki co pakiet.
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

import { describe, expect, it } from "vitest";

import {
  OFFICE_PARSER_REDIRECTS,
  foreignXmldomImporters,
  matchOfficeParserRedirect,
  officeParserTrimPlugin,
  redirectTarget,
} from "../../../../scripts/lib/officeParserTrim";
import * as dingbats from "../../files/vendor/dingbatToUnicode";
import * as mammothPromises from "../../files/vendor/mammothPromises";
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
