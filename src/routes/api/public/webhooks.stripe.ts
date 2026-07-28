import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { grantEntitlement } from "@/lib/billing/grant.server";
import { applyCouponEffectsForOrder } from "@/lib/billing/couponEffects.server";
import {
  notifyEventRegistration,
  notifySubscriptionEmail,
} from "@/lib/billing/notifications.server";


// Stripe webhook endpoint.
// Receives Checkout / Subscription events, verifies signature, and reconciles
// payment_orders + user_subscriptions in the database using the service role.
//
// Configure STRIPE_WEBHOOK_SECRET in project secrets. Stripe sends the signature
// as `Stripe-Signature: t=<unix>,v1=<hmac>` over `t.payload`.

export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const TOLERANCE_SECONDS = 60 * 5;

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  const parts = header.split(",").map((p) => p.trim());
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "t") timestamp = Number(v);
    else if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function verifySignature(payload: string, header: string, secret: string): boolean {
  const parsed = parseHeader(header);
  if (!parsed) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (ageSec > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${payload}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected);
  return parsed.signatures.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

function str(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" ? v : null;
}

function num(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" ? v : null;
}

type SupabaseAdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

interface BillingDocumentUpsert {
  tenant_id: string;
  user_id: string;
  subscription_id?: string;
  order_id?: string;
  kind: "invoice" | "receipt";
  status: "paid" | "open" | "void" | "refunded";
  provider_document_id: string;
  number?: string | null;
  amount_cents?: number;
  currency?: string;
  hosted_url?: string | null;
  pdf_url?: string | null;
  issued_at?: string;
}

type WriteResult = { error: { message: string } | null };

// Zapis stanu pieniędzy/uprawnienia MUSI rzucać.
//
// Handler zwraca 200 dla wszystkiego, co nie rzuciło (`:ok` na końcu), a Stripe
// po 200 nie ponawia dostawy. `supabase-js` nie rzuca przy błędzie zapisu -
// oddaje go w `error`. Zapis bez kontroli `error` daje więc TRWAŁY rozjazd
// stanu: subskrypcja anulowana u Stripe zostaje `active` u nas, zwrot nie
// odbiera dostępu, zamówienie nie księguje się na `paid`. Ten helper zamienia
// błąd zapisu w wyjątek, który `catch` handlera tłumaczy na 500 - wtedy Stripe
// ponawia i stan się dogania.
//
// Wyjątek od reguły: rejestr `billing_documents` jest świadomie best-effort
// (patrz `upsertBillingDocument`) - dokument nie może wywrócić księgowania,
// więc tam logujemy ostrzeżenie zamiast rzucać.
async function mustWrite(op: PromiseLike<WriteResult>, what: string): Promise<void> {
  const { error } = await op;
  if (error) throw new Error(`${what}: ${error.message}`);
}

// Rejestr dokumentów rozliczeniowych: idempotentnie po (provider, dokument).
// Best-effort - dokument nigdy nie może wywrócić księgowania płatności;
// klucze pominięte w payloadzie nie nadpisują wartości z drugiej ścieżki
// (checkout.session.completed i invoice.payment_succeeded piszą ten sam
// wiersz, każda dokleja swoje powiązanie: order_id / subscription_id).
async function upsertBillingDocument(
  supabaseAdmin: SupabaseAdminClient,
  doc: BillingDocumentUpsert,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("billing_documents")
    .upsert({ provider: "stripe", ...doc }, { onConflict: "provider,provider_document_id" });
  if (error) {
    console.warn(
      "[stripe-webhook] billing document upsert failed",
      doc.provider_document_id,
      error,
    );
  }
}

async function handle(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return new Response("not_configured", { status: 503 });
  }
  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("missing_signature", { status: 400 });

  const payload = await request.text();
  if (!verifySignature(payload, sig, secret)) {
    return new Response("invalid_signature", { status: 401 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return new Response("invalid_json", { status: 400 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const orderId =
          str(session, "client_reference_id") ??
          (session.metadata as Record<string, string> | null)?.order_id ??
          null;
        const sessionId = str(session, "id");
        const subscriptionId = str(session, "subscription");
        const paymentIntent = str(session, "payment_intent");
        const amountTotal =
          typeof session.amount_total === "number" ? (session.amount_total as number) : null;
        const currency = str(session, "currency");
        const customerEmail =
          str(session, "customer_email") ??
          ((session.customer_details as Record<string, unknown> | null)?.email as string | null) ??
          null;

        // Darowizny (metadata.kind=donation) omijają payment_orders i silnik
        // uprawnień - lądują w lekkiej tabeli księgowej donations. Unikalny
        // provider_session_id czyni retry webhooka no-opem (ignoreDuplicates).
        const meta = (session.metadata as Record<string, string> | null) ?? null;
        if (meta?.kind === "donation") {
          if (!sessionId || amountTotal === null || amountTotal <= 0) break;
          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const tenantId =
            meta.tenant_id && uuidRe.test(meta.tenant_id) ? meta.tenant_id : undefined;
          // Zalogowany darczyńca (metadata.user_id) -> trigger nada warstwę
          // "Wspierający". Anonimowa darowizna zostawia user_id NULL.
          const donorUserId = meta.user_id && uuidRe.test(meta.user_id) ? meta.user_id : undefined;
          const { error: donationErr } = await supabaseAdmin.from("donations").upsert(
            {
              // undefined -> klucz pominięty w JSON -> kolumna bierze DEFAULT.
              tenant_id: tenantId,
              amount_cents: amountTotal,
              currency: (currency ?? "pln").toUpperCase(),
              donor_email: customerEmail,
              user_id: donorUserId,
              message: meta.message?.slice(0, 500) || null,
              provider: "stripe",
              provider_session_id: sessionId,
              provider_intent_id: paymentIntent,
            },
            { onConflict: "provider_session_id", ignoreDuplicates: true },
          );
          if (donationErr) throw donationErr;
          break;
        }

        if (!orderId && !sessionId) break;

        // Load the order WITHOUT gating on status. Idempotency lives in
        // grantEntitlement (keyed on external_ref for subscriptions and the
        // unique (user, entity) key for purchases), so we can safely grant on
        // every delivery. Gating the *grant* on "did this delivery flip the
        // status to paid" was a bug: if grantEntitlement threw after the status
        // was already flipped, the Stripe retry found the order paid, matched
        // zero rows, and skipped the grant forever - customer charged, no access.
        const cols =
          "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, amount_cents, currency";
        const { data: order, error: orderErr } = orderId
          ? await supabaseAdmin.from("payment_orders").select(cols).eq("id", orderId).maybeSingle()
          : await supabaseAdmin
              .from("payment_orders")
              .select(cols)
              .eq("provider_session_id", sessionId!)
              .maybeSingle();
        if (orderErr) throw orderErr;
        if (!order) break;

        // Grant first (idempotent). A retry after a transient grant failure
        // still completes the grant because we no longer skip it once paid.
        await grantEntitlement(
          amountTotal !== null ? { ...order, amount_cents: amountTotal } : order,
          subscriptionId ?? sessionId,
        );

        // Then record the payment. `.neq("status","paid")` keeps paid_at stamped
        // exactly once across retries; the grant above already ran regardless.
        type OrderUpdate = {
          status: "paid";
          paid_at: string;
          provider_intent_id: string | null;
          provider_session_id: string | null;
          provider_subscription_id?: string | null;
          amount_cents?: number;
          currency?: string;
          receipt_email?: string;
          invoice_url?: string;
        };
        const updates: OrderUpdate = {
          status: "paid",
          paid_at: new Date().toISOString(),
          provider_intent_id: paymentIntent,
          provider_session_id: sessionId,
          // Ten sam identyfikator, którego grantEntitlement użył jako
          // external_ref subskrypcji - pozwala zawęzić refund do tej subskrypcji.
          provider_subscription_id: subscriptionId ?? sessionId,
        };
        if (amountTotal !== null) updates.amount_cents = amountTotal;
        if (currency) updates.currency = currency.toUpperCase();
        if (customerEmail) updates.receipt_email = customerEmail;

        // Faktura Stripe (z NIP-em z tax_id_collection): sesja niesie id
        // faktury dla subskrypcji zawsze, dla trybu payment - gdy włączono
        // invoice_creation. Best-effort: brak linku nie blokuje księgowania,
        // "Pobierz fakturę" w /profile/orders po prostu się nie pokaże.
        // Metadane trafiają też do rejestru billing_documents (podgląd + PDF
        // w profilu); sesje bez faktury dostają paragon płatności (receipt).
        const invoiceId = str(session, "invoice");
        const stripeSecret = process.env.STRIPE_SECRET_KEY;
        if (invoiceId && stripeSecret) {
          const { fetchStripeInvoice } = await import("@/lib/billing/stripe.server");
          const invoiceRes = await fetchStripeInvoice(invoiceId, stripeSecret);
          if (invoiceRes.ok) {
            const inv = invoiceRes.invoice;
            const url = inv.hostedUrl ?? inv.pdfUrl;
            if (url) updates.invoice_url = url;
            await upsertBillingDocument(supabaseAdmin, {
              tenant_id: order.tenant_id,
              user_id: order.user_id,
              order_id: order.id,
              kind: "invoice",
              status: inv.status === "void" ? "void" : "paid",
              provider_document_id: invoiceId,
              number: inv.number,
              amount_cents: inv.amountPaidCents ?? amountTotal ?? order.amount_cents,
              currency: inv.currency ?? (currency ?? order.currency).toUpperCase(),
              hosted_url: inv.hostedUrl,
              pdf_url: inv.pdfUrl,
              issued_at: inv.createdAt ?? new Date().toISOString(),
            });
          } else {
            console.warn("[stripe-webhook] invoice fetch failed", invoiceId, invoiceRes.error);
          }
        } else if (paymentIntent && stripeSecret) {
          const { fetchStripeReceiptUrl } = await import("@/lib/billing/stripe.server");
          const receiptRes = await fetchStripeReceiptUrl(paymentIntent, stripeSecret);
          if (receiptRes.ok && receiptRes.receiptUrl) {
            await upsertBillingDocument(supabaseAdmin, {
              tenant_id: order.tenant_id,
              user_id: order.user_id,
              order_id: order.id,
              kind: "receipt",
              status: "paid",
              provider_document_id: paymentIntent,
              amount_cents: amountTotal ?? order.amount_cents,
              currency: (currency ?? order.currency).toUpperCase(),
              hosted_url: receiptRes.receiptUrl,
            });
          } else if (!receiptRes.ok) {
            console.warn("[stripe-webhook] receipt fetch failed", paymentIntent, receiptRes.error);
          }
        }

        // Musi rzucać: `apply_b2b_coupon_effects` poniżej jest fail-closed na
        // `status='paid'`, więc nieudany flip cicho pomija efekty kuponu B2B.
        await mustWrite(
          supabaseAdmin
            .from("payment_orders")
            .update(updates)
            .eq("id", order.id)
            .neq("status", "paid"),
          `payment_orders paid flip (${order.id})`,
        );

        // Efekty kuponu B2B (warstwa członkowska + CRM) DOPIERO po zaksięgowaniu
        // płatności - `apply_b2b_coupon_effects` fail-closed wymaga
        // `status='paid'`, więc kolejność jest tu istotna. Idempotencja siedzi w
        // bazie (zatrzask `effects_applied_at`), więc wywołanie przy każdej
        // dostawie jest bezpieczne i samonaprawiające po nieudanej próbie.
        await applyCouponEffectsForOrder(order.id);

        // Powiadomienia mailowe (fail-soft, idempotentne po id zamówienia):
        // potwierdzenie subskrypcji albo potwierdzenie zapisu na wydarzenie.
        if (order.kind === "subscription") {
          await notifySubscriptionEmail({
            kind: "subscription_confirmed",
            userId: order.user_id,
            planId: order.plan_id,
            amountCents: amountTotal ?? order.amount_cents,
            currency: (currency ?? order.currency ?? "PLN").toUpperCase(),
            idempotencySeed: order.id,
          });
        }
        const paidEventId = meta?.event_id ?? null;
        if (paidEventId) {
          await notifyEventRegistration({
            userId: order.user_id,
            eventId: paidEventId,
            amountCents: amountTotal ?? order.amount_cents,
            currency: (currency ?? order.currency ?? "PLN").toUpperCase(),
            idempotencySeed: order.id,
          });
        }
        break;
      }


      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const invoiceId = str(invoice, "id");
        const subscriptionId = str(invoice, "subscription");
        const periodEnd =
          typeof invoice.period_end === "number"
            ? new Date((invoice.period_end as number) * 1000)
            : null;
        if (subscriptionId && periodEnd) {
          // Stripe nie gwarantuje kolejności zdarzeń: spóźniona faktura nie
          // może reanimować subskrypcji już anulowanej przez
          // customer.subscription.deleted.
          await mustWrite(
            supabaseAdmin
              .from("user_subscriptions")
              .update({ status: "active", current_period_end: periodEnd.toISOString() })
              .eq("external_ref", subscriptionId)
              .neq("status", "canceled"),
            `user_subscriptions renewal (${subscriptionId})`,
          );

          // Mail o przedłużeniu tylko dla kolejnych okresów - pierwszą fakturę
          // pokrywa potwierdzenie subskrypcji z checkoutu.
          if (str(invoice, "billing_reason") !== "subscription_create") {
            const { data: renewed } = await supabaseAdmin
              .from("user_subscriptions")
              .select("user_id, plan_id")
              .eq("external_ref", subscriptionId)
              .maybeSingle();
            if (renewed?.user_id) {
              await notifySubscriptionEmail({
                kind: "subscription_renewed",
                userId: renewed.user_id,
                planId: renewed.plan_id,
                periodEnd: periodEnd.toISOString(),
                amountCents: num(invoice, "amount_paid"),
                currency: (str(invoice, "currency") ?? "PLN").toUpperCase(),
                idempotencySeed: invoiceId ?? `${subscriptionId}:${periodEnd.toISOString()}`,
              });
            }
          }
        }


        // Rejestr dokumentów: payload faktury niesie komplet metadanych, więc
        // KAŻDE odnowienie zostawia dokument widoczny w profilu (dotąd ślad
        // zostawiał tylko pierwszy checkout). Właściciela wskazuje subskrypcja
        // (external_ref) albo - dla faktur jednorazowych - zamówienie po
        // payment_intent.
        if (invoiceId) {
          let target: {
            tenant_id: string;
            user_id: string;
            subscription_id?: string;
            order_id?: string;
          } | null = null;
          if (subscriptionId) {
            const { data: subRow } = await supabaseAdmin
              .from("user_subscriptions")
              .select("id, user_id, tenant_id")
              .eq("external_ref", subscriptionId)
              .maybeSingle();
            if (subRow) {
              target = {
                tenant_id: subRow.tenant_id,
                user_id: subRow.user_id,
                subscription_id: subRow.id,
              };
            }
          } else {
            const paymentIntent = str(invoice, "payment_intent");
            if (paymentIntent) {
              const { data: orderRow } = await supabaseAdmin
                .from("payment_orders")
                .select("id, user_id, tenant_id")
                .eq("provider_intent_id", paymentIntent)
                .maybeSingle();
              if (orderRow) {
                target = {
                  tenant_id: orderRow.tenant_id,
                  user_id: orderRow.user_id,
                  order_id: orderRow.id,
                };
              }
            }
          }
          if (target) {
            const created = num(invoice, "created");
            await upsertBillingDocument(supabaseAdmin, {
              ...target,
              kind: "invoice",
              status: "paid",
              provider_document_id: invoiceId,
              number: str(invoice, "number"),
              amount_cents: num(invoice, "amount_paid") ?? 0,
              currency: (str(invoice, "currency") ?? "PLN").toUpperCase(),
              hosted_url: str(invoice, "hosted_invoice_url"),
              pdf_url: str(invoice, "invoice_pdf"),
              issued_at: created
                ? new Date(created * 1000).toISOString()
                : new Date().toISOString(),
            });
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        // Reconcile changes made on Stripe side (cancel_at_period_end flipped
        // in the Stripe Dashboard, plan swap, past_due -> active after retry,
        // trial ending -> active). Stripe is the source of truth for the
        // subscription lifecycle; we mirror the relevant fields.
        const sub = event.data.object;
        const subId = str(sub, "id");
        if (!subId) break;
        const stripeStatus = str(sub, "status");
        const cancelAtPeriodEnd = sub.cancel_at_period_end === true;
        const periodEnd =
          typeof sub.current_period_end === "number"
            ? new Date((sub.current_period_end as number) * 1000).toISOString()
            : null;
        // Stripe -> our purchase_status enum {pending,active,refunded,canceled}.
        // trialing/past_due/unpaid still grant access until Stripe deletes the
        // subscription, so we keep them 'active' and let has_content_access
        // gate on current_period_end.
        const localStatus: "active" | "canceled" =
          stripeStatus === "canceled" || stripeStatus === "incomplete_expired"
            ? "canceled"
            : "active";

        type SubUpdate = {
          status: "active" | "canceled";
          canceled_at?: string | null;
          current_period_end?: string;
        };
        const updates: SubUpdate = { status: localStatus };
        if (periodEnd) updates.current_period_end = periodEnd;
        if (localStatus === "canceled") {
          updates.canceled_at = new Date().toISOString();
        } else {
          // cancel_at_period_end=true -> "cancels at period end" (keep active
          // until Stripe deletes it); false -> clear a pending cancel so the
          // UI stops showing "cancels at".
          updates.canceled_at = cancelAtPeriodEnd ? new Date().toISOString() : null;
        }
        // Zmiana planu po stronie Stripe (metadata.plan_id na subskrypcji):
        // porównanie ceny decyduje, czy to upgrade czy downgrade.
        const newPlanId = (sub.metadata as Record<string, string> | null)?.plan_id ?? null;
        const { data: current } = await supabaseAdmin
          .from("user_subscriptions")
          .select("user_id, plan_id")
          .eq("external_ref", subId)
          .maybeSingle();

        type SubUpdateWithPlan = SubUpdate & { plan_id?: string };
        const finalUpdates: SubUpdateWithPlan = { ...updates };
        const planChanged = !!newPlanId && !!current?.plan_id && newPlanId !== current.plan_id;
        if (planChanged) finalUpdates.plan_id = newPlanId;

        await mustWrite(
          supabaseAdmin.from("user_subscriptions").update(finalUpdates).eq("external_ref", subId),
          `user_subscriptions mirror (${subId})`,
        );

        if (planChanged && current?.user_id) {
          const { data: plans } = await supabaseAdmin
            .from("access_plans")
            .select("id, price_cents")
            .in("id", [current.plan_id as string, newPlanId as string]);
          const priceOf = (id: string | null) =>
            plans?.find((p) => p.id === id)?.price_cents ?? 0;
          const upgraded = priceOf(newPlanId) >= priceOf(current.plan_id);
          await notifySubscriptionEmail({
            kind: upgraded ? "subscription_upgraded" : "subscription_downgraded",
            userId: current.user_id,
            planId: newPlanId,
            previousPlanId: current.plan_id,
            periodEnd,
            idempotencySeed: `${subId}:${current.plan_id}->${newPlanId}`,
          });
        } else if (
          localStatus === "active" &&
          cancelAtPeriodEnd &&
          current?.user_id
        ) {
          // Rezygnacja z odnowienia zgłoszona przed końcem okresu.
          await notifySubscriptionEmail({
            kind: "subscription_canceled",
            userId: current.user_id,
            planId: current.plan_id,
            periodEnd,
            idempotencySeed: `${subId}:cancel_at_period_end:${periodEnd ?? ""}`,
          });
        }
        break;
      }


      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const subId = str(sub, "id");
        if (subId) {
          const { data: ending } = await supabaseAdmin
            .from("user_subscriptions")
            .select("user_id, plan_id, current_period_end")
            .eq("external_ref", subId)
            .maybeSingle();

          // Musi rzucać: cicha porażka zostawia anulowaną subskrypcję jako
          // `active`, czyli dostęp płatny po rezygnacji.
          await mustWrite(
            supabaseAdmin
              .from("user_subscriptions")
              .update({ status: "canceled", canceled_at: new Date().toISOString() })
              .eq("external_ref", subId),
            `user_subscriptions cancel (${subId})`,
          );

          if (ending?.user_id) {
            await notifySubscriptionEmail({
              kind: "subscription_canceled",
              userId: ending.user_id,
              planId: ending.plan_id,
              periodEnd: ending.current_period_end,
              idempotencySeed: `${subId}:deleted`,
            });
          }
        }

        break;
      }

      case "charge.refunded": {
        // A refund revokes entitlement: mark the order refunded and end the
        // matching subscription / purchase so has_content_access returns false.
        // Match by payment_intent (subscription first invoice, one-time payment)
        // - the same id we stored as provider_intent_id on checkout.session.completed.
        const charge = event.data.object;
        const paymentIntent = str(charge, "payment_intent");
        if (!paymentIntent) break;

        // Darowizny: refund oznacza wiersz donations (nie ma payment_order).
        // Dla zwykłych płatności dopasowanie trafia w zero wierszy - no-op.
        // Zero dopasowanych wierszy to poprawny wynik (zwykła płatność nie ma
        // wiersza donations) - błąd zapytania to inna sprawa i musi rzucać.
        await mustWrite(
          supabaseAdmin
            .from("donations")
            .update({ status: "refunded" })
            .eq("provider_intent_id", paymentIntent),
          `donations refund (${paymentIntent})`,
        );

        const { data: order, error: orderErr } = await supabaseAdmin
          .from("payment_orders")
          .select(
            "id, user_id, kind, entity_type, entity_id, provider_session_id, provider_subscription_id",
          )
          .eq("provider_intent_id", paymentIntent)
          .maybeSingle();
        // Nieudany odczyt nie może udawać „brak zamówienia" - to by cicho
        // porzuciło cały zwrot razem z odbraniem uprawnienia.
        if (orderErr) throw orderErr;
        if (!order) break;

        await mustWrite(
          supabaseAdmin.from("payment_orders").update({ status: "refunded" }).eq("id", order.id),
          `payment_orders refund (${order.id})`,
        );

        // Rejestr dokumentów: dokumenty tego zamówienia i paragon płatności
        // dostają status refunded (podgląd w profilu pokazuje prawdę).
        // Best-effort jak reszta rejestru - nie może wywrócić odebrania dostępu.
        for (const [label, op] of [
          [
            `order ${order.id}`,
            supabaseAdmin
              .from("billing_documents")
              .update({ status: "refunded" })
              .eq("order_id", order.id),
          ],
          [
            `receipt ${paymentIntent}`,
            supabaseAdmin
              .from("billing_documents")
              .update({ status: "refunded" })
              .eq("provider", "stripe")
              .eq("provider_document_id", paymentIntent),
          ],
        ] as const) {
          const { error } = await op;
          if (error) {
            console.warn("[stripe-webhook] billing document refund failed", label, error);
          }
        }

        // A one-time PURCHASE grants a user_purchases row; everything else
        // (recurring subscription OR one-time lifetime-plan) grants a
        // user_subscriptions row keyed by external_ref.
        const isEntityPurchase = order.kind === "one_time" && !!order.entity_id;

        if (isEntityPurchase) {
          await mustWrite(
            supabaseAdmin
              .from("user_purchases")
              .update({ status: "refunded" })
              .eq("user_id", order.user_id)
              .eq("entity_type", order.entity_type!)
              .eq("entity_id", order.entity_id!),
            `user_purchases refund (${order.id})`,
          );
        } else {
          // Revoke ONLY the subscription this order paid for - matched by the
          // external_ref we stored (subscription id, or session id fallback).
          // The old code cancelled EVERY active subscription of the user.
          const ref = order.provider_subscription_id ?? order.provider_session_id;
          if (ref) {
            await mustWrite(
              supabaseAdmin
                .from("user_subscriptions")
                .update({
                  status: "canceled",
                  canceled_at: new Date().toISOString(),
                  current_period_end: new Date().toISOString(),
                })
                .eq("user_id", order.user_id)
                .eq("external_ref", ref)
                .eq("status", "active"),
              `user_subscriptions refund revoke (${ref})`,
            );
          }
        }
        break;
      }

      case "checkout.session.expired":
      case "payment_intent.payment_failed": {
        const obj = event.data.object;
        const meta = obj.metadata as Record<string, string> | null;
        const orderId: string | null = meta?.order_id ?? str(obj, "client_reference_id");

        const sessionId = str(obj, "id");
        const status = event.type === "checkout.session.expired" ? "canceled" : "failed";
        if (orderId) {
          await mustWrite(
            supabaseAdmin.from("payment_orders").update({ status }).eq("id", orderId),
            `payment_orders ${status} (${orderId})`,
          );
        } else if (sessionId) {
          await mustWrite(
            supabaseAdmin
              .from("payment_orders")
              .update({ status })
              .eq("provider_session_id", sessionId),
            `payment_orders ${status} (session ${sessionId})`,
          );
        }
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (e) {
    console.error("[stripe-webhook] handler error", event.type, e);
    return new Response("handler_error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

export { verifySignature as __verifySignatureForTests };
// The full request handler, exported for tests so the reconciliation logic
// (order -> paid -> entitlement, idempotent replays, expiry/failure, invoice
// renewal, subscription cancel) is exercised, not just signature verification.
export { handle as __handleForTests };
