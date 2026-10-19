// SPÓJNOŚĆ KRZYŻOWA BENCHMARKÓW (brief 05 §5) - przeliczenia, które wiążą
// pasma różnych wskaźników.
//
// DLACZEGO TO KOD. Pasma churnu miesięcznego i rocznego, CMGR i wzrostu r/r,
// konwersji i porzuceń koszyka pochodzą z różnych źródeł, ale opisują tę samą
// rzeczywistość. Gdy ktoś poprawi jedno pasmo i zapomni o bliźniaku, panel
// pokaże „dobry” churn miesięczny i „słaby” roczny dla tego samego klienta.
// Te funkcje są jedynym miejscem wzorów; testy rejestru porównują nimi pasma,
// a diagnostyka „na żywo” może nimi wykryć niespójność trzech liczb.
//
// Wszystko w punktach procentowych (0-100), jak pasma rejestru.
import type { BenchBand } from "./types";

/** Churn roczny z miesięcznego: 100·(1 − (1 − m/100)^12). 2,7 %/mies. ≈ 28,0 % rocznie. */
export function annualizeChurn(monthlyPct: number): number {
  return 100 * (1 - Math.pow(1 - monthlyPct / 100, 12));
}

/** Odwrotność `annualizeChurn`: churn miesięczny, który w 12 miesięcy daje podany roczny. */
export function monthlyFromAnnual(annualPct: number): number {
  return 100 * (1 - Math.pow(1 - annualPct / 100, 1 / 12));
}

/**
 * Miesięczne tempo złożone (CMGR) równoważne wzrostowi r/r: (1 + g)^(1/12) − 1.
 * Kwartyle wzrostu r/r (SaaS Capital, ChartMogul) przeliczone tym wzorem dają
 * pasma `mrr_growth_mom` - dzielenie przez 12 zawyżałoby je przy dużym wzroście.
 */
export function cmgrFromYoy(yoyPct: number): number {
  return 100 * (Math.pow(1 + yoyPct / 100, 1 / 12) - 1);
}

/**
 * Efektywność wzrostu z SaaS Quick Ratio: 1 − 1/QR (ułamek). QR 4 = 75 %
 * pozyskanego MRR zostaje w bazie. Dla QR ≤ 0 wynik nie istnieje (`NaN`) -
 * utrata bez pozyskania nie ma efektywności, a nie „−∞”.
 */
export function quickRatioEfficiency(qr: number): number {
  if (!(qr > 0)) return Number.NaN;
  return 1 - 1 / qr;
}

/**
 * Pasma lustrzane dla par sumujących się do 100 (konwersja checkoutu ↔
 * porzucenia: CCR + CAR = 100). Granice odbijają się względem 100, kolejność
 * się odwraca, a poziomy zostają przy swoich przedziałach - pasmo „optymalny”
 * CCR ≥ 85 staje się „optymalny” CAR ≤ 15.
 */
export function mirrorBands(bands: readonly BenchBand[]): BenchBand[] {
  const flip = (x: number | null): number | null => (x === null ? null : 100 - x);
  return bands
    .map((b) => ({ ...b, min: flip(b.max), max: flip(b.min) }))
    .sort((a, b) => (a.min ?? Number.NEGATIVE_INFINITY) - (b.min ?? Number.NEGATIVE_INFINITY));
}
