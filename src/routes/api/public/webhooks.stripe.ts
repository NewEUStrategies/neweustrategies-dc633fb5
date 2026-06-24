import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

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
  const expected = createHmac("sha256", secret).update(`${parsed.timestamp}.${payload}`).digest("hex");
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
        const orderId = str(session, "client_reference_id") ?? ((session.metadata as Record<string, string> | null)?.order_id ?? null);
        const sessionId = str(session, "id");
        const subscriptionId = str(session, "subscription");
        const paymentIntent = str(session, "payment_intent");
        const amountTotal = typeof session.amount_total === "number" ? (session.amount_total as number) : null;
        const currency = str(session, "currency");
        const customerEmail = str(session, "customer_email") ?? ((session.customer_details as Record<string, unknown> | null)?.email as string | null) ?? null;

        if (!orderId && !sessionId) break;

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

        const query = supabaseAdmin.from("payment_orders").update(updates);
        const { data: order, error: orderErr } = orderId
          ? await query.eq("id", orderId).select("id, user_id, tenant_id, plan_id, kind").maybeSingle()
          : await query.eq("provider_session_id", sessionId!).select("id, user_id, tenant_id, plan_id, kind").maybeSingle();
        if (orderErr) throw orderErr;


        if (order?.kind === "subscription" && order.plan_id && order.user_id && order.tenant_id) {
          // Resolve period end from plan interval (default 30d)
          const { data: plan } = await supabaseAdmin
            .from("access_plans")
            .select("interval")
            .eq("id", order.plan_id)
            .maybeSingle();
          const interval = (plan?.interval as string | undefined) ?? "month";
          const periodEnd = new Date();
          if (interval === "year") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
          else if (interval === "week") periodEnd.setDate(periodEnd.getDate() + 7);
          else if (interval === "day") periodEnd.setDate(periodEnd.getDate() + 1);
          else periodEnd.setMonth(periodEnd.getMonth() + 1);

          await supabaseAdmin.from("user_subscriptions").insert({
            user_id: order.user_id,
            tenant_id: order.tenant_id,
            plan_id: order.plan_id,
            status: "active",
            external_ref: subscriptionId ?? sessionId,
            current_period_end: periodEnd.toISOString(),
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const subscriptionId = str(invoice, "subscription");
        const periodEnd = typeof invoice.period_end === "number" ? new Date((invoice.period_end as number) * 1000) : null;
        if (subscriptionId && periodEnd) {
          await supabaseAdmin
            .from("user_subscriptions")
            .update({ status: "active", current_period_end: periodEnd.toISOString() })
            .eq("external_ref", subscriptionId);
        }
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
          await supabaseAdmin.from("payment_orders").update({ status }).eq("provider_session_id", sessionId);
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
