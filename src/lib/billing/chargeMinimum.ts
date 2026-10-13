// Minimalna kwota obciążenia u operatora - JEDNA reguła dla obu silników kasy
// (`checkout.functions.ts`, `stripeCheckout.functions.ts`) i dla sesji z ceną
// osadzoną (`adhocCheckout.server.ts`).
//
// DLACZEGO WSPÓLNA I PER WALUTA. Pierwszy silnik odrzucał kwotę po kuponie
// poniżej 50 groszy, drugi nie miał żadnego progu: kupon 100% dawał tam
// zamówienie na 0 zł (a dla planu jednorazowego dożywotni dostęp za darmo),
// a kwota 1-49 groszy przechodziła do operatora, który i tak by ją odrzucił -
// już PO założeniu zamówienia i rezerwacji kuponu (przegląd PAY-01, 0.3).
// Do tego 50 jednostek nie jest minimum Stripe dla złotówek: operator
// przyjmuje od 2,00 zł, więc zamówienie na 1,50 zł mijało naszą bramkę
// i padało dopiero u niego.
//
// Wartości z tabeli „Minimum and maximum charge amounts" Stripe, w jednostkach
// najmniejszych (grosze, centy). Waluta spoza tabeli dostaje próg 50 - minimum
// dla większości walut dziesiętnych; operator i tak ma ostatnie słowo.
//
// Moduł czysty - bez zależności serwerowych, testowany bez atrap.

const STRIPE_MINIMUM_CHARGE_CENTS: Readonly<Record<string, number>> = {
  PLN: 200,
  EUR: 50,
  USD: 50,
  GBP: 30,
  CHF: 50,
  CZK: 1500,
  HUF: 17500,
  RON: 200,
  BGN: 100,
  DKK: 250,
  NOK: 300,
  SEK: 300,
};

/** Próg dla waluty spoza tabeli operatora. */
export const DEFAULT_MINIMUM_CHARGE_CENTS = 50;

/** Minimalna kwota jednego obciążenia u operatora w danej walucie. */
export function minimumChargeCents(currency: string | null | undefined): number {
  const code = (currency ?? "").trim().toUpperCase();
  return STRIPE_MINIMUM_CHARGE_CENTS[code] ?? DEFAULT_MINIMUM_CHARGE_CENTS;
}

/**
 * Czy kwota do zapłaty jest poniżej minimum operatora. Zero (kupon 100%),
 * kwoty ujemne i wartości nieliczbowe też są „poniżej" - kasa nie zakłada
 * zamówienia, którego operator nie obciąży.
 */
export function isBelowMinimumCharge(
  amountCents: number,
  currency: string | null | undefined,
): boolean {
  if (!Number.isFinite(amountCents)) return true;
  return amountCents < minimumChargeCents(currency);
}
