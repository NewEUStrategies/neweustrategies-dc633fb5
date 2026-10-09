// Zegar „od startu nawigacji" dla opóźnień nakładek (P3.8, recenzja M1).
//
// PO CO. Nakładki marketingowe (popup newslettera, popupy buildera, pasek
// reklamowy w stopce) montują się dopiero przy zatrzasku „pierwsza interakcja
// ALBO punkt ciszy", więc ich opóźnienia (`delay`, `delay_ms`) liczą się od
// startu nawigacji, a nie od montażu. Sam `performance.now()` liczy jednak od
// początku DOKUMENTU - a dokument wyrenderowany spekulacyjnie (Speculation
// Rules, `lib/seo/speculationRules.ts`) zaczyna żyć przed kliknięciem. Po
// aktywacji takiego dokumentu cały czas spędzony w tle wchodził w opóźnienie:
// popup „po 15 s" pokazywał się po podłodze 1 s, a pasek - zaraz po danych.
// Dla dokumentu prerenderowanego startem nawigacji jest `activationStart`
// (Navigation Timing Level 2, `PerformanceNavigationTiming`), dla zwykłego -
// zero (także w przeglądarkach bez tego pola).
//
// Osobny, maleńki moduł zamiast trzech kopii: trzech odbiorców, jedna
// definicja kotwicy. Wyłącznie w efektach (klient).

type ActivationAwareNavigationEntry = PerformanceEntry & { activationStart?: number };

/** Milisekundy od startu nawigacji (aktywacji, gdy dokument był prerenderowany). */
export function sinceNavigationStart(): number {
  const navigation = performance.getEntriesByType?.("navigation")[0] as
    ActivationAwareNavigationEntry | undefined;
  return performance.now() - (navigation?.activationStart ?? 0);
}
