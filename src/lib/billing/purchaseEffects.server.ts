// Efekty biznesowe zakupu przez wbudowane płatności.
// Jedno miejsce, w którym „opłacona subskrypcja” zamienia się w: dostęp do
// treści, mail transakcyjny, wpis w CRM i powiadomienie w aplikacji.
// Moduł jest server-only (klient service_role) - importuj wyłącznie z handlerów.
import {
  syncEntitlementState,
  type ProviderSubscriptionStatus,
} from "@/lib/billing/entitlementSync.server";
import { notifySubscriptionEmail } from "@/lib/billing/notifications.server";
import { catalogEntryByPriceId, type PlanBillingInterval } from "@/lib/billing/catalog";
import { buildPremiumNewsletterRow, canAutoSubscribe } from "@/lib/billing/premiumNewsletter";
import { PROFILE_PLAN_PATH } from "@/lib/profile/routes";

export interface PurchaseContext {
  userId: string;
  priceId: string;
  subscriptionId: string;
  periodEnd: string | null;
  environment: "sandbox" | "live";
  /** Status subskrypcji u operatora; domyślnie `active`. */
  status?: ProviderSubscriptionStatus;
  /**
   * Najemca z wiersza `subscriptions`, gdy wołający go zna - oszczędza odczyt
   * profilu przy odwzorowaniu ceny na plan (`PlanScope`).
   */
  tenantId?: string | null;
}

interface ResolvedPlan {
  planId: string;
  tenantId: string;
  priceCents: number | null;
  currency: string | null;
  /**
   * Próg i cykl z wpisu katalogu, po którym plan został znaleziony. Plan
   * istnieje tylko dla ceny katalogowej, więc wołający nie musi drugi raz
   * pytać katalogu (i obsługiwać „braku wpisu", który tu nie zachodzi).
   */
  tierKey: string;
  interval: PlanBillingInterval;
}

/**
 * Zakres najemcy dla odwzorowania ceny na plan. `tenantId` wygrywa (wiersz
 * subskrypcji / zamówienia już go niesie); bez niego najemca idzie z profilu
 * `userId`. Oba puste = najemca nieznany, czyli brak planu.
 */
export interface PlanScope {
  tenantId?: string | null;
  userId?: string | null;
}

async function scopeTenant(scope: PlanScope): Promise<string | null> {
  if (scope.tenantId) return scope.tenantId;
  if (!scope.userId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", scope.userId)
    .maybeSingle();
  if (error) throw new Error(`plan scope lookup failed: ${error.message}`);
  return data?.tenant_id ?? null;
}

/**
 * Mapuje czytelny identyfikator ceny dostawcy na plan z `access_plans`
 * NAJEMCY, którego dotyczy zdarzenie.
 *
 * DLACZEGO ZAKRES JEST WYMAGANY. Katalog cen jest jeden na konto operatora
 * (`plus_monthly` znaczy to samo w każdym obszarze roboczym), a plany są per
 * najemca. Zapytanie po samym `tier_key` + `interval` z `.limit(1)` i bez
 * `ORDER BY` oddawało PIERWSZY LEPSZY aktywny plan całego wdrożenia: przy
 * dwóch najemcach z planem „Plus" uprawnienie, mail i dzwonek mogły dostać
 * `plan_id`/`tenant_id` obcej organizacji - i to różnej przy kolejnych
 * zdarzeniach tej samej subskrypcji (audyt wyd. 11/12: „odwzorowanie ceny
 * operatora na plan nie jest zawężone do najemcy ani deterministyczne").
 *
 * KOLEJNOŚĆ JAWNA (`sort_order`, potem `created_at`, potem `id`): dwa aktywne
 * plany tego samego progu w jednym najemcy to stan dopuszczalny (np. wariant
 * dla innej grupy odbiorców), więc wybór musi być powtarzalny.
 */
export async function resolvePlanForPrice(
  priceId: string,
  scope: PlanScope,
): Promise<ResolvedPlan | null> {
  const entry = catalogEntryByPriceId(priceId);
  if (!entry) return null;
  const tenantId = await scopeTenant(scope);
  if (!tenantId) {
    console.warn("[payments] plan lookup without tenant scope - skipped", { priceId });
    return null;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("access_plans")
    .select("id, tenant_id, price_cents, currency")
    .eq("tenant_id", tenantId)
    .eq("tier_key", entry.tierKey)
    .eq("interval", entry.interval)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`plan lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    planId: data.id,
    tenantId: data.tenant_id,
    priceCents: data.price_cents,
    currency: data.currency,
    tierKey: entry.tierKey,
    interval: entry.interval,
  };
}

/**
 * Powiadomienie w aplikacji (dzwonek). Nigdy nie rzuca.
 *
 * FAIL-SOFT A `{ error }`. supabase-js nie rzuca na błąd bazy ani sieci, tylko
 * zwraca go w wyniku - dlatego tu i w pozostałych skutkach pobocznych błąd
 * jest jawnie przerzucany do `catch`. Bez tego `catch` widziałby wyłącznie
 * wyjątki klienta, a odrzucony zapis znikałby bez śladu w logu.
 */
async function pushAppNotification(params: {
  userId: string;
  tenantId: string;
  titlePl: string;
  titleEn: string;
  bodyPl: string;
  bodyEn: string;
  href: string;
  icon: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: params.userId,
      tenant_id: params.tenantId,
      kind: "billing",
      title_pl: params.titlePl,
      title_en: params.titleEn,
      body_pl: params.bodyPl,
      body_en: params.bodyEn,
      href: params.href,
      icon: params.icon,
    });
    if (error) throw new Error(`notification insert failed: ${error.message}`);
  } catch (err) {
    console.error("[payments] app notification failed", err);
  }
}

/** Stan komercyjny kontaktu wynikający ze stanu subskrypcji u operatora. */
export type CrmSubscriptionState = "customer" | "paused" | "churned";

const CRM_STAGE_BY_STATE: Record<CrmSubscriptionState, "won" | "archived"> = {
  customer: "won",
  paused: "won",
  churned: "archived",
};

/**
 * Znacznik w CRM wynikający ze stanu subskrypcji. Nigdy nie rzuca.
 *
 * Anulowanie i pauza muszą być widoczne w CRM tak samo jak zakup - inaczej
 * lejek pokazuje „won” dla kontaktu, który już nie płaci.
 */
export async function syncCrmSubscriptionState(
  userId: string,
  tierKey: string,
  state: CrmSubscriptionState = "customer",
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, first_name, last_name, tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw new Error(`crm profile read failed: ${profileError.message}`);
    const email = profile?.email?.trim().toLowerCase();
    if (!email || !profile?.tenant_id) return;

    const { data: lead, error: leadError } = await supabaseAdmin
      .from("crm_leads")
      .select("id, tags")
      .eq("tenant_id", profile.tenant_id)
      .eq("email_norm", email)
      .maybeSingle();
    // Nieudany odczyt to NIE „brak leada" - gałąź `insert` założyłaby wtedy
    // drugi kontakt dla tej samej osoby.
    if (leadError) throw new Error(`crm lead lookup failed: ${leadError.message}`);

    const tag = `plan:${tierKey}`;
    const stateTags: Record<CrmSubscriptionState, string[]> = {
      customer: ["customer", tag],
      paused: ["customer", tag, "subscription:paused"],
      churned: [tag, "churned"],
    };
    const dropTags: Record<CrmSubscriptionState, string[]> = {
      customer: ["subscription:paused", "churned"],
      paused: ["churned"],
      churned: ["customer", "subscription:paused"],
    };

    if (lead) {
      const tags = Array.from(
        new Set([...lead.tags.filter((t) => !dropTags[state].includes(t)), ...stateTags[state]]),
      );
      const { error } = await supabaseAdmin
        .from("crm_leads")
        .update({
          stage: CRM_STAGE_BY_STATE[state],
          tags,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", lead.id);
      if (error) throw new Error(`crm lead update failed: ${error.message}`);
    } else {
      const { error } = await supabaseAdmin.from("crm_leads").insert({
        tenant_id: profile.tenant_id,
        email,
        email_norm: email,
        first_name: profile.first_name ?? null,
        last_name: profile.last_name ?? null,
        stage: CRM_STAGE_BY_STATE[state],
        // ZBIÓR DOZWOLONYCH WARTOŚCI PILNUJE BAZA (crm_leads_source_type_check).
        // Było tu "import", którego CHECK nie zna - INSERT dostawał 23514
        // w `{ error }`, którego nikt nie czytał, więc klient PŁACĄCY BEZ
        // WCZEŚNIEJSZEGO LEADA nie trafiał do CRM, a log milczał. Kontrakt
        // wartości pilnuje test `lib/crm/__tests__/leadSourceTypeContract.test.ts`,
        // a każdy inny odrzucony zapis trafia teraz przez `throw` do `catch`
        // niżej (log, bez rzutu).
        source_type: "paid_subscriber",
        tags: stateTags[state],
      });
      if (error) throw new Error(`crm lead insert failed: ${error.message}`);
    }
  } catch (err) {
    console.error("[payments] crm sync failed", err);
  }
}

/** Zgodność wstecz: zakup = kontakt w stanie „customer”. */
const syncCrmCustomer = (userId: string, tierKey: string) =>
  syncCrmSubscriptionState(userId, tierKey, "customer");

/**
 * Zapis płacącego klienta na newsletter premium. Nigdy nie rzuca.
 *
 * Świadome wypisanie się jest nadrzędne - automat nie reaktywuje takiej osoby.
 */
async function subscribePremiumNewsletter(params: {
  userId: string;
  tenantId: string;
  tierKey: string;
  subscriptionId: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", params.userId)
      .maybeSingle();
    if (profileError) throw new Error(`newsletter profile read failed: ${profileError.message}`);
    const email = profile?.email?.trim().toLowerCase();
    if (!email) return;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("newsletter_subscribers")
      .select("id, status, unsubscribed_at, language")
      .eq("tenant_id", params.tenantId)
      .eq("email", email)
      .maybeSingle();
    // Nieudany odczyt to NIE „brak zapisu" - `canAutoSubscribe(null)` przepuszcza,
    // a upsert po (tenant_id, email) nadpisałby świadome wypisanie.
    if (existingError) {
      throw new Error(`newsletter consent lookup failed: ${existingError.message}`);
    }

    if (!canAutoSubscribe(existing)) return;

    const row = buildPremiumNewsletterRow({
      tenantId: params.tenantId,
      userId: params.userId,
      email,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      language: existing?.language ?? null,
      tierKey: params.tierKey,
      subscriptionId: params.subscriptionId,
    });

    const { error } = await supabaseAdmin
      .from("newsletter_subscribers")
      .upsert(row, { onConflict: "tenant_id,email" });
    if (error) throw new Error(`newsletter upsert failed: ${error.message}`);
  } catch (err) {
    console.error("[payments] premium newsletter opt-in failed", err);
  }
}

/** Nowa subskrypcja: dostęp + mail + CRM + newsletter + powiadomienie. */
export async function applyPurchaseEffects(ctx: PurchaseContext): Promise<void> {
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) {
    console.warn("[payments] no local plan for price", ctx.priceId);
    return;
  }

  await syncEntitlementState({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: ctx.subscriptionId,
    status: ctx.status ?? "active",
    periodEnd: ctx.periodEnd,
  });

  await notifySubscriptionEmail({
    kind: "subscription_confirmed",
    userId: ctx.userId,
    planId: plan.planId,
    periodEnd: ctx.periodEnd,
    amountCents: plan.priceCents,
    currency: plan.currency,
    idempotencySeed: ctx.subscriptionId,
  });

  await syncCrmCustomer(ctx.userId, plan.tierKey);

  await subscribePremiumNewsletter({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    tierKey: plan.tierKey,
    subscriptionId: ctx.subscriptionId,
  });

  await pushAppNotification({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    titlePl: "Subskrypcja aktywna",
    titleEn: "Subscription active",
    bodyPl: "Dostęp do treści premium został włączony.",
    bodyEn: "Access to premium content is now enabled.",
    href: PROFILE_PLAN_PATH,
    icon: "badge-check",
  });
}

/**
 * Nominalna długość cyklu w dniach - mianownik proraty. Operator dzieli przez
 * RZECZYWISTĄ długość okresu (miesiąc ma 28-31 dni), więc kwota w mailu może
 * odbiec od faktury o kilka procent dopłaty - a nie o jej wielokrotność, jak
 * przy stałych 30 dniach dla planu rocznego. Cena jednorazowa nie ma cyklu.
 */
const CYCLE_DAYS: Record<PlanBillingInterval, number | null> = {
  two_weeks: 14,
  month: 30,
  quarter: 91,
  year: 365,
  one_time: null,
};

/**
 * Proporcjonalna dopłata za pozostałe dni bieżącego okresu (upgrade).
 * Zwraca `null`, gdy danych nie da się wiarygodnie policzyć - lepiej pominąć
 * zdanie o proracie niż podać kwotę niezgodną z fakturą operatora.
 */
function proratedDifferenceCents(
  previous: ResolvedPlan,
  next: ResolvedPlan,
  periodEnd: string | null,
): number | null {
  // Zmiana cyklu (miesiąc -> rok) zaczyna u operatora NOWY okres: faktura to
  // pełna nowa cena minus niewykorzystana część starej, a `periodEnd` jest już
  // końcem nowego okresu. Z różnicy cen i tej daty kwoty nie odtworzymy.
  if (previous.interval !== next.interval) return null;
  const cycleDays = CYCLE_DAYS[next.interval];
  if (!cycleDays || !periodEnd || previous.priceCents == null || next.priceCents == null) {
    return null;
  }
  const diff = next.priceCents - previous.priceCents;
  if (diff <= 0) return null;
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(end)) return null;
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
  if (daysLeft <= 0) return null;
  const share = Math.min(1, daysLeft / cycleDays);
  return Math.round(diff * share);
}

/** Zmiana planu: aktualizacja dostępu + mail o upgrade/downgrade. */
export async function applyPlanChangeEffects(
  ctx: PurchaseContext & { previousPriceId: string | null; direction: "upgrade" | "downgrade" },
): Promise<void> {
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) return;
  const previous = ctx.previousPriceId
    ? await resolvePlanForPrice(ctx.previousPriceId, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
      })
    : null;

  await syncEntitlementState({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: ctx.subscriptionId,
    status: ctx.status ?? "active",
    periodEnd: ctx.periodEnd,
  });

  // Upgrade rozlicza się od razu: różnica cen za pozostałą część okresu to
  // realna kwota dopłaty, którą pokazujemy w mailu (bez niej klient widzi samą
  // nową cenę i zgłasza reklamację o "podwójne obciążenie").
  const prorationCents =
    ctx.direction === "upgrade" && previous
      ? proratedDifferenceCents(previous, plan, ctx.periodEnd)
      : null;

  await notifySubscriptionEmail({
    kind: ctx.direction === "upgrade" ? "subscription_upgraded" : "subscription_downgraded",
    userId: ctx.userId,
    planId: plan.planId,
    previousPlanId: previous?.planId ?? null,
    periodEnd: ctx.periodEnd,
    amountCents: plan.priceCents,
    currency: plan.currency,
    prorationCents,
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
    href: PROFILE_PLAN_PATH,
    icon: "arrow-up-right",
  });
}

/** Rezygnacja: dostęp do końca okresu + mail + ankieta retencyjna. */
export async function applyCancellationEffects(ctx: PurchaseContext): Promise<void> {
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) return;

  // Dostęp gaśnie z końcem opłaconego okresu - uprawnienie musi to odzwierciedlać.
  await syncEntitlementState({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: ctx.subscriptionId,
    status: "canceled",
    periodEnd: ctx.periodEnd,
  });

  await notifySubscriptionEmail({
    kind: "subscription_canceled",
    userId: ctx.userId,
    planId: plan.planId,
    periodEnd: ctx.periodEnd,
    idempotencySeed: `cancel:${ctx.subscriptionId}`,
  });

  // CRM: kontakt przestaje być aktywnym klientem (lejek nie może pokazywać „won”).
  await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "churned");

  await pushAppNotification({
    userId: ctx.userId,
    tenantId: plan.tenantId,
    titlePl: "Subskrypcja anulowana",
    titleEn: "Subscription canceled",
    bodyPl: "Dostęp działa do końca opłaconego okresu. Powiedz nam, co możemy poprawić.",
    bodyEn: "Access remains until the paid period ends. Tell us what we can improve.",
    href: `${PROFILE_PLAN_PATH}?retention=1`,
    icon: "message-circle-question",
  });
}

/** Stan subskrypcji zgłoszony przez operatora w zdarzeniu `subscription.updated`. */
export interface StatusTransitionContext {
  userId: string;
  /** Najemca z wiersza `subscriptions` - patrz `PurchaseContext.tenantId`. */
  tenantId?: string | null;
  priceId: string;
  subscriptionId: string;
  periodEnd: string | null;
  previousStatus: string | null;
  status: string;
}

/**
 * Zmiana samego stanu subskrypcji (pauza, wznowienie, zaległość, powrót do
 * rozliczeń). Uprawnienie synchronizuje webhook; tutaj domykamy warstwy
 * widoczne dla człowieka: CRM i powiadomienie w aplikacji.
 */
export async function applyStatusTransitionEffects(ctx: StatusTransitionContext): Promise<void> {
  if (ctx.previousStatus === ctx.status) return;
  const plan = await resolvePlanForPrice(ctx.priceId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  if (!plan) return;

  if (ctx.status === "paused") {
    await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "paused");
    await pushAppNotification({
      userId: ctx.userId,
      tenantId: plan.tenantId,
      titlePl: "Subskrypcja wstrzymana",
      titleEn: "Subscription paused",
      bodyPl: "Dostęp do treści premium jest nieaktywny do czasu wznowienia.",
      bodyEn: "Premium access is inactive until you resume the subscription.",
      href: PROFILE_PLAN_PATH,
      icon: "pause-circle",
    });
    await notifySubscriptionEmail({
      kind: "subscription_paused",
      userId: ctx.userId,
      planId: plan.planId,
      periodEnd: ctx.periodEnd,
      amountCents: plan.priceCents,
      currency: plan.currency,
      idempotencySeed: `${ctx.subscriptionId}:paused:${ctx.periodEnd ?? ""}`,
    });
    return;
  }

  if (ctx.status === "active" || ctx.status === "trialing") {
    await syncCrmSubscriptionState(ctx.userId, plan.tierKey, "customer");
    if (ctx.previousStatus === "paused" || ctx.previousStatus === "past_due") {
      await pushAppNotification({
        userId: ctx.userId,
        tenantId: plan.tenantId,
        titlePl: "Subskrypcja wznowiona",
        titleEn: "Subscription resumed",
        bodyPl: "Dostęp do treści premium znów działa.",
        bodyEn: "Premium access is active again.",
        href: PROFILE_PLAN_PATH,
        icon: "badge-check",
      });
      await notifySubscriptionEmail({
        kind: "subscription_resumed",
        userId: ctx.userId,
        planId: plan.planId,
        periodEnd: ctx.periodEnd,
        amountCents: plan.priceCents,
        currency: plan.currency,
        idempotencySeed: `${ctx.subscriptionId}:resumed:${ctx.periodEnd ?? ""}`,
      });
    }
  }
}
