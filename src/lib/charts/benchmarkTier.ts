// OCENA 5-STOPNIOWA WZGLĘDEM BENCHMARKU (SPEC §5.5, AD-20) - moduł TYLKO ADMINOWY.
//
// DLACZEGO NIE W `status.ts`. `status.ts` czytają wykresy PUBLICZNE (bloki CMS)
// i KpiTile panelu, więc bundler trzyma go we wspólnym chunku, który ładuje
// każdy czytelnik strony z wykresem. Funkcja eksportowana z takiego chunku
// zostaje w nim, gdy używa jej KTÓRYKOLWIEK importer - tree-shaking nie
// odróżnia czytelnika od administratora. Ocena benchmarkiem jest wyłącznie
// adminowa (odznaka, skala), więc mieszka osobno i chunk publiczny nie wiezie
// ani bajtu kodu ocen (w `status.ts` powiększały budżet `public`, zamrożony
// dla S6).
//
// KOLOR NIGDY NIE JEST JEDYNYM NOŚNIKIEM. Ranga (1-5) rysuje się kropkami,
// a obok stoi słowo oceny; kolor jest trzecim kanałem. Słaby/normalny/dobry to
// te same tokeny ról zmieszane z przezroczystością - geometria i odcień są
// jednakowe w trybie jasnym i ciemnym, zmienia się wyłącznie wartość tokenu.
import type { Tier } from "@/lib/analytics/semantic/benchmarks/types";
import { ROLE } from "./roles";

/** Ranga oceny: 1 = krytyczny … 5 = optymalny (liczba kropek). */
export function tierRank(tier: Tier): 1 | 2 | 3 | 4 | 5 {
  switch (tier) {
    case "critical":
      return 1;
    case "weak":
      return 2;
    case "normal":
      return 3;
    case "good":
      return 4;
    case "optimal":
      return 5;
  }
}

/** Kolor graficzny oceny (segment skali, kropki). */
export function tierColor(tier: Tier): string {
  switch (tier) {
    case "critical":
      return ROLE.neg;
    case "weak":
      return `color-mix(in srgb, ${ROLE.neg} 45%, transparent)`;
    case "normal":
      return `color-mix(in srgb, ${ROLE.sMain} 35%, transparent)`;
    case "good":
      return `color-mix(in srgb, ${ROLE.pos} 45%, transparent)`;
    case "optimal":
      return ROLE.pos;
  }
}

/**
 * Kolor NAPISU oceny (próg 4,5:1). Odcienie z przezroczystością nie trzymają
 * kontrastu tekstu, więc słowo oceny bierze pełne tokeny tekstowe: ujemny dla
 * krytycznego i słabego, neutralny tusz dla normalnego, dodatni dla dobrego
 * i optymalnego.
 */
export function tierTextColor(tier: Tier): string {
  switch (tier) {
    case "critical":
    case "weak":
      return ROLE.negText;
    case "normal":
      return ROLE.ink2;
    case "good":
    case "optimal":
      return ROLE.posText;
  }
}

/** Oceny od najgorszej do najlepszej - świeża tablica przy każdym wywołaniu. */
export function tierOrder(): readonly Tier[] {
  return ["critical", "weak", "normal", "good", "optimal"];
}
