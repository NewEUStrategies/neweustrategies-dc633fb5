// Efekty biznesowe zakupu przez wbudowane płatności.
// Jedno miejsce, w którym „opłacona subskrypcja” zamienia się w: dostęp do
// treści, mail transakcyjny, wpis w CRM i powiadomienie w aplikacji.
// Moduł jest server-only (klient service_role) - importuj wyłącznie z handlerów.
import { grantEntitlement } from "@/lib/billing/grant.server";
import { notifySubscriptionEmail } from "@/lib/billing/notifications.server";
import { catalogEntryByPriceId } from "@/lib/billing/paddleCatalog";

export interface PurchaseContext {
  userId: string;
  priceId: string;
  subscriptionId: string;
  periodEnd: string | null;
  environment: "sandbox" | "live";
}

interface ResolvedPlan {
  planId: string;
  tenantId: string;
  priceCents: number | null;
  currency: string | null;
}

/** Mapuje czytelny identyfikator ceny dostawcy na plan z `access_plans`. */
export async function resolvePlanForPrice(priceId: string): Promise<ResolvedPlan | null> {
  const entry = catalogEntryByPriceId(priceId);
  if (!entry) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("access_plans")
    .select("id, tenant_id, price_cents, currency")
    .eq("tier_key", entry.tierKey)
    .eq("interval", entry.interval)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`plan lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    planId: data.id,
    tenantId: data.tenant_id,
    priceCents: data.price_cents,
    currency: data.currency,
  };
}

/** Powiadomienie w aplikacji (dzwonek). Nigdy nie rzuca. */
async function pushAppNotification(params: {
  userId: string;
  tenantId: string;
  titlePl: string;
  titleEn: string;
  bodyPl?: string;
  bodyEn?: string;
  href: string;
  icon: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("notifications").insert({
      user_id: params.userId,
      tenant_id: params.tenantId,
      kind: "billing",
      title_pl: params.titlePl,
      title_en: params.titleEn,
      body_pl: params.bodyPl ?? null,
      body_en: params.bodyEn ?? null,
      href: params.href,
      icon: params.icon,
    });
  } catch (err) {
    console.error("[payments] app notification failed", err);
  }
}

/** Znacznik w CRM: kontakt stał się klientem. Nigdy nie rzuca. */
async function syncCrmCustomer(userId: string, tierKey: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, first_name, last_name, tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const email = profile?.email?.trim().toLowerCase();
    if (!email || !profile?.tenant_id) return;

    const { data: lead } = await supabaseAdmin
      .from("crm_leads")
      .select("id, tags")
      .eq("tenant_id", profile.tenant_id)
      .eq("email_norm", email)
      .maybeSingle();

    const tag = `plan:${tierKey}`;
    if (lead) {
      const tags = Array.from(new Set([...(lead.tags ?? []), "customer", tag]));
      await supabaseAdmin
        .from("crm_leads")
        .update({ stage: "won", tags, last_activity_at: new Date().toISOString() })
        .eq("id", lead.id);
    } else {
      await supabaseAdmin.from("crm_leads").insert({
        tenant_id: profile.tenant_id,
        email,
        email_norm: email,
        first_name: profile.first_name ?? null,
        last_name: profile.last_name ?? null,
        stage: "won",
        source_type: "import",
        tags: ["customer", tag],
      });
    }
  } catch (err) {
    console.error("[payments] crm sync failed", err);
  }
}

/** Nowa subskrypcja: dostęp + mail + CRM + powiadomienie. */
export async function applyPurchaseEffects(ctx: PurchaseContext): Promise<void> {
  const entry = catalogEntryByPriceId(ctx.priceId);
  const plan = await resolvePlanForPrice(ctx.priceId);
  if (!plan || !entry) {
    console.warn("[payments] no local plan for price", ctx.priceId);
    return;
  }

  await grantEntitlement(
    {
      id: ctx.subscriptionId,
      user_id: ctx.userId,
      tenant_id: plan.tenantId,
      kind: "subscription",
      plan_id: plan.planId,
      entity_type: null,
      entity_id: null,
      amount_cents: plan.priceCents,
      currency: plan.currency,
    },
    ctx.subscriptionId,
  );

  await notifySubscriptionEmail({
    kind: "subscription_confirmed",
    userId: ctx.userId,
    planId: plan.planId,
    periodEnd: ctx.periodEnd,
    amountCents: plan.priceCents,
    currency: plan.currency,
    idempotencySeed: ctx.subscriptionId,
  });

  await syncCrmCustomer(ctx.userId, entry.tierKey);

  await pushAppNotification({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    titlePl: "Subskrypcja aktywna",
    titleEn: "Subscription active",
    bodyPl: "Dostęp do treści premium został włączony.",
    bodyEn: "Access to premium content is now enabled.",
    href: "/profile/subscription",
    icon: "badge-check",
  });
}

/** Zmiana planu: aktualizacja dostępu + mail o upgrade/downgrade. */
export async function applyPlanChangeEffects(
  ctx: PurchaseContext & { previousPriceId: string | null; direction: "upgrade" | "downgrade" },
): Promise<void> {
  const plan = await resolvePlanForPrice(ctx.priceId);
  if (!plan) return;
  const previous = ctx.previousPriceId ? await resolvePlanForPrice(ctx.previousPriceId) : null;

  await grantEntitlement(
    {
      id: ctx.subscriptionId,
      user_id: ctx.userId,
      tenant_id: plan.tenantId,
      kind: "subscription",
      plan_id: plan.planId,
      entity_type: null,
      entity_id: null,
      amount_cents: plan.priceCents,
      currency: plan.currency,
    },
    ctx.subscriptionId,
  );

  await notifySubscriptionEmail({
    kind: ctx.direction === "upgrade" ? "subscription_upgraded" : "subscription_downgraded",
    userId: ctx.userId,
    planId: plan.planId,
    previousPlanId: previous?.planId ?? null,
    periodEnd: ctx.periodEnd,
    idempotencySeed: `${ctx.subscriptionId}:${ctx.priceId}`,
  });

  await pushAppNotification({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    titlePl: ctx.direction === "upgrade" ? "Plan podniesiony" : "Zmiana planu zaplanowana",
    titleEn: ctx.direction === "upgrade" ? "Plan upgraded" : "Plan change scheduled",
    bodyPl:
      ctx.direction === "upgrade"
        ? "Nowy plan działa od razu, rozliczyliśmy różnicę proporcjonalnie."
        : "Niższy plan zacznie obowiązywać po zakończeniu opłaconego okresu.",
    bodyEn:
      ctx.direction === "upgrade"
        ? "The new plan is active now; the difference was prorated."
        : "The lower plan starts once the paid period ends.",
    href: "/profile/subscription",
    icon: "arrow-up-right",
  });
}

/** Rezygnacja: dostęp do końca okresu + mail + ankieta retencyjna. */
export async function applyCancellationEffects(ctx: PurchaseContext): Promise<void> {
  const plan = await resolvePlanForPrice(ctx.priceId);
  if (!plan) return;

  await notifySubscriptionEmail({
    kind: "subscription_canceled",
    userId: ctx.userId,
    planId: plan.planId,
    periodEnd: ctx.periodEnd,
    idempotencySeed: `cancel:${ctx.subscriptionId}`,
  });

  await pushAppNotification({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    titlePl: "Subskrypcja anulowana",
    titleEn: "Subscription canceled",
    bodyPl: "Dostęp działa do końca opłaconego okresu. Powiedz nam, co możemy poprawić.",
    bodyEn: "Access remains until the paid period ends. Tell us what we can improve.",
    href: "/profile/subscription?retention=1",
    icon: "message-circle-question",
  });
}
