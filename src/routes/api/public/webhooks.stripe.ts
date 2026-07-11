import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { grantEntitlement } from "@/lib/billing/grant.server";

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
          amount_cents?: number;
          currency?: string;
          receipt_email?: string;
        };
        const updates: OrderUpdate = {
          status: "paid",
          paid_at: new Date().toISOString(),
          provider_intent_id: paymentIntent,
          provider_session_id: sessionId,
        };
        if (amountTotal !== null) updates.amount_cents = amountTotal;
        if (currency) updates.currency = currency.toUpperCase();
        if (customerEmail) updates.receipt_email = customerEmail;
        await supabaseAdmin
          .from("payment_orders")
          .update(updates)
          .eq("id", order.id)
          .neq("status", "paid");
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const subscriptionId = str(invoice, "subscription");
        const periodEnd =
          typeof invoice.period_end === "number"
            ? new Date((invoice.period_end as number) * 1000)
            : null;
        if (subscriptionId && periodEnd) {
          // Stripe nie gwarantuje kolejności zdarzeń: spóźniona faktura nie
          // może reanimować subskrypcji już anulowanej przez
          // customer.subscription.deleted.
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "active", current_period_end: periodEnd.toISOString() })
            .eq("external_ref", subscriptionId)
            .neq("status", "canceled");
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
        await supabaseAdmin
          .from("user_subscriptions")
          .update(updates)
          .eq("external_ref", subId);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const subId = str(sub, "id");
        if (subId) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "canceled", canceled_at: new Date().toISOString() })
            .eq("external_ref", subId);
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

        const { data: order } = await supabaseAdmin
          .from("payment_orders")
          .select("id, user_id, kind, entity_type, entity_id, provider_session_id")
          .eq("provider_intent_id", paymentIntent)
          .maybeSingle();
        if (!order) break;

        await supabaseAdmin
          .from("payment_orders")
          .update({ status: "refunded" })
          .eq("id", order.id);

        if (order.kind === "subscription") {
          // For subscription refunds we revoke immediately - Stripe usually
          // sends customer.subscription.deleted alongside a full refund, but
          // we must not depend on ordering.
          const sessionId = order.provider_session_id;
          if (sessionId) {
            // Session -> subscription id lives on the checkout session; the
            // stored external_ref is the sub id from grantEntitlement.
            await supabaseAdmin
              .from("user_subscriptions")
              .update({
                status: "canceled",
                canceled_at: new Date().toISOString(),
                current_period_end: new Date().toISOString(),
              })
              .eq("user_id", order.user_id)
              .eq("status", "active");
          }
        } else if (order.kind === "one_time" && order.entity_type && order.entity_id) {
          await supabaseAdmin
            .from("user_purchases")
            .update({ status: "refunded" })
            .eq("user_id", order.user_id)
            .eq("entity_type", order.entity_type)
            .eq("entity_id", order.entity_id);
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
          await supabaseAdmin.from("payment_orders").update({ status }).eq("id", orderId);
        } else if (sessionId) {
          await supabaseAdmin
            .from("payment_orders")
            .update({ status })
            .eq("provider_session_id", sessionId);
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
