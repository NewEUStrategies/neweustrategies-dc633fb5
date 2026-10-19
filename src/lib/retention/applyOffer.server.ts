// OFERTA RETENCYJNA = RABAT NA SUBSKRYPCJI OPERATORA (S2, P02).
//
// DEFEKT, KTÓRY TO NAPRAWIA. Dawniej przyjęcie oferty zakładało kupon B2B
// (`b2b_coupons`) z kodem do skopiowania. Kod był NIEWYKONALNY: kupon B2B
// działa wyłącznie w kasie nowego zakupu, a kasa blokuje drugi zakup przy
// żywej subskrypcji - klient, który dał się zatrzymać obietnicą rabatu, nie
// miał jak go użyć i płacił pełną cenę. Teraz rabat zakłada się WPROST na
// subskrypcji u operatora: kupon `duration: "repeating"` na tyle miesięcy,
// ile trwa `discount_periods` okresów rozliczeniowych, dopięty do
// istniejących rabatów (nigdy ich nie zastępuje).
//
// IDEMPOTENCJA. Oba wywołania operatora niosą klucz z identyfikatora
// przepływu (`retention-coupon:{feedback_id}`, `retention:{feedback_id}`):
// dwuklik, ponowienie sieciowe albo powtórka po zerwanym połączeniu trafiają
// w ten sam klucz i dostają zapamiętaną odpowiedź zamiast DRUGIEGO rabatu.
// Jeden przepływ = najwyżej jeden kupon i jedno dopięcie.
//
// MIESIĄCE, NIE OKRESY. Operator liczy `duration_in_months` w miesiącach
// kalendarzowych i stosuje rabat do każdej faktury wystawionej w tym czasie.
// Dla planu miesięcznego „3 okresy" = 3 miesiące; dla rocznego 3 miesiące
// objęłyby JEDNĄ fakturę, a dla tygodniowego - kilkanaście. Dlatego okresy
// przeliczamy cyklem subskrypcji (`retentionDurationInMonths`), żeby klient
// dostał dokładnie tyle obniżonych płatności, ile obiecał dialog.
//
// Moduł serwerowy (`.server.ts`): klient operatora wstrzykiwany parametrem,
// więc test podaje atrapę bez sieci (test „parametry + klucz idempotencji").
import type Stripe from "stripe";

/** Warunki oferty z `retention_settings` (procent i liczba okresów). */
export interface RetentionOfferTerms {
  discountPct: number;
  discountPeriods: number;
}

/** Cykl rozliczeniowy subskrypcji operatora. */
export interface RetentionCycle {
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
}

/** Klucze idempotencji jednego przepływu (SPEC §4.5: `retention:{feedback_id}`). */
export function retentionIdempotencyKeys(feedbackId: string) {
  return {
    coupon: `retention-coupon:${feedbackId}`,
    subscription: `retention:${feedbackId}`,
  } as const;
}

/**
 * Liczba miesięcy rabatu obejmująca DOKŁADNIE `periods` faktur danego cyklu.
 * Najmniej 1 miesiąc (wymóg operatora), cykle krótsze niż miesiąc zaokrąglane
 * w górę - obietnica „N płatności taniej" nie może się skrócić.
 */
export function retentionDurationInMonths(periods: number, cycle: RetentionCycle | null): number {
  const n = Math.max(1, Math.trunc(periods));
  if (!cycle) return n;
  const count = Math.max(1, Math.trunc(cycle.intervalCount));
  switch (cycle.interval) {
    case "year":
      return n * 12 * count;
    case "month":
      return n * count;
    case "week":
      return Math.max(1, Math.ceil((n * count * 7) / 30));
    case "day":
      return Math.max(1, Math.ceil((n * count) / 30));
  }
}

export type ApplyRetentionOfferResult =
  | { ok: true; couponId: string; durationInMonths: number }
  | { ok: false; error: "subscription_not_active" | "provider_error"; message?: string };

/** Statusy, przy których rabat ma sens - subskrypcja nadal się odnawia. */
const DISCOUNTABLE = new Set(["active", "trialing", "past_due"]);

/** Minimalny kształt klienta operatora używany przez ofertę (atrapa w teście). */
export interface RetentionStripeClient {
  subscriptions: {
    retrieve: (id: string) => Promise<Stripe.Subscription>;
    update: (
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options: { idempotencyKey: string },
    ) => Promise<Stripe.Subscription>;
  };
  coupons: {
    create: (
      params: Stripe.CouponCreateParams,
      options: { idempotencyKey: string },
    ) => Promise<Stripe.Coupon>;
  };
}

function cycleOf(subscription: Stripe.Subscription): RetentionCycle | null {
  const recurring = subscription.items?.data?.[0]?.price?.recurring;
  if (!recurring) return null;
  return { interval: recurring.interval, intervalCount: recurring.interval_count ?? 1 };
}

/** Identyfikatory rabatów już dopiętych do subskrypcji (rozwinięte albo nie). */
function existingDiscountIds(subscription: Stripe.Subscription): string[] {
  const list = (subscription as { discounts?: Array<string | { id: string }> }).discounts ?? [];
  return list
    .map((d) => (typeof d === "string" ? d : d?.id))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * Zakłada kupon `repeating` i dopina go do subskrypcji operatora, zachowując
 * istniejące rabaty. Odmowa operatora wraca jako wynik (`provider_error`) -
 * wywołujący decyduje o komunikacie, a ponowienie z tym samym `feedbackId`
 * jest bezpieczne (klucze idempotencji).
 */
export async function applyRetentionOffer(
  stripe: RetentionStripeClient,
  input: {
    providerSubscriptionId: string;
    feedbackId: string;
    terms: RetentionOfferTerms;
  },
): Promise<ApplyRetentionOfferResult> {
  const keys = retentionIdempotencyKeys(input.feedbackId);
  try {
    const subscription = await stripe.subscriptions.retrieve(input.providerSubscriptionId);
    if (!DISCOUNTABLE.has(subscription.status)) {
      return { ok: false, error: "subscription_not_active" };
    }
    const durationInMonths = retentionDurationInMonths(
      input.terms.discountPeriods,
      cycleOf(subscription),
    );
    const coupon = await stripe.coupons.create(
      {
        percent_off: Math.min(100, Math.max(1, input.terms.discountPct)),
        duration: "repeating",
        duration_in_months: durationInMonths,
        // Kupon jednego klienta: drugi raz go nie użyje nikt, nawet ręcznie.
        max_redemptions: 1,
        name: `Retencja -${input.terms.discountPct}%`,
        metadata: {
          source: "retention",
          feedback_id: input.feedbackId,
          provider_subscription_id: input.providerSubscriptionId,
        },
      },
      { idempotencyKey: keys.coupon },
    );
    await stripe.subscriptions.update(
      input.providerSubscriptionId,
      {
        // Istniejące rabaty zostają: zamiana listy na sam nowy kupon
        // zdjęłaby klientowi rabat, który już ma (np. B2B z zakupu).
        discounts: [
          ...existingDiscountIds(subscription).map((discount) => ({ discount })),
          { coupon: coupon.id },
        ],
      },
      { idempotencyKey: keys.subscription },
    );
    return { ok: true, couponId: coupon.id, durationInMonths };
  } catch (error) {
    return {
      ok: false,
      error: "provider_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
