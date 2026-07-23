// Server-only Stripe REST helpers (form-encoded, no SDK - same convention as
// checkout.functions.ts). Kept as pure-ish functions with an injectable fetch
// so the failure semantics are unit-testable without a live Stripe.

export type StripeCancelResult =
  | { ok: true; alreadyCanceled: boolean }
  | { ok: false; error: string };

interface StripeErrorBody {
  error?: { code?: string; message?: string };
}

interface StripeSubscriptionBody {
  status?: string;
  cancel_at_period_end?: boolean;
}

/**
 * Ustawia cancel_at_period_end=true na subskrypcji Stripe - użytkownik
 * zachowuje dostęp do końca opłaconego okresu, a Stripe przestaje odnawiać.
 *
 * Idempotentne z perspektywy wywołującego:
 * - subskrypcja już anulowana / nieistniejąca (resource_missing) -> ok:true,
 *   bo stan docelowy ("Stripe nie będzie dalej pobierał opłat") jest osiągnięty;
 * - każdy inny błąd -> ok:false i wywołujący NIE może oznaczyć anulowania w DB,
 *   inaczej użytkownik "po anulowaniu" byłby dalej obciążany.
 */
export async function cancelStripeSubscriptionAtPeriodEnd(
  stripeSubscriptionId: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StripeCancelResult> {
  const params = new URLSearchParams();
  params.set("cancel_at_period_end", "true");

  let resp: Response;
  try {
    resp = await fetchImpl(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
  } catch (e) {
    return { ok: false, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as StripeSubscriptionBody;
    return { ok: true, alreadyCanceled: body.status === "canceled" };
  }

  const body = (await resp.json().catch(() => ({}))) as StripeErrorBody;
  const code = body.error?.code ?? "";
  const message = body.error?.message ?? "";

  // Subskrypcja nie istnieje po stronie Stripe - nie ma czego odnawiać.
  if (resp.status === 404 || code === "resource_missing") {
    return { ok: true, alreadyCanceled: true };
  }
  // Stripe odrzuca update'y na już-anulowanej subskrypcji - stan docelowy osiągnięty.
  if (/canceled subscription/i.test(message)) {
    return { ok: true, alreadyCanceled: true };
  }

  return { ok: false, error: `stripe_error: ${resp.status} ${code || message.slice(0, 120)}` };
}

export type StripeResumeResult = { ok: true } | { ok: false; error: string };

/** Metadane faktury Stripe do rejestru dokumentów rozliczeniowych. */
export interface StripeInvoiceInfo {
  hostedUrl: string | null;
  pdfUrl: string | null;
  number: string | null;
  status: string | null;
  amountPaidCents: number | null;
  currency: string | null;
  createdAt: string | null;
}

export type StripeInvoiceResult =
  | { ok: true; invoice: StripeInvoiceInfo }
  | { ok: false; error: string };

interface StripeInvoiceBody {
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  number?: string | null;
  status?: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  created?: number | null;
}

function stripeErrorOf(status: number, raw: unknown): string {
  const body = (raw ?? {}) as StripeErrorBody;
  const code = body.error?.code ?? "";
  const message = body.error?.message ?? "";
  return `stripe_error: ${status} ${code || message.slice(0, 120)}`;
}

/**
 * Pobiera metadane faktury Stripe (linki, numer, kwota - z NIP-em zebranym
 * przez tax_id_collection). Best-effort: wołający traktuje błąd jako brak
 * dokumentu w rejestrze - faktura i tak istnieje po stronie Stripe.
 */
export async function fetchStripeInvoice(
  invoiceId: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StripeInvoiceResult> {
  let resp: Response;
  try {
    resp = await fetchImpl(`https://api.stripe.com/v1/invoices/${encodeURIComponent(invoiceId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
  } catch (e) {
    return { ok: false, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!resp.ok) {
    return { ok: false, error: stripeErrorOf(resp.status, await resp.json().catch(() => ({}))) };
  }
  const body = (await resp.json().catch(() => ({}))) as StripeInvoiceBody;
  return {
    ok: true,
    invoice: {
      hostedUrl: body.hosted_invoice_url ?? null,
      pdfUrl: body.invoice_pdf ?? null,
      number: body.number ?? null,
      status: body.status ?? null,
      amountPaidCents: typeof body.amount_paid === "number" ? body.amount_paid : null,
      currency: typeof body.currency === "string" ? body.currency.toUpperCase() : null,
      createdAt:
        typeof body.created === "number" ? new Date(body.created * 1000).toISOString() : null,
    },
  };
}

export type StripeReceiptResult =
  | { ok: true; receiptUrl: string | null }
  | { ok: false; error: string };

/**
 * Link paragonu płatności jednorazowej (charge.receipt_url) - dla sesji bez
 * faktury (invoice_creation wyłączone). Best-effort jak wyżej.
 */
export async function fetchStripeReceiptUrl(
  paymentIntentId: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StripeReceiptResult> {
  let resp: Response;
  try {
    resp = await fetchImpl(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`,
      { method: "GET", headers: { Authorization: `Bearer ${secretKey}` } },
    );
  } catch (e) {
    return { ok: false, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!resp.ok) {
    return { ok: false, error: stripeErrorOf(resp.status, await resp.json().catch(() => ({}))) };
  }
  const body = (await resp.json().catch(() => ({}))) as {
    latest_charge?: { receipt_url?: string | null } | string | null;
  };
  const charge = body.latest_charge;
  const url = charge && typeof charge === "object" ? (charge.receipt_url ?? null) : null;
  return { ok: true, receiptUrl: url };
}

/** Element subskrypcji potrzebny do zmiany planu (id pozycji + produkt + waluta). */
export interface StripeSubscriptionItemInfo {
  itemId: string;
  productId: string;
  currency: string;
  currentPeriodEnd: string | null;
}

export type StripeSubscriptionItemResult =
  | { ok: true; item: StripeSubscriptionItemInfo }
  | { ok: false; error: string };

export async function fetchStripeSubscriptionItem(
  stripeSubscriptionId: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StripeSubscriptionItemResult> {
  let resp: Response;
  try {
    resp = await fetchImpl(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${secretKey}` } },
    );
  } catch (e) {
    return { ok: false, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!resp.ok) {
    return { ok: false, error: stripeErrorOf(resp.status, await resp.json().catch(() => ({}))) };
  }
  const body = (await resp.json().catch(() => ({}))) as {
    current_period_end?: number | null;
    items?: { data?: Array<{ id?: string; price?: { product?: string; currency?: string } }> };
  };
  const first = body.items?.data?.[0];
  if (!first?.id || !first.price?.product) {
    return { ok: false, error: "stripe_error: subscription has no billable item" };
  }
  return {
    ok: true,
    item: {
      itemId: first.id,
      productId: first.price.product,
      currency: (first.price.currency ?? "").toUpperCase(),
      currentPeriodEnd:
        typeof body.current_period_end === "number"
          ? new Date(body.current_period_end * 1000).toISOString()
          : null,
    },
  };
}

export interface StripePlanChange {
  itemId: string;
  productId: string;
  currency: string;
  unitAmountCents: number;
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
}

export type StripePlanChangeResult =
  | { ok: true; currentPeriodEnd: string | null; status: string | null }
  | { ok: false; error: string };

/**
 * Podmienia cenę pozycji subskrypcji (upgrade/downgrade planu) z proratą
 * rozliczaną OD RAZU (`proration_behavior=always_invoice`): dopłata przy
 * upgrade schodzi natychmiast, nadpłata przy downgrade pomniejsza kolejną
 * fakturę. `payment_behavior=error_if_incomplete` = nieudana dopłata NIE
 * zmienia planu (wołający nie aktualizuje wtedy DB - stan spójny).
 * Zmiana planu czyści też zaplanowane anulowanie (klient zostaje).
 */
export async function changeStripeSubscriptionPrice(
  stripeSubscriptionId: string,
  change: StripePlanChange,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StripePlanChangeResult> {
  const params = new URLSearchParams();
  params.set("items[0][id]", change.itemId);
  params.set("items[0][price_data][currency]", change.currency.toLowerCase());
  params.set("items[0][price_data][product]", change.productId);
  params.set("items[0][price_data][unit_amount]", String(change.unitAmountCents));
  params.set("items[0][price_data][recurring][interval]", change.interval);
  if (change.intervalCount > 1) {
    params.set("items[0][price_data][recurring][interval_count]", String(change.intervalCount));
  }
  params.set("proration_behavior", "always_invoice");
  params.set("payment_behavior", "error_if_incomplete");
  params.set("cancel_at_period_end", "false");

  let resp: Response;
  try {
    resp = await fetchImpl(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
  } catch (e) {
    return { ok: false, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!resp.ok) {
    return { ok: false, error: stripeErrorOf(resp.status, await resp.json().catch(() => ({}))) };
  }
  const body = (await resp.json().catch(() => ({}))) as {
    status?: string | null;
    current_period_end?: number | null;
  };
  return {
    ok: true,
    status: body.status ?? null,
    currentPeriodEnd:
      typeof body.current_period_end === "number"
        ? new Date(body.current_period_end * 1000).toISOString()
        : null,
  };
}

/**
 * Best-effort: nazwa produktu Stripe podąża za nazwą nowego planu, żeby
 * faktury po zmianie planu nie nosiły starej etykiety. Błąd jest logowany
 * przez wołającego i nigdy nie blokuje zmiany planu.
 */
export async function updateStripeProductName(
  productId: string,
  name: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean }> {
  const params = new URLSearchParams();
  params.set("name", name);
  try {
    const resp = await fetchImpl(
      `https://api.stripe.com/v1/products/${encodeURIComponent(productId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
    return { ok: resp.ok };
  } catch {
    return { ok: false };
  }
}

/**
 * Cofa cancel_at_period_end (wznowienie odnowień) - dozwolone dopóki bieżący
 * okres trwa. Brak subskrypcji po stronie Stripe = nie ma czego wznawiać
 * (ok:false; wywołujący nie czyści canceled_at).
 */
export async function resumeStripeSubscriptionAtPeriodEnd(
  stripeSubscriptionId: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StripeResumeResult> {
  const params = new URLSearchParams();
  params.set("cancel_at_period_end", "false");

  let resp: Response;
  try {
    resp = await fetchImpl(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
  } catch (e) {
    return { ok: false, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (resp.ok) return { ok: true };

  const body = (await resp.json().catch(() => ({}))) as StripeErrorBody;
  const code = body.error?.code ?? "";
  const message = body.error?.message ?? "";
  return { ok: false, error: `stripe_error: ${resp.status} ${code || message.slice(0, 120)}` };
}
