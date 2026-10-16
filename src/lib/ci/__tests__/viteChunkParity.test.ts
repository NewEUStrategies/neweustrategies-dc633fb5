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
 * Od Vite 8 podział klienta, baza przeglądarek i `keepNames` buildu
 * deweloperskiego są modułami w `scripts/lib/`, więc parytet treści wynika
 * z konstrukcji, a ten plik pilnuje, że OBA presety biorą je z tych samych
 * modułów i w tych samych miejscach configu. Inwarianty samych grup:
 * `clientChunkGroups.test.ts`.
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { bezKomentarzy } from "@/lib/ci/sourceScan";

import {
  browserBaselineLightningcssTargets,
  browserBaselineTarget,
  VITE7_BROWSER_BASELINE,
} from "../../../../scripts/lib/browserBaseline";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("parytet podziału chunków: vite.config.ts vs vite.smoke.config.ts", () => {
  const main = read("vite.config.ts");
  const smoke = read("vite.smoke.config.ts");
  const presets = [
    ["vite.config.ts", main],
    ["vite.smoke.config.ts", smoke],
  ] as const;

  it("oba presety biorą podział klienta z JEDNEGO modułu, w środowisku `client`", () => {
    // Grupy `codeSplitting` (priorytety, pułapka modułu wejściowego, `$initial`) żyją
    // w scripts/lib/clientChunkGroups.ts - preset z własną kopią budowałby inny podział
    // pod tymi samymi nazwami chunków.
    const helperImport =
      'import { clientCodeSplitting } from "./scripts/lib/clientChunkGroups.ts";';
    for (const [file, source] of presets) {
      const code = bezKomentarzy(source);
      expect(source, file).toContain(helperImport);
      expect(code, file).toMatch(
        /environments:\s*\{\s*client:\s*\{[^]*rolldownOptions:\s*\{\s*output:\s*\{[^}]*codeSplitting:\s*clientCodeSplitting\(\)/,
      );
      // Grupy na poziomie `build` objęłyby też worker (incydent h3-500 w komentarzu configu).
      expect(code.match(/codeSplitting:/g), file).toHaveLength(1);
    }
  });

  it("obie wyłączają hoistowanie importów tranzytywnych", () => {
    for (const [file, source] of presets) {
      expect(bezKomentarzy(source), file).toContain("hoistTransitiveImports: false");
    }
  });

  it("żaden preset nie niesie opcji, które Rolldown ignoruje albo których nie zna", () => {
    // `manualChunks` obok `codeSplitting` jest ignorowane, `experimentalMinChunkSize` Rolldown
    // pomija z ostrzeżeniem, a `rollupOptions` jest już tylko przestarzałym aliasem.
    for (const [file, source] of presets) {
      expect(bezKomentarzy(source), file).not.toMatch(
        /\b(manualChunks|advancedChunks|experimentalMinChunkSize|rollupOptions)\b/,
      );
    }
  });

  it("oba presety minifikują Oxc-iem na obu poziomach (top-level i środowisko klienta)", () => {
    // Rozjazd minifikatora między poziomami zostawia klienta nieminifikowanego, a `"esbuild"`
    // wymaga pakietu, którego repo nie deklaruje (opcjonalny peer Vite 8).
    for (const [file, source] of presets) {
      const code = bezKomentarzy(source);
      expect(code.match(/build:\s*\{\s*minify:\s*"oxc",/g), file).toHaveLength(2);
      expect(code, file).not.toMatch(/minify:\s*"esbuild"/);
    }
  });

  it("smoke always emits its own graph for browser timing", () => {
    expect(smoke).toContain("chunkInventoryPlugin(true)");
  });

  it("oba presety tną martwy kod parsera .docx TĄ SAMĄ wtyczką", () => {
    // `officeParserTrimPlugin` przekierowuje dwa moduły w bundlu przeglądarki
    // (zapis XML mammoth, tablica encji HTML xmldom). Smoke bez niej
    // budowałby inny chunk podglądu .docx niż produkcja.
    const helperImport =
      'import { officeParserTrimPlugin } from "./scripts/lib/officeParserTrim.ts";';
    for (const [file, source] of presets) {
      expect(source, file).toContain(helperImport);
      expect(source, file).toMatch(/plugins: \[[^\]]*officeParserTrimPlugin\(\)/);
    }
  });

  it("oba presety przepisują manifest Start TĄ SAMĄ wtyczką bootu po LCP (P2.1)", () => {
    // Smoke bez `bootAfterLcpPlugin` budowałby dokument z preloadami i skryptem wejścia
    // z manifestu, czyli boot-test i pomiar badałyby inny start aplikacji niż produkcja.
    const helperImport =
      'import { bootAfterLcpPlugin } from "./scripts/lib/bootAfterLcpPlugin.ts";';
    for (const [file, source] of presets) {
      expect(source, file).toContain(helperImport);
      expect(source, file).toMatch(/plugins: \[[^\]]*bootAfterLcpPlugin\(\)/);
    }
  });

  it("oba presety minifikują statyczne literały CSS TĄ SAMĄ wtyczką (P3.7a)", () => {
    // Smoke bez `staticCssPlugin` niósłby literały z komentarzami i wcięciami, czyli bramka
    // wagi dokumentu (`inlineCssCommentBytes`) i boot-test mierzyłyby inny dokument i inny
    // chunk wejściowy niż produkcja.
    const helperImport = 'import { staticCssPlugin } from "./scripts/lib/staticCssPlugin.ts";';
    for (const [file, source] of presets) {
      expect(source, file).toContain(helperImport);
      expect(source, file).toMatch(/plugins: \[[^\]]*staticCssPlugin\(\)/);
    }
  });

  it("oba presety przywracają `keepNames` buildu deweloperskiego TĄ SAMĄ wtyczką", () => {
    // Lovable ustawia `esbuild.keepNames` dla `build --mode development`, a Vite 8 nie
    // minifikuje już esbuildem - bez wtyczki `build:dev` traci nazwy funkcji i klas.
    const helperImport =
      'import { devBuildKeepNamesPlugin } from "./scripts/lib/devBuildKeepNames.ts";';
    for (const [file, source] of presets) {
      expect(source, file).toContain(helperImport);
      expect(source, file).toMatch(/plugins: \[[^\]]*devBuildKeepNamesPlugin\(\)/);
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
});

describe("baza przeglądarek klienta: Vite 7 zachowany jawnie w obu presetach", () => {
  const presets = [
    ["vite.config.ts", read("vite.config.ts")],
    ["vite.smoke.config.ts", read("vite.smoke.config.ts")],
  ] as const;

  it("lista to DOKŁADNIE domyślny `build.target` Vite 7, nie Vite 8", () => {
    // Vite 8 podniósł domyślną bazę do chrome111/edge111/firefox114/safari16.4/ios16.4.
    // Zmiana tej listy to decyzja produktowa (nagłówek scripts/lib/browserBaseline.ts).
    expect(VITE7_BROWSER_BASELINE).toEqual(["chrome107", "edge107", "firefox104", "safari16"]);
    expect(browserBaselineTarget()).toEqual([...VITE7_BROWSER_BASELINE]);
    expect(browserBaselineTarget()).not.toBe(browserBaselineTarget());
  });

  it("cel lightningcss = ta sama lista w formacie `major << 16 | minor << 8`", () => {
    expect(browserBaselineLightningcssTargets()).toEqual({
      chrome: 107 << 16,
      edge: 107 << 16,
      firefox: 104 << 16,
      safari: 16 << 16,
    });
  });

  it("oba presety stosują bazę w TRZECH miejscach, a cel JS tylko w środowisku klienta", () => {
    const helperImport = [
      "import {",
      "  browserBaselineLightningcssTargets,",
      "  browserBaselineTarget,",
      '} from "./scripts/lib/browserBaseline.ts";',
    ].join("\n");
    for (const [file, source] of presets) {
      const code = bezKomentarzy(source);
      expect(source, file).toContain(helperImport);
      const client = code.indexOf("environments: {");
      expect(client, `${file}: brak environments`).toBeGreaterThan(-1);
      // 1. Składnia JS: wyłącznie w środowisku klienta - top-level `target` zmieniłby cel
      //    workera, którego ta decyzja nie dotyczy.
      const targets = [...code.matchAll(/\btarget:\s*browserBaselineTarget\(\)/g)];
      expect(targets, file).toHaveLength(1);
      expect(targets[0]!.index, file).toBeGreaterThan(client);
      expect(code, file).not.toMatch(/\btarget:(?!\s*browserBaselineTarget\(\))/);
      // 2. Minifikacja CSS: top-level, bo wtyczkę CSS współdzielą wszystkie środowiska.
      const cssTargets = [...code.matchAll(/\bcssTarget:\s*browserBaselineTarget\(\)/g)];
      expect(cssTargets, file).toHaveLength(1);
      expect(cssTargets[0]!.index, file).toBeLessThan(client);
      // 3. Transformacja arkuszy.
      expect(code, file).toContain(
        "css: { lightningcss: { targets: browserBaselineLightningcssTargets() } },",
      );
    }
  });
});
