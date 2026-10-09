/**
 * `vite.smoke.config.ts` istnieje po to, żeby zbudować PRODUKCYJNY artefakt na
 * preset node-server i sprawdzić BOOT KLIENTA prawdziwą przeglądarką (incydent
 * 2026-07-20: cykl chunków -> martwa hydratacja na każdej stronie, niewidoczna
 * w dev i w testach jednostkowych). Ta weryfikacja jest warta tyle, ile
 * ZGODNOŚĆ obu konfiguracji: smoke test budujący INNY podział chunków niż
 * produkcja bada podział, którego nikt nie wdraża.
 *
 * Nagłówek pliku smoke prosił dotąd o synchronizację komentarzem („UWAGA:
 * trzymać w synchronizacji"). Ten test zamienia prośbę w inwariant - i robi to
 * akurat dla fragmentu, w którym 2026-08-06 wyszło, że wadliwa reguła potrafi
 * przeżyć tygodnie bez żadnego sygnału (`vendor-tanstack` nigdy nie powstawał).
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Wycina ciało `manualChunks(...)` razem z komentarzami. */
function manualChunksBlock(source: string, file: string): string {
  const start = source.indexOf("manualChunks(");
  expect(start, `${file}: brak manualChunks`).toBeGreaterThan(-1);
  const end = source.indexOf("\n              },\n", start);
  expect(end, `${file}: nie znaleziono końca manualChunks`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("parytet podziału chunków: vite.config.ts vs vite.smoke.config.ts", () => {
  const main = read("vite.config.ts");
  const smoke = read("vite.smoke.config.ts");

  it("obie konfiguracje mają IDENTYCZNE manualChunks", () => {
    expect(manualChunksBlock(smoke, "vite.smoke.config.ts")).toBe(
      manualChunksBlock(main, "vite.config.ts"),
    );
  });

  it("obie wyłączają hoistowanie importów tranzytywnych", () => {
    for (const [file, source] of [
      ["vite.config.ts", main],
      ["vite.smoke.config.ts", smoke],
    ] as const) {
      expect(source, file).toContain("hoistTransitiveImports: false");
    }
  });

  it("both presets coalesce the same minimum chunk size", () => {
    const size = (source: string) => source.match(/experimentalMinChunkSize:\s*(\d+)/)?.[1];
    expect(size(main)).toBeDefined();
    expect(size(smoke)).toBe(size(main));
    expect(
      size(smoke.replace(/experimentalMinChunkSize:\s*\d+/, "experimentalMinChunkSize: 999")),
    ).not.toBe(size(main));
  });

  it("smoke always emits its own graph for browser timing", () => {
    expect(smoke).toContain("chunkInventoryPlugin(true)");
  });

  it("podział boot/reszta dla radix i lucide pochodzi z JEDNEGO helpera", () => {
    // Klasyfikacja osiągalności (scripts/lib/bootVendorSplit.ts) jest poza
    // wycinanym ciałem manualChunks - parytet ciała nie wystarczy, jeśli jedna
    // konfiguracja importowałaby inną implementację pod tą samą nazwą.
    const helperImport =
      'import { isBootLucideModule, isBootModule } from "./scripts/lib/bootVendorSplit";';
    expect(main).toContain(helperImport);
    expect(smoke).toContain(helperImport);
    for (const chunk of ["vendor-radix-boot", "vendor-lucide-boot"]) {
      expect(manualChunksBlock(main, "vite.config.ts")).toContain(chunk);
    }
  });

  it("oba presety tną martwy kod parsera .docx TĄ SAMĄ wtyczką", () => {
    // `officeParserTrimPlugin` przekierowuje dwa moduły w bundlu przeglądarki
    // (zapis XML mammoth, tablica encji HTML xmldom). Smoke bez niej
    // budowałby inny chunk podglądu .docx niż produkcja.
    const helperImport = 'import { officeParserTrimPlugin } from "./scripts/lib/officeParserTrim";';
    for (const [file, source] of [
      ["vite.config.ts", main],
      ["vite.smoke.config.ts", smoke],
    ] as const) {
      expect(source, file).toContain(helperImport);
      expect(source, file).toMatch(/plugins: \[[^\]]*officeParserTrimPlugin\(\)/);
    }
  });

  it("oba presety przepisują manifest Start TĄ SAMĄ wtyczką bootu po LCP (P2.1)", () => {
    // Smoke bez `bootAfterLcpPlugin` budowałby dokument z preloadami i skryptem wejścia
    // z manifestu, czyli boot-test i pomiar badałyby inny start aplikacji niż produkcja.
    const helperImport = 'import { bootAfterLcpPlugin } from "./scripts/lib/bootAfterLcpPlugin";';
    for (const [file, source] of [
      ["vite.config.ts", main],
      ["vite.smoke.config.ts", smoke],
    ] as const) {
      expect(source, file).toContain(helperImport);
      expect(source, file).toMatch(/plugins: \[[^\]]*bootAfterLcpPlugin\(\)/);
    }
  });

  it("oba presety minifikują statyczne literały CSS TĄ SAMĄ wtyczką (P3.7a)", () => {
    // Smoke bez `staticCssPlugin` niósłby literały z komentarzami i wcięciami, czyli bramka
    // wagi dokumentu (`inlineCssCommentBytes`) i boot-test mierzyłyby inny dokument i inny
    // chunk wejściowy niż produkcja.
    const helperImport = 'import { staticCssPlugin } from "./scripts/lib/staticCssPlugin";';
    for (const [file, source] of [
      ["vite.config.ts", main],
      ["vite.smoke.config.ts", smoke],
    ] as const) {
      expect(source, file).toContain(helperImport);
      expect(source, file).toMatch(/plugins: \[[^\]]*staticCssPlugin\(\)/);
    }
  });

  it("oba presety wstrzykują TEN SAM identyfikator buildu kluczy L2 (P3.6a)", () => {
    // Klucze L2 dokumentów i migawek danych niosą segment buildu ze stałej `define`. Smoke bez
    // niej budowałby serwer bez identyfikatora (L2 wyłączone w buildzie produkcyjnym), a inny
    // sposób liczenia dawałby inną przestrzeń kluczy niż produkcja.
    const buildIdBlock = (source: string, file: string): string => {
      const start = source.indexOf("const NES_BUILD_ID = ");
      expect(start, `${file}: brak NES_BUILD_ID`).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf(";", start) + 1);
    };
    expect(buildIdBlock(smoke, "vite.smoke.config.ts")).toBe(buildIdBlock(main, "vite.config.ts"));
    const define = "define: { __NES_BUILD_ID__: JSON.stringify(NES_BUILD_ID) },";
    expect(main).toContain(define);
    expect(smoke).toContain(define);
  });

  it("oba presety zdejmują preload zależności WYŁĄCZNIE chunkowi listwy prawnej", () => {
    // `modulePreload.resolveDependencies` steruje listą `__vite__mapDeps` każdego
    // `import()` w bundlu klienta. Smoke z inną regułą mierzyłby inne wejście niż
    // produkcja, a zbyt szeroki wzorzec zdjąłby preload innym leniwym chunkom.
    const preloadBlock = (source: string, file: string): string => {
      const start = source.indexOf("modulePreload: {");
      expect(start, `${file}: brak modulePreload`).toBeGreaterThan(-1);
      const end = source.indexOf("\n          },\n", start);
      expect(end, `${file}: nie znaleziono końca modulePreload`).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const block = preloadBlock(main, "vite.config.ts");
    expect(preloadBlock(smoke, "vite.smoke.config.ts")).toBe(block);
    const literal = block.match(/^\s*\/(.+)\/\.test\(file\) \? \[\] : deps,$/m)?.[1];
    expect(literal, "reguła: <wzorzec>.test(file) ? [] : deps").toBeDefined();
    const isLegalLinksChunk = new RegExp(literal ?? "(?!)");
    expect(isLegalLinksChunk.test("assets/legal-links-Cqw847lN.js")).toBe(true);
    for (const other of [
      "assets/index-Cicti5oJ.js",
      "assets/vendor-react-Bx1.js",
      "assets/footer-legal-links-Ab_1.js",
      "assets/LegalLinksPanel-Ab_1.js",
      "assets/legal-links-Cqw847lN.css",
    ]) {
      expect(isLegalLinksChunk.test(other), other).toBe(false);
    }
  });

  it("reguła vendorowa pomija moduł WEJŚCIOWY (pułapka zapadania się chunku)", () => {
    // Bez tej linii `manualChunks` może przypisać entry do nazwanego chunku,
    // a wtedy Rollup wciąga cały ten chunk z powrotem do entry - bez ostrzeżenia.
    expect(main).toContain("meta.getModuleInfo(id)?.isEntry");
  });
});
