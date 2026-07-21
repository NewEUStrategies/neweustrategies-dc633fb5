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

export type StripeInvoiceUrlResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

interface StripeInvoiceBody {
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
}

/**
 * Pobiera link do hostowanej faktury Stripe (z NIP-em zebranym przez
 * tax_id_collection). Best-effort: wołający traktuje błąd jako brak linku -
 * faktura i tak istnieje po stronie Stripe, my tylko nie mamy skrótu.
 */
export async function fetchStripeInvoiceUrl(
  invoiceId: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StripeInvoiceUrlResult> {
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
    const body = (await resp.json().catch(() => ({}))) as StripeErrorBody;
    const code = body.error?.code ?? "";
    const message = body.error?.message ?? "";
    return { ok: false, error: `stripe_error: ${resp.status} ${code || message.slice(0, 120)}` };
  }
  const body = (await resp.json().catch(() => ({}))) as StripeInvoiceBody;
  return { ok: true, url: body.hosted_invoice_url ?? body.invoice_pdf ?? null };
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
