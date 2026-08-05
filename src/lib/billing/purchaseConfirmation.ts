// Czysta logika podsumowania po zakupie: co dokładnie kupił użytkownik,
// do kiedy ma dostęp i czy portal klienta jest dla niego dostępny.
// Moduł jest świadomie wolny od Reacta i sieci - konsumują go widget
// "purchase-confirmation" (builder), strona /checkout/success oraz testy.
import type { ProviderSubscriptionRow } from "./subscriptionQueries";
import type { PaymentOrder } from "./types";

export type PurchaseKind = "subscription" | "one_time" | "none";

export interface PurchaseSummary {
  kind: PurchaseKind;
  /** Surowy status u operatora (subskrypcja) lub zamówienia (jednorazowe). */
  status: string | null;
  /** ISO daty końca dostępu; null = bezterminowo lub brak danych. */
  accessEndsAt: string | null;
  /** true = po tej dacie nastąpi automatyczne odnowienie. */
  renews: boolean;
  /** Dostęp już wygasł (dane z webhooka jeszcze nie dogoniły / anulowano). */
  expired: boolean;
  /** Portal klienta ma sens tylko przy subskrypcji z klientem u operatora. */
  portalAvailable: boolean;
  /** Referencja pokazywana użytkownikowi (id transakcji/zamówienia). */
  reference: string | null;
  amountCents: number | null;
  currency: string | null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function parseTs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/** Data końca dostępu zapisana przy zakupie jednorazowym (metadata zamówienia). */
export function accessUntilFromOrder(order: PaymentOrder | null | undefined): string | null {
  const raw = order?.metadata?.access_until ?? order?.metadata?.accessUntil;
  return typeof raw === "string" && parseTs(raw) !== null ? raw : null;
}

export function buildPurchaseSummary(input: {
  subscription?: ProviderSubscriptionRow | null;
  order?: PaymentOrder | null;
  now?: Date;
}): PurchaseSummary {
  const now = (input.now ?? new Date()).getTime();
  const sub = input.subscription ?? null;
  const order = input.order ?? null;

  if (
    sub &&
    (ACTIVE_STATUSES.has(sub.status) || sub.status === "canceled" || sub.status === "paused")
  ) {
    const endsTs = parseTs(sub.current_period_end);
    const expired = endsTs !== null && endsTs <= now;
    const renews = !sub.cancel_at_period_end && ACTIVE_STATUSES.has(sub.status) && !expired;
    return {
      kind: "subscription",
      status: sub.status,
      accessEndsAt: sub.current_period_end,
      renews,
      expired,
      portalAvailable: Boolean(sub.provider_customer_id),
      reference: sub.provider_subscription_id || null,
      amountCents: null,
      currency: null,
    };
  }

  if (order && (order.status === "paid" || order.status === "processing")) {
    const accessEndsAt = accessUntilFromOrder(order);
    const endsTs = parseTs(accessEndsAt);
    return {
      kind: "one_time",
      status: order.status,
      accessEndsAt,
      renews: false,
      expired: endsTs !== null && endsTs <= now,
      portalAvailable: false,
      reference: order.provider_intent_id || order.provider_session_id || order.id,
      amountCents: order.amount_cents,
      currency: order.currency,
    };
  }

  return {
    kind: "none",
    status: order?.status ?? null,
    accessEndsAt: null,
    renews: false,
    expired: false,
    portalAvailable: false,
    reference: order?.id ?? null,
    amountCents: order?.amount_cents ?? null,
    currency: order?.currency ?? null,
  };
}

/** Czytelna data końca dostępu (PL/EN), bez godziny gdy nie wnosi informacji. */
export function formatAccessDate(iso: string | null, lang: "pl" | "en"): string | null {
  const ts = parseTs(iso);
  if (ts === null) return null;
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(ts));
}

/** Ile pełnych dni dostępu zostało (do wyświetlenia obok daty). */
export function daysLeft(iso: string | null, now: Date = new Date()): number | null {
  const ts = parseTs(iso);
  if (ts === null) return null;
  return Math.max(0, Math.ceil((ts - now.getTime()) / 86_400_000));
}
