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

  it("reguła vendorowa pomija moduł WEJŚCIOWY (pułapka zapadania się chunku)", () => {
    // Bez tej linii `manualChunks` może przypisać entry do nazwanego chunku,
    // a wtedy Rollup wciąga cały ten chunk z powrotem do entry - bez ostrzeżenia.
    expect(main).toContain("meta.getModuleInfo(id)?.isEntry");
  });
});
