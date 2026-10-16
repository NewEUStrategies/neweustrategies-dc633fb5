// Wtyczka: `keepNames` dla `vite build --mode development` (`build:dev`, build podglądu Lovable).
//
// PO CO. @lovable.dev/vite-tanstack-config ustawia w buildzie deweloperskim
// `esbuild: { keepNames: true }`, żeby zminifikowane funkcje i klasy zachowały `.name` (nazwy
// komponentów w błędach i nakładkach podglądu). Na Vite 7 działało to tylko dlatego, że
// minifikował esbuild (`build.minify: "esbuild"` rozkłada `config.esbuild` w wywołaniu esbuilda).
// Vite 8 minifikuje Oxc-iem w Rolldownie, a opcje `esbuild` tłumaczy na `oxc` BEZ `keepNames`,
// więc bez tej wtyczki `build:dev` po cichu traci nazwy. Rolldown ma odpowiednik:
// `output.keepNames` (zachowuje nazwy także przy minifikacji - sprawdzone na Rolldownie 1.2).
//
// ZAKRES jak u Lovable: wyłącznie `build` w trybie `development`. Top-level `build`, więc tak jak
// esbuild na Vite 7 obejmuje wszystkie środowiska (klient, SSR, worker); build produkcyjny nigdy
// nie miał `keepNames` i nadal go nie ma. Ta sama wtyczka w obu presetach (parytet:
// src/lib/ci/__tests__/viteChunkParity.test.ts).
import type { Plugin } from "vite";

export function devBuildKeepNamesPlugin(): Plugin {
  return {
    name: "nes:dev-build-keep-names",
    apply: "build",
    config: (_config, { mode }) =>
      mode === "development"
        ? { build: { rolldownOptions: { output: { keepNames: true } } } }
        : null,
  };
}
