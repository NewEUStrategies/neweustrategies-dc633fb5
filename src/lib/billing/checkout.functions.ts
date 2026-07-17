import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeRecurringInterval, type StripeRecurringInterval } from "@/lib/billing/entitlement";
import { mockCheckoutAllowed } from "@/lib/billing/mockMode.server";

// Create a payment order (server-side, RLS as user).
// Stripe wiring is intentionally pluggable: if STRIPE_SECRET_KEY is set we create a Checkout Session,
// otherwise we return a mock URL so the UX can be tested end-to-end. Mock mode
// is fail-closed on production (mockCheckoutAllowed) - a misconfigured env can
// no longer hand out paid entitlements for free.

const createOrderSchema = z.object({
  kind: z.enum(["subscription", "one_time"]),
  plan_id: z.string().uuid().nullable().optional(),
  entity_type: z.enum(["post", "page"]).nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  success_path: z.string().min(1),
  cancel_path: z.string().min(1),
});

export const createCheckoutOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve amount/currency from plan or entity
    let amountCents = 0;
    let currency = "PLN";
    let label = "";
    // Billing cadence for a subscription Checkout Session. Resolved from the
    // plan below (default monthly) so a yearly/weekly plan is billed on its real
    // interval rather than always monthly.
    let recurringInterval: StripeRecurringInterval = "month";
    let trialDays = 0;

    // One-time PLAN purchase: kind=one_time with a plan_id and no entity. The
    // price comes from the plan; the Stripe session is a one-off payment (no
    // recurring), and the grant is lifetime plan access (see entitlementForOrder).
    const isOneTimePlan = data.kind === "one_time" && !!data.plan_id && !data.entity_id;

    if (data.kind === "subscription" || isOneTimePlan) {
      if (!data.plan_id) throw new Error("plan_id_required");
      const { data: plan, error } = await supabase
        .from("access_plans")
        .select("price_cents, currency, name_pl, name_en, active, interval, trial_days")
        .eq("id", data.plan_id)
        .maybeSingle();
      if (error) throw error;
      if (!plan || !plan.active) throw new Error("plan_not_found");
      amountCents = Number(plan.price_cents);
      currency = String(plan.currency);
      label = String(plan.name_pl || plan.name_en);
      recurringInterval = stripeRecurringInterval(String(plan.interval));
      trialDays = data.kind === "subscription" ? Math.max(0, Number(plan.trial_days ?? 0)) : 0;
    } else {
      if (!data.entity_type || !data.entity_id) throw new Error("entity_required");
      // Price is taken from the per-entity access rule server-side, so the
      // client can never tamper with the amount it is charged.
      const { data: rule, error: ruleErr } = await supabase
        .from("content_access")
        .select("mode, one_time_price_cents, one_time_currency")
        .eq("entity_type", data.entity_type)
        .eq("entity_id", data.entity_id)
        .maybeSingle();
      if (ruleErr) throw ruleErr;
      if (
        !rule ||
        rule.mode !== "paid" ||
        !rule.one_time_price_cents ||
        rule.one_time_price_cents <= 0
      ) {
        throw new Error("one_time_not_available");
      }
      amountCents = Number(rule.one_time_price_cents);
      currency = String(rule.one_time_currency ?? "PLN");
      const table = data.entity_type === "post" ? "posts" : "pages";
      const { data: row } = await supabase
        .from(table)
        .select("title_pl, title_en")
        .eq("id", data.entity_id)
        .maybeSingle();
      label = String(row?.title_pl || row?.title_en || "");
    }

    if (amountCents <= 0) throw new Error("zero_amount");

    // Fail-closed ZANIM powstanie zamówienie: produkcja bez działającej
    // konfiguracji Stripe (brak klucza LUB brak origin do success_url) odmawia
    // checkoutu zamiast po cichu wpaść w tryb mock i rozdać dostęp za darmo.
    const stripeConfigured =
      !!process.env.STRIPE_SECRET_KEY &&
      !!(process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.URL);
    if (!stripeConfigured && !mockCheckoutAllowed()) {
      console.error("[checkout] billing unconfigured: refusing mock checkout in production");
      return {
        ok: false as const,
        mode: "unconfigured" as const,
        error: "billing_unconfigured" as const,
      };
    }

    // Receipt e-mail comes from the verified auth claims - profiles.email is
    // no longer SELECT-able by the authenticated role (column grant excludes
    // PII) and the JWT e-mail is the authoritative address anyway.
    const receiptEmail = context.claims.email ?? null;

    // Insert pending order
    const { data: order, error: insertError } = await supabase
      .from("payment_orders")
      .insert({
        user_id: userId,
        kind: data.kind,
        status: "pending",
        amount_cents: amountCents,
        currency,
        plan_id: data.plan_id ?? null,
        entity_type: data.entity_type ?? null,
        entity_id: data.entity_id ?? null,
        provider: "stripe",
        receipt_email: receiptEmail,
        metadata: { label },
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    // Stripe Checkout Session (best-effort - only if secret configured)
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const origin = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.URL ?? "";

    if (stripeSecret && origin) {
      try {
        const params = new URLSearchParams();
        params.set("mode", data.kind === "subscription" ? "subscription" : "payment");
        params.set("success_url", `${origin}${data.success_path}?order=${order.id}`);
        params.set("cancel_url", `${origin}${data.cancel_path}?order=${order.id}`);
        params.set("client_reference_id", order.id);
        if (receiptEmail) params.set("customer_email", receiptEmail);
        params.set("line_items[0][price_data][currency]", currency.toLowerCase());
        params.set("line_items[0][price_data][unit_amount]", String(amountCents));
        params.set("line_items[0][price_data][product_data][name]", label || "Order");
        if (data.kind === "subscription") {
          params.set("line_items[0][price_data][recurring][interval]", recurringInterval);
          if (trialDays > 0) {
            // Stripe caps trial_period_days at 730; we clamp defensively so a
            // misconfigured plan can't blow up the whole checkout call.
            params.set("subscription_data[trial_period_days]", String(Math.min(trialDays, 730)));
          }
        }

        params.set("line_items[0][quantity]", "1");
        params.set("metadata[order_id]", order.id);

        const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeSecret}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        });
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`stripe_error: ${resp.status} ${txt.slice(0, 200)}`);
        }
        const session = (await resp.json()) as { id: string; url: string };
        await supabase
          .from("payment_orders")
          .update({ provider_session_id: session.id, status: "processing" })
          .eq("id", order.id);
        return { ok: true as const, mode: "stripe" as const, url: session.url, orderId: order.id };
      } catch (e) {
        // Log server-side; surface generic error to client
        console.error("[checkout] stripe session failed", e);
        return {
          ok: false as const,
          mode: "stripe" as const,
          error: "stripe_failed",
          orderId: order.id,
        };
      }
    }

    // Mock mode - no Stripe configured. Return success URL directly so devs can test the flow.
    return {
      ok: true as const,
      mode: "mock" as const,
      url: `${data.success_path}?order=${order.id}&mock=1`,
      orderId: order.id,
    };
  });

// Finalise a mock-mode order (no Stripe configured). Marks the caller's own
// pending order paid and grants the entitlement via the same shared path the
// webhook uses. When STRIPE_SECRET_KEY is set this is a deliberate no-op - the
// webhook is authoritative - so it can never bypass real payments in production.
export const finalizeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (process.env.STRIPE_SECRET_KEY) {
      return { ok: false as const, reason: "stripe_mode" as const };
    }
    // Ten sam bezpiecznik co przy tworzeniu zamówienia: produkcja bez Stripe
    // nie może finalizować zamówień mock (rozdanie uprawnień bez płatności).
    if (!mockCheckoutAllowed()) {
      console.error("[checkout] billing unconfigured: refusing mock finalize in production");
      return { ok: false as const, reason: "mock_disabled" as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { grantEntitlement } = await import("@/lib/billing/grant.server");

    // Idempotent + ownership-scoped: only a not-yet-paid order owned by the
    // caller is finalised; a replay updates zero rows and grants nothing again.
    const { data: order, error } = await supabaseAdmin
      .from("payment_orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .neq("status", "paid")
      .select(
        "id, user_id, tenant_id, plan_id, kind, entity_type, entity_id, amount_cents, currency",
      )
      .maybeSingle();
    if (error) throw error;
    if (!order) return { ok: true as const, alreadyFinalized: true as const };

    await grantEntitlement(order, order.id);
    return { ok: true as const };
  });

const cancelSubscriptionSchema = z.object({ subscriptionId: z.string().uuid() });

// Cancel-at-period-end for the caller's own subscription. user_subscriptions
// grants no UPDATE to authenticated (a client UPDATE could self-grant access),
// so this runs service-role with an explicit ownership check. We set
// canceled_at and keep status 'active': has_content_access already ends access
// at current_period_end, so paid time is preserved and the UI shows "cancels at".
//
// In live Stripe mode the Stripe subscription is canceled FIRST
// (cancel_at_period_end=true). Order matters: if Stripe refuses, we must NOT
// mark the row canceled - the previous DB-only implementation told the user
// "canceled" while Stripe kept charging them every period. The webhook
// (customer.subscription.updated/deleted) remains the reconciliation source of
// truth for changes made on the Stripe side.
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => cancelSubscriptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error: loadError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, external_ref, canceled_at")
      .eq("id", data.subscriptionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sub) throw new Error("subscription_not_found");
    if (sub.canceled_at) return { ok: true as const, alreadyCanceled: true as const };

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (stripeSecret && sub.external_ref && sub.external_ref.startsWith("sub_")) {
      const { cancelStripeSubscriptionAtPeriodEnd } = await import("@/lib/billing/stripe.server");
      const result = await cancelStripeSubscriptionAtPeriodEnd(sub.external_ref, stripeSecret);
      if (!result.ok) {
        console.error("[billing] stripe cancel failed", sub.external_ref, result.error);
        throw new Error("stripe_cancel_failed");
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from("user_subscriptions")
      .update({ canceled_at: new Date().toISOString() })
      .eq("id", sub.id)
      .is("canceled_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) return { ok: true as const, alreadyCanceled: true as const };
    return { ok: true as const, alreadyCanceled: false as const };
  });

// Wznowienie subskrypcji anulowanej "na koniec okresu": dopóki opłacony okres
// trwa, Stripe pozwala cofnąć cancel_at_period_end. Lustrzane do
// cancelSubscription - najpierw Stripe, potem DB, żeby UI nigdy nie pokazywał
// wznowienia, którego Stripe nie wykonał.
export const resumeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => cancelSubscriptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error: loadError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, external_ref, canceled_at, status, current_period_end")
      .eq("id", data.subscriptionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sub || sub.canceled_at === null || sub.status !== "active") {
      throw new Error("subscription_not_resumable");
    }
    if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) {
      // Okres wygasł - odnowienia nie ma czego reaktywować; potrzebny nowy checkout.
      throw new Error("subscription_period_ended");
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (stripeSecret && sub.external_ref && sub.external_ref.startsWith("sub_")) {
      const { resumeStripeSubscriptionAtPeriodEnd } = await import("@/lib/billing/stripe.server");
      const result = await resumeStripeSubscriptionAtPeriodEnd(sub.external_ref, stripeSecret);
      if (!result.ok) {
        console.error("[billing] stripe resume failed", sub.external_ref, result.error);
        throw new Error("stripe_resume_failed");
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from("user_subscriptions")
      .update({ canceled_at: null })
      .eq("id", sub.id)
      .not("canceled_at", "is", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("subscription_not_resumable");
    return { ok: true as const };
  });
