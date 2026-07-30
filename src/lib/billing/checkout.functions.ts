import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { periodEndFor } from "@/lib/billing/entitlement";
import {
  checkoutSessionExtraParams,
  normalizeCheckoutSettings,
} from "@/lib/billing/checkoutSettings";
import { mockCheckoutAllowed } from "@/lib/billing/mockMode.server";

// Zamówienie płatnicze (server-side, RLS jako użytkownik).
// Kwota jest zawsze wyliczana serwerowo (plan / reguła dostępu / bilet /
// kupon / waluta prezentacji) i osadzana w transakcji u dostawcy, więc klient
// nie może jej podmienić. Bez konfiguracji dostawcy zwracamy adres mock, żeby
// dało się przetestować lejek w dev; na produkcji tryb mock jest fail-closed
// (mockCheckoutAllowed) - błędna konfiguracja nie rozdaje płatnego dostępu.

const createOrderSchema = z.object({
  kind: z.enum(["subscription", "one_time"]),
  plan_id: z.string().uuid().nullable().optional(),
  entity_type: z.enum(["post", "page"]).nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  success_path: z.string().min(1),
  cancel_path: z.string().min(1),
  // Kupon B2B: kod aplikowany przy zamówieniu. Rabat wyliczamy WYŁĄCZNIE
  // serwerowo (validate_b2b_coupon → atomowe redeem_b2b_coupon), więc klient
  // nigdy nie może obniżyć unit_amount ręcznie.
  coupon_code: z.string().trim().max(64).optional(),
  // Waluta prezentacji/rozliczenia. Dla EN pobieramy EUR (parytet 1 EUR = 2 PLN,
  // spójne z cennikiem i /support). Konwersja liczona jest serwerowo, więc
  // klient nie może zmienić kwoty - jedynie wybrać docelową walutę z listy.
  display_currency: z.enum(["PLN", "EUR"]).optional(),
  // Bilet na płatne wydarzenie - webhook po zapłacie potwierdza RSVP.
  event_id: z.string().uuid().nullable().optional(),
  // Środowisko bramki wyprowadzone po stronie klienta z prefiksu tokenu.
  environment: z.enum(["sandbox", "live"]).optional(),
});


export const createCheckoutOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Resolve amount/currency from plan or entity
    let amountCents = 0;
    let currency = "PLN";
    let label = "";
    let trialDays = 0;

    // Zakup jednorazowy PLANU: kind=one_time z plan_id i bez encji. Cena
    // pochodzi z planu, płatność jest jednorazowa, a uprawnienie dożywotnie
    // (patrz entitlementForOrder).
    const isOneTimePlan = data.kind === "one_time" && !!data.plan_id && !data.entity_id;
    // Bilet na płatne wydarzenie: kind=one_time z event_id i bez planu/encji.
    const isEventTicket = data.kind === "one_time" && !!data.event_id && !data.plan_id && !data.entity_id;

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
      trialDays = data.kind === "subscription" ? Math.max(0, Number(plan.trial_days ?? 0)) : 0;
    } else if (isEventTicket) {
      // Cena biletu pochodzi z wiersza wydarzenia (RLS jako użytkownik), więc
      // klient przekazuje wyłącznie identyfikator wydarzenia.
      const { data: ev, error: evErr } = await supabase
        .from("events")
        .select("id, title_pl, title_en, ticket_price_cents, ticket_currency, status, starts_at")
        .eq("id", data.event_id ?? "")
        .maybeSingle();
      if (evErr) throw evErr;
      if (!ev || !ev.ticket_price_cents || ev.ticket_price_cents <= 0) {
        throw new Error("ticket_not_available");
      }
      if (ev.status !== "published") throw new Error("ticket_not_available");
      if (ev.starts_at && new Date(ev.starts_at).getTime() < Date.now()) {
        throw new Error("event_finished");
      }
      // Limit miejsc egzekwujemy serwerowo tuż przed utworzeniem zamówienia -
      // przycisk w UI jest tylko podpowiedzią, autorytetem jest backend.
      const { assertSeatAvailable } = await import("@/lib/events/ticket.server");
      await assertSeatAvailable(supabase, String(ev.id), userId);
      amountCents = Number(ev.ticket_price_cents);
      currency = String(ev.ticket_currency ?? "PLN");
      label = String(ev.title_pl || ev.title_en || "");
    } else {
      if (!data.entity_type || !data.entity_id) throw new Error("entity_required");
      // Price is taken from the per-entity access rule server-side, so the
      // client can never tamper with the amount it is charged.
      const { data: rule, error: ruleErr } = await supabase
        .from("content_access_public")
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

    // Zapamiętujemy oryginalną kwotę do audytu użycia kuponu (redemption row).
    // `let`, bo przy walucie prezentacji (EN → EUR) przeliczamy ją parytetowo
    // razem z kwotą finalną, żeby audyt kuponu był spójny walutowo (patrz niżej).
    let originalCents = amountCents;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    let couponDiscountCents = 0;
    if (data.coupon_code && data.coupon_code.trim().length > 0) {
      const normalizedCode = data.coupon_code.trim().toUpperCase();
      const { data: rows, error: validateErr } = await supabase.rpc("validate_b2b_coupon", {
        _code: normalizedCode,
        _plan_id: data.plan_id ?? "00000000-0000-0000-0000-000000000000",
        _amount_cents: amountCents,
        _currency: currency,
      });
      if (validateErr) throw validateErr;
      const row = (rows ?? [])[0];
      if (!row || !row.ok) {
        return {
          ok: false as const,
          mode: "coupon" as const,
          error: (row?.error ?? "not_found") as string,
        };
      }
      couponId = row.coupon_id;
      couponCode = normalizedCode;
      couponDiscountCents = row.discount_cents;
      amountCents = row.final_cents;
      // Bezpiecznik: rabat 100% (final=0) traktujemy jak darmowy przydział -
      // i tak nie przejdzie minimalnej kwoty transakcji, więc odrzucamy < 50 gr.
      if (amountCents < 50) {
        return {
          ok: false as const,
          mode: "coupon" as const,
          error: "final_amount_too_low" as const,
        };
      }
    }

    // Konwersja waluty prezentacji (EN → EUR) PO wyliczeniu kuponu, żeby
    // walidacja kuponu B2B odbyła się w oryginalnej walucie planu (kupony
    // są zdefiniowane per waluta). Koszyk u dostawcy widzi już walutę
    // wybraną przez klienta.
    //
    // WAŻNE (spójność walutowa audytu kuponu): kwoty zapisywane w redemption
    // Konwertujemy po AKTUALNYM kursie NBP (tabela A) - `ensureFxRateLoaded()`
    // odświeża cache w tle, zanim `couponAuditInDisplayCurrency` zejdzie
    // do sync `getEurPlnRate()`. Oryginał i finał konwertujemy razem, a RABAT
    // wyprowadzamy z ich RÓŻNICY, dzięki czemu niezmiennik
    // `original = final + discount` trzyma się dokładnie w walucie docelowej
    // (bez dryfu zaokrągleń między osobno konwertowanymi wartościami).
    if (data.display_currency) {
      const [{ couponAuditInDisplayCurrency }, { ensureFxRateLoaded }] = await Promise.all([
        import("@/lib/billing/displayCurrency"),
        import("@/lib/billing/fxRate"),
      ]);
      await ensureFxRateLoaded();
      const conv = couponAuditInDisplayCurrency(
        originalCents,
        amountCents,
        currency,
        data.display_currency,
      );
      originalCents = conv.originalCents;
      amountCents = conv.finalCents;
      couponDiscountCents = conv.discountCents;
      currency = conv.currency;
    }

    // Fail-closed ZANIM powstanie zamówienie: produkcja bez działającej
    // konfiguracji dostawcy płatności odmawia checkoutu, zamiast po cichu
    // wpaść w tryb mock i rozdać dostęp za darmo.
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    const paymentsReady = paymentsConfiguredServer();
    if (!paymentsReady && !mockCheckoutAllowed()) {
      console.error("[checkout] billing unconfigured: refusing mock checkout in production");
      return {
        ok: false as const,
        mode: "unconfigured" as const,
        error: "billing_unconfigured" as const,
      };
    }

    const receiptEmail = context.claims.email ?? null;

    // Bilet na płatne wydarzenie: rozpoznawany po metadanych zamówienia -
    // webhook po zaksięgowaniu potwierdza RSVP i wysyła mail rejestracyjny.
    const eventId = data.event_id ?? null;

    // Insert pending order (z metadanymi kuponu - webhook potem policzy revenue netto).
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
        provider: paymentsReady ? "paddle" : "mock",
        receipt_email: receiptEmail,
        metadata: {
          label,
          ...(eventId ? { event_id: eventId } : {}),
          ...(couponCode
            ? {
                coupon_code: couponCode,
                coupon_id: couponId,
                coupon_discount_cents: couponDiscountCents,
                original_amount_cents: originalCents,
              }
            : {}),
        },
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    // Atomowe rezerwowanie użycia kuponu - RPC sam sprawdza limity pod
    // blokadą wiersza, więc nawet równoległe zamówienia nie przekroczą maxa.
    if (couponId) {
      const { data: redeemed, error: redeemErr } = await supabase.rpc("redeem_b2b_coupon", {
        _coupon_id: couponId,
        _order_id: order.id,
        _applied_cents: couponDiscountCents,
        _original_cents: originalCents,
        _currency: currency,
      });
      if (redeemErr || !redeemed) {
        // Ktoś przejął ostatnie użycie zanim doszliśmy tutaj - unieważniamy zamówienie.
        await supabase.from("payment_orders").update({ status: "canceled" }).eq("id", order.id);
        return {
          ok: false as const,
          mode: "coupon" as const,
          error: "limit_reached" as const,
        };
      }
    }

    if (paymentsReady) {
      // Kwota jest wyliczona serwerowo (plan / reguła dostępu / kupon /
      // waluta prezentacji), więc zamiast ceny katalogowej tworzymy
      // transakcję z ceną osadzoną i zwracamy jej identyfikator do nakładki.
      const { createAdhocTransaction, resolveEnvironment } = await import(
        "@/lib/billing/paddleTransaction.server"
      );
      const created = await createAdhocTransaction({
        environment: resolveEnvironment(data.environment),
        product: eventId ? "eventTicket" : "contentUnlock",
        name: label || "Zamówienie",
        amountCents,
        currency,
        customerEmail: receiptEmail,
        customData: {
          kind: "order",
          order_id: order.id,
          user_id: userId,
          ...(eventId ? { event_id: eventId } : {}),
        },
      });
      if (!created.ok) {
        await supabase.from("payment_orders").update({ status: "failed" }).eq("id", order.id);
        // Kupon został zarezerwowany PRZED utworzeniem transakcji. Skoro
        // dostawca odmówił, użycie musi wrócić do puli - inaczej limit
        // przepadłby za zamówienie, którego nikt nigdy nie opłaci.
        if (couponId) {
          const { error: releaseErr } = await supabase.rpc("release_b2b_coupon", {
            _coupon_id: couponId,
            _order_id: order.id,
          });
          if (releaseErr) {
            console.error("[checkout] coupon release failed", order.id, releaseErr.message);
          }
        }
        return {
          ok: false as const,
          mode: "paddle" as const,
          error: created.error,
          orderId: order.id,
        };
      }

      await supabase
        .from("payment_orders")
        .update({ provider_session_id: created.transactionId, status: "processing" })
        .eq("id", order.id);
      return {
        ok: true as const,
        mode: "paddle" as const,
        transactionId: created.transactionId,
        orderId: order.id,
      };
    }

    // Tryb mock - brak dostawcy. Zwracamy adres sukcesu, żeby dało się
    // przetestować lejek w dev.
    return {
      ok: true as const,
      mode: "mock" as const,
      url: `${data.success_path}?order=${order.id}&mock=1`,
      orderId: order.id,
    };
  });


// Finalizacja zamówienia w trybie mock (brak skonfigurowanego dostawcy).
// Oznacza własne zamówienie jako opłacone i nadaje uprawnienie tą samą ścieżką
// co webhook. Gdy dostawca jest skonfigurowany, funkcja jest świadomym no-opem -
// źródłem prawdy jest webhook - więc nie da się nią ominąć realnej płatności.
export const finalizeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    if (paymentsConfiguredServer()) {
      return { ok: false as const, reason: "provider_mode" as const };
    }
    // Ten sam bezpiecznik co przy tworzeniu zamówienia: produkcja bez dostawcy
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
    // Efekty kuponu B2B po zaksięgowaniu płatności (ta gałąź już ustawiła
    // status='paid' powyżej) - ta sama ścieżka co w webhooku dostawcy, żeby kupon
    // z `grants_tier_key` działał identycznie w obu trybach.
    const { applyCouponEffectsForOrder } = await import("@/lib/billing/couponEffects.server");
    await applyCouponEffectsForOrder(order.id);
    return { ok: true as const };
  });

const cancelSubscriptionSchema = z.object({ subscriptionId: z.string().uuid() });

// Cancel-at-period-end for the caller's own subscription. user_subscriptions
// grants no UPDATE to authenticated (a client UPDATE could self-grant access),
// so this runs service-role with an explicit ownership check. We set
// canceled_at and keep status 'active': has_content_access already ends access
// at current_period_end, so paid time is preserved and the UI shows "cancels at".
//
// Przy realnym dostawcy subskrypcja jest anulowana NAJPIERW u operatora
// (effective_from=next_billing_period). Kolejność ma znaczenie: jeśli operator
// odmówi, wiersza NIE wolno oznaczyć jako anulowany - inaczej UI mówi
// "anulowano", a klient jest dalej obciążany. Webhook subscription.updated /
// subscription.canceled pozostaje źródłem prawdy przy zmianach po stronie
// operatora.
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cancelSubscriptionSchema.parse(input))
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

    const {
      cancelSubscriptionAtPeriodEnd,
      isProviderSubscriptionRef,
      subscriptionEnvironment,
    } = await import("@/lib/billing/paddleSubscription.server");
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    if (paymentsConfiguredServer() && isProviderSubscriptionRef(sub.external_ref)) {
      const result = await cancelSubscriptionAtPeriodEnd(
        subscriptionEnvironment(),
        sub.external_ref,
      );
      if (!result.ok) {
        console.error("[billing] provider cancel failed", sub.external_ref, result.error);
        throw new Error("provider_cancel_failed");
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

const changePlanSchema = z.object({
  subscriptionId: z.string().uuid(),
  newPlanId: z.string().uuid(),
});

// Samoobsługowy upgrade/downgrade planu. Kolejność jak przy cancel/resume:
// najpierw operator, potem baza. Reguła biznesowa: upgrade rozlicza się od
// razu z proratą, downgrade wchodzi dopiero od nowego okresu. Nieudana dopłata
// NIE zmienia planu (on_payment_failure=prevent_change). Zmiana planu czyści
// zaplanowane anulowanie - klient zostaje. Cena i waluta pochodzą z katalogu
// dostawcy (stały cennik per plan), więc nic nie przeliczamy tutaj.
export const changeSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => changePlanSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error: loadError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, tenant_id, plan_id, status, external_ref, canceled_at, current_period_end")
      .eq("id", data.subscriptionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!sub) throw new Error("subscription_not_found");
    if (sub.status !== "active") throw new Error("subscription_not_active");
    if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) {
      // Okres opłacony wygasł - zmiana planu wymaga nowego checkoutu.
      throw new Error("subscription_period_ended");
    }
    if (sub.plan_id === data.newPlanId) throw new Error("same_plan");

    const { data: newPlan, error: planErr } = await supabaseAdmin
      .from("access_plans")
      .select("id, tenant_id, active, price_cents, currency, interval, tier_key, name_pl, name_en")
      .eq("id", data.newPlanId)
      .maybeSingle();
    if (planErr) throw new Error(planErr.message);
    if (!newPlan || !newPlan.active) throw new Error("plan_not_found");
    if (newPlan.tenant_id !== sub.tenant_id) throw new Error("plan_not_found");
    const interval = String(newPlan.interval);
    if (interval !== "month" && interval !== "quarter" && interval !== "year") {
      // Przepustki/plany jednorazowe nie są celem zmiany subskrypcji.
      throw new Error("plan_not_recurring");
    }

    const {
      changeSubscriptionPrice,
      catalogPriceFor,
      fetchSubscriptionSnapshot,
      isProviderSubscriptionRef,
      subscriptionEnvironment,
    } = await import("@/lib/billing/paddleSubscription.server");
    const { planChangeDirection } = await import("@/lib/billing/paddleCatalog");
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");

    const providerConfigured = paymentsConfiguredServer();
    let providerPeriodEnd: string | null = null;

    if (providerConfigured && isProviderSubscriptionRef(sub.external_ref)) {
      const env = subscriptionEnvironment();
      const snap = await fetchSubscriptionSnapshot(env, sub.external_ref);
      if (!snap.ok) {
        console.error("[billing] subscription snapshot failed", sub.external_ref, snap.error);
        throw new Error("provider_plan_change_failed");
      }

      const targetPriceId = catalogPriceFor(newPlan.tier_key, interval);
      if (!targetPriceId) throw new Error("plan_not_switchable");
      const direction = planChangeDirection(snap.snapshot.priceId, targetPriceId);
      if (direction === "same") throw new Error("same_plan");

      const changeRes = await changeSubscriptionPrice(env, sub.external_ref, {
        newPriceExternalId: targetPriceId,
        quantity: snap.snapshot.quantity,
        direction,
      });
      if (!changeRes.ok) {
        console.error("[billing] provider plan change failed", sub.external_ref, changeRes.error);
        throw new Error("provider_plan_change_failed");
      }
      providerPeriodEnd = changeRes.currentPeriodEnd ?? snap.snapshot.currentPeriodEnd;
    } else if (providerConfigured) {
      // Subskrypcja bez identyfikatora u dostawcy (np. dożywotnia z zakupu
      // jednorazowego) nie ma czego przełączać po stronie operatora.
      throw new Error("subscription_not_switchable");
    } else if (!mockCheckoutAllowed()) {
      console.error("[checkout] billing unconfigured: refusing mock plan change in production");
      throw new Error("billing_unconfigured");
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("user_subscriptions")
      .update({
        plan_id: newPlan.id,
        canceled_at: null,
        // Operator jest źródłem prawdy o kotwicy okresu; mock liczy od teraz.
        current_period_end:
          providerPeriodEnd ??
          (providerConfigured
            ? (sub.current_period_end ?? undefined)
            : periodEndFor(interval, new Date()).toISOString()),
      })
      .eq("id", sub.id)
      .select("id")
      .maybeSingle();
    if (updateErr) throw new Error(updateErr.message);
    if (!updated) throw new Error("subscription_not_found");
    return { ok: true as const };
  });

// Wznowienie subskrypcji anulowanej "na koniec okresu": dopóki opłacony okres
// trwa, operator pozwala cofnąć zaplanowaną zmianę. Lustrzane do
// cancelSubscription - najpierw operator, potem baza, żeby UI nigdy nie
// pokazywał wznowienia, którego operator nie wykonał.
export const resumeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => cancelSubscriptionSchema.parse(input))
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

    const {
      resumeScheduledCancellation,
      isProviderSubscriptionRef,
      subscriptionEnvironment,
    } = await import("@/lib/billing/paddleSubscription.server");
    const { paymentsConfiguredServer } = await import("@/lib/billing/mockMode.server");
    if (paymentsConfiguredServer() && isProviderSubscriptionRef(sub.external_ref)) {
      const result = await resumeScheduledCancellation(
        subscriptionEnvironment(),
        sub.external_ref,
      );
      if (!result.ok) {
        console.error("[billing] provider resume failed", sub.external_ref, result.error);
        throw new Error("provider_resume_failed");
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
