// Docelowe przeglądarki bundla klienta: baza Vite 7 ZACHOWANA jawnie.
//
// Vite 8 podniósł domyślny cel ("baseline-widely-available") z listy niżej (Vite 7: Baseline
// Widely Available na 2025-05-01) do ["chrome111", "edge111", "firefox114", "safari16.4",
// "ios16.4"]. Repo nie ustawiało celu, więc samo podbicie Vite po cichu zawęziłoby obsługę:
// obniżanie składni JS (np. bloki statyczne klas, obsługiwane dopiero od Safari 16.4) i fallbacki
// CSS przestałyby obejmować Safari 16.0-16.3, Firefoksa 104-113 i Chrome/Edge 107-110. Ta lista
// trzyma je w obsłudze. Przejście na bazę Vite 8 to osobna decyzja produktowa (z ponownym
// pomiarem check:bundle i CSS), nie efekt uboczny podbicia wersji.
//
// TRZY MIEJSCA, bo Vite czyta cel przeglądarek w trzech miejscach - oba presety biorą wszystkie
// trzy z tego modułu (parytet: src/lib/ci/__tests__/viteChunkParity.test.ts):
//  1. `environments.client.build.target` - obniżanie składni JS bundla przeglądarki (Rolldown
//     dostaje `transform.target` z `build` środowiska). Celu workera nie ruszamy - ustawia go
//     Nitro dla swojego środowiska.
//  2. top-level `build.cssTarget` - minifikacja CSS (lightningcss). Wtyczka `vite:css-post` jest
//     JEDNĄ instancją dla wszystkich środowisk (TanStack Start: `builder.sharedPlugins`, Nitro:
//     `builder.sharedConfigBuild`) i czyta `build` configu NAJWYŻSZEGO poziomu, więc `cssTarget`
//     samego klienta zostałby zignorowany. To pokrętło dotyczy wyłącznie CSS-u, nie JS-u workera.
//  3. `css.lightningcss.targets` - transformacja każdego arkusza (lightningcss jako
//     `css.transformer` ustawia @lovable.dev/vite-tanstack-config); bez wartości Vite bierze tu
//     bazę SWOJEJ wersji głównej, czyli też po cichu Vite 8.
import type { LightningCSSOptions } from "vite";

/** `build.target` Vite 7 (`ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET` w vite@7.3). */
export const VITE7_BROWSER_BASELINE: readonly string[] = [
  "chrome107",
  "edge107",
  "firefox104",
  "safari16",
];

/** Cel JS/CSS w formacie `build.target` - świeża tablica (Vite oczekuje mutowalnej). */
export function browserBaselineTarget(): string[] {
  return [...VITE7_BROWSER_BASELINE];
}

type LightningcssTargets = NonNullable<LightningCSSOptions["targets"]>;

/** Nazwy przeglądarek lightningcss dla prefiksów celu (mapa `convertTargets` w Vite). */
const LIGHTNINGCSS_BROWSER: Readonly<Record<string, keyof LightningcssTargets>> = {
  chrome: "chrome",
  edge: "edge",
  firefox: "firefox",
  ios: "ios_saf",
  opera: "opera",
  safari: "safari",
};

/**
 * Ta sama lista w formacie `targets` lightningcss: `major << 16 | minor << 8` - dokładnie jak
 * `convertTargets` Vite, który robi to z `build.cssTarget` przy minifikacji. Wpis spoza mapy
 * jest błędem (cicha utrata przeglądarki z celu to właśnie klasa, którą ten moduł zamyka).
 */
export function browserBaselineLightningcssTargets(): LightningcssTargets {
  const targets: LightningcssTargets = {};
  for (const entry of VITE7_BROWSER_BASELINE) {
    const match = /^([a-z]+)(\d+)(?:\.(\d+))?$/.exec(entry);
    const browser = match ? LIGHTNINGCSS_BROWSER[match[1]] : undefined;
    if (!match || !browser) throw new Error(`nieobsługiwany cel przeglądarki: ${entry}`);
    const version = (Number(match[2]) << 16) | (Number(match[3] ?? 0) << 8);
    targets[browser] = Math.min(targets[browser] ?? version, version);
  }
  return targets;
}
