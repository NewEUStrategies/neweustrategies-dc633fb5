// Miękka windykacja (dunning): reakcja systemu na nieudaną i odzyskaną płatność.
//
// Nieudana płatność NIE odbiera od razu dostępu - operator ponawia obciążenie,
// więc przez karencję (`PAYMENT_GRACE_DAYS` od PIERWSZEJ nieudanej próby,
// nigdy dłużej niż do końca okresu) użytkownik pracuje normalnie, a my:
//   - podbijamy licznik `payment_failure_count` przy subskrypcji (raz na próbę),
//   - zapisujemy kotwicę karencji `first_payment_failed_at` (raz na cykl),
//   - wysyłamy mail transakcyjny PL/EN z terminem kolejnej próby i datą
//     końca karencji,
//   - wrzucamy powiadomienie w aplikacji (dzwonek) z linkiem do portalu.
// Zaksięgowanie płatności zeruje licznik i kotwicę i wysyła potwierdzenie.
//
// Moduł server-only - importuj wyłącznie z handlerów webhooka.
import type { Database } from "@/integrations/supabase/types";
import {
  PAYMENT_GRACE_DAYS,
  isDelinquentSubscriptionStatus,
  paymentGraceEnd,
} from "@/lib/billing/accessPeriod";
import { notifyPaymentEmail } from "@/lib/billing/notifications.server";
import { resolvePlanForPrice } from "@/lib/billing/purchaseEffects.server";
import { PROFILE_PLAN_PATH } from "@/lib/profile/routes";

export interface DunningContext {
  subscriptionId: string;
  environment: "sandbox" | "live";
  /** Data zdarzenia od operatora. */
  occurredAt: string;
  /** Planowana kolejna próba obciążenia, jeśli operator ją podał. */
  retryAt?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  /**
   * Identyfikator transakcji (faktury), której dotyczy zdarzenie. Razem
   * z `attemptCount` tworzy klucz deduplikacji: drugie zdarzenie o TEJ SAMEJ
   * próbie (`transaction.payment_failed` i `transaction.past_due`, ponowna
   * dostawa, ponowienie z panelu) nie podbija licznika i nie wysyła drugiego
   * maila ani dzwonka.
   */
  transactionId?: string | null;
  /**
   * Numer próby obciążenia (`invoice.attempt_count`). Wszystkie ponowienia
   * jednej faktury Stripe niosą ten sam identyfikator - bez numeru próby
   * deduplikacja po samym `transactionId` zatrzymywała licznik na 1 i dawała
   * jeden mail na fakturę, bez terminu kolejnej próby (audyt SUB-16).
   */
  attemptCount?: number | null;
  /**
   * `invoice.billing_reason` - po co operator wystawił fakturę. Rozróżnia
   * odnowienie (zaległość) od dopłaty za zmianę w trakcie okresu.
   */
  billingReason?: string | null;
}

type SubscriptionUpdate = Database["public"]["Tables"]["subscriptions"]["Update"];

interface SubRow {
  user_id: string;
  tenant_id: string;
  price_id: string;
  status?: string | null;
  current_period_start?: string | null;
  current_period_end: string | null;
  payment_failure_count: number;
  last_dunning_transaction_id: string | null;
  first_payment_failed_at?: string | null;
  last_payment_at?: string | null;
}

/** Karencja w uprawnieniu i stała w treści maila to ta sama reguła (`accessPeriod.ts`). */
export { PAYMENT_GRACE_DAYS };

/**
 * Klucz deduplikacji jednej próby obciążenia: `<faktura>:<numer próby>`, a bez
 * numeru - sama faktura (zachowanie sprzed mapowania `attempt_count`).
 * `||`, nie `??`: mapowanie Stripe daje "" przy braku identyfikatora
 * (`idOf(invoice.id) ?? ""`) - pusty znaczy „brak”, a nie wspólny klucz.
 */
function dunningKey(ctx: DunningContext): string | null {
  const id = ctx.transactionId || null;
  if (!id) return null;
  const attempt = ctx.attemptCount;
  return typeof attempt === "number" && Number.isFinite(attempt) && attempt > 0
    ? `${id}:${attempt}`
    : id;
}

/**
 * Czy zdarzenie opisuje próbę już obsłużoną: ten sam klucz albo - dla tej
 * samej faktury - numer próby nie wyższy niż ostatnio obsłużony. Ponowna
 * dostawa próby 2 po próbie 3 nie może zostać policzona jako czwarta.
 */
function isHandledAttempt(lastKey: string | null, ctx: DunningContext): boolean {
  const key = dunningKey(ctx);
  if (!key || !lastKey) return false;
  if (lastKey === key) return true;
  const attempt = ctx.attemptCount;
  const sep = lastKey.lastIndexOf(":");
  if (typeof attempt !== "number" || sep < 0) return false;
  if (lastKey.slice(0, sep) !== ctx.transactionId) return false;
  const lastAttempt = Number(lastKey.slice(sep + 1));
  return Number.isFinite(lastAttempt) && attempt <= lastAttempt;
}

/**
 * Faktura dopłaty za zmianę W TRAKCIE okresu (upgrade, więcej miejsc), a nie
 * za odnowienie (`subscription_cycle`). Zmiany planu i miejsc idą
 * z `payment_behavior: pending_if_incomplete`: odrzucona dopłata zostawia
 * subskrypcję w dotychczasowym, opłaconym stanie (`pending_update` czeka na
 * zapłatę), a klient widzi odmowę od razu w interfejsie razem z fakturą do
 * opłacenia.
 */
function isMidCycleChangeInvoice(ctx: DunningContext): boolean {
  return ctx.billingReason === "subscription_update";
}

/** Faktura, której próba otworzyła cykl windykacji (klucz `<faktura>:<próba>`). */
function dunningInvoiceOf(key: string | null): string | null {
  if (!key) return null;
  const sep = key.lastIndexOf(":");
  return sep < 0 ? key : key.slice(0, sep);
}

/** Czas w ms albo `null`, gdy wartości nie da się odczytać. */
function msOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

async function loadSubscription(ctx: DunningContext): Promise<SubRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "user_id, tenant_id, price_id, status, current_period_start, current_period_end, payment_failure_count, last_dunning_transaction_id, first_payment_failed_at, last_payment_at",
    )
    .eq("provider_subscription_id", ctx.subscriptionId)
    .eq("environment", ctx.environment)
    .maybeSingle();
  // PostgREST nie rzuca, tylko zwraca `{ data: null, error }`. Bez tego
  // rozróżnienia awaria odczytu wyglądała jak „nieznana subskrypcja”: webhook
  // kończył się jako `processed`, operator nie ponawiał, a klient tracił mail
  // i licznik. Wyjątek oznacza zdarzenie jako `failed` i wraca przy ponowieniu.
  if (error) {
    throw new Error(
      `dunning: subscription lookup failed (${ctx.subscriptionId}): ${error.message}`,
    );
  }
  return (data as SubRow | null) ?? null;
}

/**
 * Zapis stanu windykacji w wierszu subskrypcji. Błąd przerywa obsługę PRZED
 * mailem i dzwonkiem: niezapisany licznik i klucz deduplikacji psują kolejne
 * zdarzenie (drugi dzwonek dla bliźniaczego `past_due`), a ponowienie webhooka
 * jest bezpieczne właśnie dlatego, że do klienta nic jeszcze nie wyszło.
 */
async function updateSubscription(ctx: DunningContext, patch: SubscriptionUpdate): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update(patch)
    .eq("provider_subscription_id", ctx.subscriptionId)
    .eq("environment", ctx.environment);
  if (error) {
    throw new Error(
      `dunning: subscription update failed (${ctx.subscriptionId}): ${error.message}`,
    );
  }
}

async function pushNotification(params: {
  userId: string;
  tenantId: string;
  titlePl: string;
  titleEn: string;
  bodyPl: string;
  bodyEn: string;
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
      body_pl: params.bodyPl,
      body_en: params.bodyEn,
      href: PROFILE_PLAN_PATH,
      icon: params.icon,
    });
  } catch (err) {
    console.error("[payments] dunning notification failed", err);
  }
}

/**
 * Atomowe zamknięcie OTWARTEGO cyklu windykacji. Zwraca `true` dokładnie raz
 * na cykl: `invoice.paid` i `invoice.payment_succeeded` opisują tę samą
 * zapłatę i bywają przetwarzane równolegle - oba czytały licznik > 0, więc
 * klient dostawał podwójne „płatność zaksięgowana" (audyt SUB-16). Warunek
 * na `last_payment_failed_at` odrzuca spóźnioną zapłatę STARSZEJ faktury,
 * która zamknęłaby cykl nowej, wciąż nieopłaconej.
 */
async function claimRecovery(ctx: DunningContext, patch: SubscriptionUpdate): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const paidAt = msOf(ctx.occurredAt);
  let query = supabaseAdmin
    .from("subscriptions")
    .update(patch)
    .eq("provider_subscription_id", ctx.subscriptionId)
    .eq("environment", ctx.environment)
    .gt("payment_failure_count", 0);
  if (paidAt !== null) {
    const stamp = new Date(paidAt).toISOString();
    query = query.or(`last_payment_failed_at.is.null,last_payment_failed_at.lte.${stamp}`);
  }
  const { data, error } = await query.select("id");
  if (error) {
    throw new Error(
      `dunning: subscription update failed (${ctx.subscriptionId}): ${error.message}`,
    );
  }
  return Array.isArray(data) && data.length > 0;
}

/** Nieudane obciążenie: licznik prób + mail + powiadomienie. */
export async function applyPaymentFailedEffects(ctx: DunningContext): Promise<void> {
  const sub = await loadSubscription(ctx);
  if (!sub) {
    console.warn("[payments] payment failed for unknown subscription", ctx.subscriptionId);
    return;
  }

  // Pierwsza płatność subskrypcji (checkout, 3DS) to nie windykacja: klient
  // nie miał jeszcze dostępu, więc mail „nie tracisz dostępu, masz karencję"
  // byłby nieprawdą - porażkę pokazuje mu sam checkout operatora.
  if (sub.status === "incomplete" || sub.status === "incomplete_expired") return;

  // Odrzucona dopłata do upgrade'u albo dodatkowych miejsc to nie zaległość:
  // subskrypcja zostaje opłacona i aktywna, dostęp nie jest zagrożony.
  // Pełna windykacja (licznik, kotwica karencji, mail „zaktualizuj metodę
  // płatności, żeby zachować dostęp" z datą końca karencji, dzwonek)
  // straszyła klienta, któremu nic nie grozi, panel admina pokazywał go
  // „w windykacji", a najbliższe zwykłe odnowienie dosyłało fałszywe
  // „płatność zaksięgowana" (audyt SUB-04/SUB-16). Odmowę klient widzi już
  // w interfejsie razem z fakturą do opłacenia. Gdy subskrypcja JEST
  // w zaległości (np. zmiana z `allow_incomplete` zepchnęła ją w `past_due`),
  // to jest realna windykacja tej subskrypcji i idzie zwykłą ścieżką.
  if (isMidCycleChangeInvoice(ctx) && !isDelinquentSubscriptionStatus(sub.status)) return;

  // Spóźniona porażka próby, po której płatność już przeszła (ponowiona
  // dostawa sprzed zaksięgowania): otwierałaby nowy cykl i wysłała wezwanie
  // klientowi, który właśnie zapłacił.
  const failedAt = msOf(ctx.occurredAt);
  const paidAt = msOf(sub.last_payment_at);
  if (failedAt !== null && paidAt !== null && failedAt < paidAt) return;

  // Deduplikacja: drugie zdarzenie o tej samej (albo wcześniejszej) próbie tej
  // samej faktury nie podbija licznika i nie generuje kolejnego maila ani
  // dzwonka. Kolejna próba (wyższy `attempt_count`) to nowy klucz - licznik
  // rośnie co próbę.
  if (isHandledAttempt(sub.last_dunning_transaction_id, ctx)) return;
  const key = dunningKey(ctx);

  // Kotwica karencji: PIERWSZA porażka cyklu. Kolejne próby jej nie
  // przesuwają - inaczej każda nieudana próba wydłużałaby darmowy dostęp.
  const firstFailedAt = sub.first_payment_failed_at ?? ctx.occurredAt;

  await updateSubscription(ctx, {
    payment_failure_count: sub.payment_failure_count + 1,
    last_payment_failed_at: ctx.occurredAt,
    last_dunning_transaction_id: key,
    last_dunning_at: ctx.occurredAt,
    ...(sub.first_payment_failed_at ? {} : { first_payment_failed_at: firstFailedAt }),
    updated_at: new Date().toISOString(),
  });

  const plan = await resolvePlanForPrice(sub.price_id, {
    tenantId: sub.tenant_id,
    userId: sub.user_id,
  });

  await notifyPaymentEmail({
    kind: "payment_failed",
    userId: sub.user_id,
    planId: plan?.planId ?? null,
    amountCents: ctx.amountCents ?? plan?.priceCents ?? null,
    currency: ctx.currency ?? plan?.currency ?? null,
    attemptedAt: ctx.occurredAt,
    retryAt: ctx.retryAt ?? null,
    // Dostęp trwa do końca KARENCJI, nie do końca okresu: przy odnowieniu
    // operator przesunął już `current_period_end` o cały (nieopłacony) cykl,
    // więc mail obiecywał dostęp, którego uprawnienie nie daje.
    accessUntil: paymentGraceEnd({
      firstPaymentFailedAt: firstFailedAt,
      periodStart: sub.current_period_start ?? null,
      periodEnd: sub.current_period_end,
    }),
    graceDays: PAYMENT_GRACE_DAYS,
    // Klucz to TOŻSAMOŚĆ nieudanej próby (faktura + numer próby), nie licznik.
    // Licznik zeruje się po odzyskaniu płatności, więc klucz z licznika wracał
    // w każdym kolejnym cyklu, a log wysyłek (bez okna czasowego) uznawał
    // pierwszą porażkę nowego cyklu za duplikat i mail nie wychodził. Numer
    // próby z faktury jest stały dla danej próby, więc jej powtórki dają jeden
    // mail, a każda kolejna próba - własny. Bez identyfikatora obciążenie
    // identyfikuje chwila zdarzenia.
    idempotencySeed: `${ctx.subscriptionId}:${key || ctx.occurredAt}`,
  });

  await pushNotification({
    userId: sub.user_id,
    tenantId: sub.tenant_id,
    titlePl: "Płatność nie powiodła się",
    titleEn: "Payment failed",
    bodyPl: "Zaktualizuj metodę płatności, żeby zachować dostęp bez przerwy.",
    bodyEn: "Update your payment method to keep uninterrupted access.",
    icon: "credit-card",
  });
}

/** Płatność zaksięgowana po nieudanej próbie: zerowanie licznika + mail. */
export async function applyPaymentRecoveredEffects(ctx: DunningContext): Promise<void> {
  const sub = await loadSubscription(ctx);
  if (!sub) return;

  const reset: SubscriptionUpdate = {
    payment_failure_count: 0,
    last_payment_failed_at: null,
    last_payment_at: ctx.occurredAt,
    // Zwolnienie klucza deduplikacji - kolejne nieudane obciążenie w nowym
    // cyklu ma znowu uruchomić pełną windykację.
    last_dunning_transaction_id: null,
    updated_at: new Date().toISOString(),
  };

  // Zwykłe odnowienie bez porażki: nie ma cyklu do zamknięcia ani czego
  // potwierdzać - odnotowujemy samą zapłatę.
  if (sub.payment_failure_count === 0) {
    await updateSubscription(ctx, reset);
    return;
  }

  // Opłacona dopłata za zmianę w trakcie okresu NIE spłaca zaległego
  // odnowienia: tamta faktura wciąż czeka. Zamknięcie cyklu kasowałoby kotwicę
  // karencji subskrypcji, która dalej jest w zaległości (kolejne `past_due`
  // zakotwiczyłoby ją od nowa, czyli wydłużyło darmowy dostęp), i wysłało
  // „płatność zaksięgowana". Cykl zamyka wyłącznie zapłata faktury, która go
  // otworzyła - albo każda zapłata odnowienia.
  if (
    isMidCycleChangeInvoice(ctx) &&
    dunningInvoiceOf(sub.last_dunning_transaction_id) !== (ctx.transactionId || null)
  ) {
    return;
  }

  // Potwierdzenie wysyłamy tylko wtedy, gdy realnie odzyskaliśmy płatność -
  // i tylko raz, nawet gdy operator zgłosi ją dwoma zdarzeniami naraz.
  // Kotwica karencji gaśnie razem z cyklem: następna porażka liczy od nowa.
  if (!(await claimRecovery(ctx, { ...reset, first_payment_failed_at: null }))) return;

  const plan = await resolvePlanForPrice(sub.price_id, {
    tenantId: sub.tenant_id,
    userId: sub.user_id,
  });

  await notifyPaymentEmail({
    kind: "payment_recovered",
    userId: sub.user_id,
    planId: plan?.planId ?? null,
    amountCents: ctx.amountCents ?? plan?.priceCents ?? null,
    currency: ctx.currency ?? plan?.currency ?? null,
    accessUntil: sub.current_period_end,
    idempotencySeed: `${ctx.subscriptionId}:${ctx.occurredAt}`,
  });

  await pushNotification({
    userId: sub.user_id,
    tenantId: sub.tenant_id,
    titlePl: "Płatność zaksięgowana",
    titleEn: "Payment received",
    bodyPl: "Subskrypcja wróciła do normalnego trybu rozliczeń.",
    bodyEn: "Your subscription is back to normal billing.",
    icon: "badge-check",
  });
}
