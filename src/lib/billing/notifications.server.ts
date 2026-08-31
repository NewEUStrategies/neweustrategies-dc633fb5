import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";
import { txCopy } from "@/lib/email-templates/tx-copy";
import { formatDate, formatMoney, sendTxEmail } from "@/lib/email/transactional.server";
import type { TxDetail } from "@/lib/email-templates/transactional";
import { PROFILE_PLAN_PATH } from "@/lib/profile/routes";

/**
 * Powiadomienia mailowe cyklu życia subskrypcji i płatnych wydarzeń.
 *
 * Wszystko jest fail-soft: mail nigdy nie może wywrócić webhooka Stripe
 * (uprawnienie do treści ma priorytet nad powiadomieniem).
 */

interface Recipient {
  email: string;
  lang: EmailLang;
  name: string | null;
}

function asLang(value: unknown): EmailLang | null {
  return value === "en" ? "en" : value === "pl" ? "pl" : null;
}

/**
 * E-mail + preferowany język odbiorcy (profil -> newsletter -> PL).
 *
 * `null` znaczy DOKŁADNIE „nie ma do kogo pisać" (brak wiersza profilu albo
 * pusty adres). Błąd odczytu jest czym innym - i musi być rozróżnialny:
 * potraktowany jak brak konta zamieniał awarię bazy w ciszę, w której mail o
 * nieudanej płatności czy o rezygnacji przepadał bez jednego śladu w logach.
 * Dlatego leci wyjątkiem; każdy wywołujący jest fail-soft (łapie i zapisuje
 * `console.error`), więc webhook operatora nadal się nie wywraca.
 */
export async function resolveRecipient(
  supabase: SupabaseClient,
  userId: string,
): Promise<Recipient | null> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("email, first_name, display_name, prefs")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`odczyt profilu odbiorcy nie powiódł się: ${error.message}`);

  const email = (profile?.email ?? "").trim();
  if (!email) return null;

  const prefs = (profile?.prefs ?? {}) as Record<string, unknown>;
  let lang = asLang(prefs.language) ?? asLang(prefs.lang);

  if (!lang) {
    const { data: sub } = await supabase
      .from("newsletter_subscribers")
      .select("language")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    lang = asLang(sub?.language);
  }

  return {
    email,
    lang: lang ?? "pl",
    name: profile?.first_name ?? profile?.display_name ?? null,
  };
}

interface PlanInfo {
  name: string;
  priceCents: number | null;
  currency: string;
  interval: string | null;
}

async function loadPlan(
  supabase: SupabaseClient,
  planId: string | null,
  lang: EmailLang,
): Promise<PlanInfo | null> {
  if (!planId) return null;
  const { data } = await supabase
    .from("access_plans")
    .select("name_pl, name_en, price_cents, currency, interval")
    .eq("id", planId)
    .maybeSingle();
  if (!data) return null;
  return {
    name: (lang === "en" ? data.name_en : data.name_pl) || data.name_pl || data.name_en || "",
    priceCents: data.price_cents ?? null,
    currency: data.currency ?? "PLN",
    interval: data.interval ?? null,
  };
}

const INTERVAL_LABEL: Record<EmailLang, Record<string, string>> = {
  pl: {
    two_weeks: "co 2 tygodnie",
    month: "miesięcznie",
    year: "rocznie",
    quarter: "kwartalnie",
    one_time: "jednorazowo",
  },
  en: {
    two_weeks: "every 2 weeks",
    month: "monthly",
    year: "yearly",
    quarter: "quarterly",
    one_time: "one-time",
  },
};

export type SubscriptionEmailKind = Extract<
  TxEmailType,
  | "subscription_confirmed"
  | "subscription_renewed"
  | "subscription_canceled"
  | "subscription_upgraded"
  | "subscription_downgraded"
  | "subscription_paused"
  | "subscription_resumed"
>;

export interface SubscriptionNotifyInput {
  kind: SubscriptionEmailKind;
  userId: string;
  planId: string | null;
  /** Poprzedni plan - tylko dla zmiany planu (upgrade/downgrade). */
  previousPlanId?: string | null;
  periodEnd?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  /** Dopłata proporcjonalna przy upgrade w trakcie okresu (w groszach/centach). */
  prorationCents?: number | null;
  /** Stabilny identyfikator zdarzenia (id zamówienia, faktury, subskrypcji). */
  idempotencySeed: string;
}

/**
 * Wysyła mail o zmianie stanu subskrypcji. Nigdy nie rzuca.
 *
 * @returns `true`, gdy wiadomość trafiła do dostawcy poczty. `false` znaczy
 *          „nie wysłano" (brak odbiorcy, odmowa dostawcy, awaria odczytu) -
 *          wywołujący z przebiegu zbiorczego MUSI to policzyć jako rekord
 *          nieobsłużony, zamiast raportować wysyłkę, której nie było.
 */
export async function notifySubscriptionEmail(input: SubscriptionNotifyInput): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const recipient = await resolveRecipient(supabase, input.userId);
    if (!recipient) return false;

    const { lang } = recipient;
    const copy = txCopy(input.kind, lang);
    const plan = await loadPlan(supabase, input.planId, lang);
    const previous = await loadPlan(supabase, input.previousPlanId ?? null, lang);

    const details: TxDetail[] = [];
    if (previous && input.kind !== "subscription_confirmed") {
      details.push({ label: copy.labels.previousPlan, value: previous.name });
      if (plan) details.push({ label: copy.labels.newPlan, value: plan.name });
    } else if (plan) {
      details.push({ label: copy.labels.plan, value: plan.name });
    }

    const amount = input.amountCents ?? plan?.priceCents ?? null;
    const currency = input.currency ?? plan?.currency ?? "PLN";
    const skipsAmount =
      input.kind === "subscription_canceled" || input.kind === "subscription_paused";
    if (amount !== null && !skipsAmount) {
      const interval = plan?.interval ? INTERVAL_LABEL[lang][plan.interval] : null;
      details.push({
        label: copy.labels.price,
        value: `${formatMoney(amount, currency, lang)}${interval ? ` / ${interval}` : ""}`,
      });
    }
    if (input.periodEnd) {
      details.push({
        label: skipsAmount ? copy.labels.endsAt : copy.labels.renewsAt,
        value: formatDate(input.periodEnd, lang),
      });
    }

    const intervalLabel = plan?.interval ? INTERVAL_LABEL[lang][plan.interval] : null;

    const result = await sendTxEmail({
      type: input.kind,
      to: recipient.email,
      lang,
      metaName: recipient.name,
      subjectName: plan?.name ?? null,
      details,
      bodyVars: {
        planName: plan?.name ?? null,
        previousPlanName: previous?.name ?? null,
        amount: amount !== null ? formatMoney(amount, currency, lang) : null,
        interval: intervalLabel,
        renewsAt:
          input.kind === "subscription_canceled" || !input.periodEnd
            ? null
            : formatDate(input.periodEnd, lang),
        accessUntil:
          (input.kind === "subscription_canceled" || input.kind === "subscription_downgraded") &&
          input.periodEnd
            ? formatDate(input.periodEnd, lang)
            : null,
        prorationAmount:
          input.kind === "subscription_upgraded" && input.prorationCents
            ? formatMoney(input.prorationCents, currency, lang)
            : null,
      },
      ctaPath: input.kind === "subscription_canceled" ? "/cennik" : PROFILE_PLAN_PATH,
      idempotencyKey: `${input.kind}:${input.idempotencySeed}`,
    });
    return result.ok;
  } catch (err) {
    console.error("[billing-emails] subscription notify failed", input.kind, err);
    return false;
  }
}

export interface EventNotifyInput {
  userId: string;
  eventId: string;
  amountCents?: number | null;
  currency?: string | null;
  /** Identyfikator transakcji u operatora - tylko dla biletów płatnych. */
  transactionId?: string | null;
  /** Ziarno numeru biletu (id zamówienia lub wiersza RSVP). */
  ticketSeed?: string | null;
  idempotencySeed: string;
}

/**
 * Potwierdzenie zapisu na wydarzenie (płatne i bezpłatne). Nigdy nie rzuca.
 *
 * @returns `true`, gdy wiadomość trafiła do dostawcy poczty. `false` znaczy
 *          „nie wysłano" (brak odbiorcy, odmowa dostawcy, awaria odczytu) -
 *          wywołujący z przebiegu zbiorczego MUSI to policzyć jako rekord
 *          nieobsłużony, zamiast raportować wysyłkę, której nie było.
 */
export async function notifyEventRegistration(input: EventNotifyInput): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const recipient = await resolveRecipient(supabase, input.userId);
    if (!recipient) return false;
    const { lang } = recipient;

    const { data: event } = await supabase
      .from("events")
      .select("slug, title_pl, title_en, starts_at, location, timezone")
      .eq("id", input.eventId)
      .maybeSingle();
    if (!event) return false;

    const copy = txCopy("event_registered", lang);
    const title = (lang === "en" ? event.title_en : event.title_pl) || event.title_pl || "";
    const details: TxDetail[] = [{ label: copy.labels.event, value: title }];
    if (event.starts_at) {
      details.push({ label: copy.labels.date, value: formatDate(event.starts_at, lang, true) });
    }
    if (event.location) details.push({ label: copy.labels.place, value: event.location });
    if (input.amountCents) {
      details.push({
        label: copy.labels.price,
        value: formatMoney(input.amountCents, input.currency ?? "PLN", lang),
      });
    }
    // Numer biletu i numer transakcji - to po nich obsługa wydarzenia
    // identyfikuje zakup, więc trafiają do maila zawsze, gdy są znane.
    const { ticketCodeFrom } = await import("@/lib/events/ticketCode");
    if (input.ticketSeed) {
      details.push({ label: copy.labels.ticketCode, value: ticketCodeFrom(input.ticketSeed) });
    }
    if (input.transactionId) {
      details.push({ label: copy.labels.transaction, value: input.transactionId });
    }

    const result = await sendTxEmail({
      type: "event_registered",
      to: recipient.email,
      lang,
      metaName: recipient.name,
      subjectName: title,
      details,
      ctaPath: event.slug ? `/events/${event.slug}?ticket=1` : "/events",
      idempotencyKey: `event_registered:${input.idempotencySeed}`,
    });
    return result.ok;
  } catch (err) {
    console.error("[billing-emails] event notify failed", err);
    return false;
  }
}

export type PaymentEmailKind = Extract<TxEmailType, "payment_failed" | "payment_recovered">;

export interface PaymentNotifyInput {
  kind: PaymentEmailKind;
  userId: string;
  planId: string | null;
  amountCents?: number | null;
  currency?: string | null;
  /** Data nieudanej próby obciążenia (tylko payment_failed). */
  attemptedAt?: string | null;
  /** Planowana kolejna próba (tylko payment_failed). */
  retryAt?: string | null;
  /** Koniec opłaconego okresu - do kiedy dostęp pozostaje aktywny. */
  accessUntil?: string | null;
  /** Długość karencji w dniach (miękka windykacja). */
  graceDays?: number | null;
  idempotencySeed: string;
}

/**
 * Mail o nieudanej / odzyskanej płatności (miękka windykacja). Nigdy nie rzuca.
 *
 * @returns `true`, gdy wiadomość trafiła do dostawcy poczty. `false` znaczy
 *          „nie wysłano" (brak odbiorcy, odmowa dostawcy, awaria odczytu) -
 *          wywołujący z przebiegu zbiorczego MUSI to policzyć jako rekord
 *          nieobsłużony, zamiast raportować wysyłkę, której nie było.
 */
export async function notifyPaymentEmail(input: PaymentNotifyInput): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const recipient = await resolveRecipient(supabase, input.userId);
    if (!recipient) return false;

    const { lang } = recipient;
    const copy = txCopy(input.kind, lang);
    const plan = await loadPlan(supabase, input.planId, lang);

    const details: TxDetail[] = [];
    if (plan) details.push({ label: copy.labels.plan, value: plan.name });

    const amount = input.amountCents ?? plan?.priceCents ?? null;
    if (amount !== null) {
      details.push({
        label: copy.labels.price,
        value: formatMoney(amount, input.currency ?? plan?.currency ?? "PLN", lang),
      });
    }
    if (input.kind === "payment_failed") {
      if (input.attemptedAt) {
        details.push({
          label: copy.labels.attemptedAt,
          value: formatDate(input.attemptedAt, lang),
        });
      }
      if (input.retryAt) {
        details.push({ label: copy.labels.retryAt, value: formatDate(input.retryAt, lang) });
      }
      if (input.accessUntil) {
        details.push({
          label: copy.labels.accessUntil,
          value: formatDate(input.accessUntil, lang),
        });
      }
    } else if (input.accessUntil) {
      details.push({ label: copy.labels.renewsAt, value: formatDate(input.accessUntil, lang) });
    }

    const result = await sendTxEmail({
      type: input.kind,
      to: recipient.email,
      lang,
      metaName: recipient.name,
      subjectName: plan?.name ?? null,
      details,
      bodyVars: {
        planName: plan?.name ?? null,
        amount:
          amount !== null
            ? formatMoney(amount, input.currency ?? plan?.currency ?? "PLN", lang)
            : null,
        interval: plan?.interval ? INTERVAL_LABEL[lang][plan.interval] : null,
        retryAt: input.retryAt ? formatDate(input.retryAt, lang) : null,
        accessUntil: input.accessUntil ? formatDate(input.accessUntil, lang) : null,
        graceDays: input.graceDays ?? null,
      },
      ctaPath: PROFILE_PLAN_PATH,
      idempotencyKey: `${input.kind}:${input.idempotencySeed}`,
    });
    return result.ok;
  } catch (err) {
    console.error("[billing-emails] payment notify failed", input.kind, err);
    return false;
  }
}

export interface RefundNotifyInput {
  userId: string;
  planId: string | null;
  amountCents?: number | null;
  currency?: string | null;
  /** Identyfikator transakcji u operatora - trafia do szczegółów maila. */
  transactionId?: string | null;
  /** Data zakończenia dostępu odebranego wraz ze zwrotem. */
  accessUntil?: string | null;
  idempotencySeed: string;
}

/**
 * Mail o zwrocie płatności (zwrot / obciążenie zwrotne). Nigdy nie rzuca.
 *
 * @returns `true`, gdy wiadomość trafiła do dostawcy poczty. `false` znaczy
 *          „nie wysłano" (brak odbiorcy, odmowa dostawcy, awaria odczytu) -
 *          wywołujący z przebiegu zbiorczego MUSI to policzyć jako rekord
 *          nieobsłużony, zamiast raportować wysyłkę, której nie było.
 */
export async function notifyRefundEmail(input: RefundNotifyInput): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const recipient = await resolveRecipient(supabase, input.userId);
    if (!recipient) return false;

    const { lang } = recipient;
    const copy = txCopy("payment_refunded", lang);
    const plan = await loadPlan(supabase, input.planId, lang);

    const details: TxDetail[] = [];
    if (plan) details.push({ label: copy.labels.plan, value: plan.name });

    const currency = input.currency ?? plan?.currency ?? "PLN";
    const amount = input.amountCents ?? null;
    if (amount !== null) {
      details.push({ label: copy.labels.price, value: formatMoney(amount, currency, lang) });
    }
    if (input.transactionId) {
      details.push({ label: copy.labels.transaction, value: input.transactionId });
    }
    if (input.accessUntil) {
      details.push({ label: copy.labels.accessUntil, value: formatDate(input.accessUntil, lang) });
    }

    const result = await sendTxEmail({
      type: "payment_refunded",
      to: recipient.email,
      lang,
      metaName: recipient.name,
      subjectName: plan?.name ?? null,
      details,
      bodyVars: {
        planName: plan?.name ?? null,
        amount: amount !== null ? formatMoney(amount, currency, lang) : null,
        accessUntil: input.accessUntil ? formatDate(input.accessUntil, lang) : null,
      },
      ctaPath: PROFILE_PLAN_PATH,
      idempotencyKey: `payment_refunded:${input.idempotencySeed}`,
    });
    return result.ok;
  } catch (err) {
    console.error("[billing-emails] refund notify failed", err);
    return false;
  }
}

export type ReminderEmailKind = Extract<
  TxEmailType,
  "subscription_renewal_reminder" | "subscription_expiring"
>;

export interface ReminderNotifyInput {
  kind: ReminderEmailKind;
  userId: string;
  planId: string | null;
  /** Data odnowienia (renewal) albo końca dostępu (expiring). */
  periodEnd: string;
  idempotencySeed: string;
}

/**
 * Przypomnienie o zbliżającym się odnowieniu / wygaśnięciu. Nigdy nie rzuca.
 *
 * @returns `true`, gdy wiadomość trafiła do dostawcy poczty. `false` znaczy
 *          „nie wysłano" (brak odbiorcy, odmowa dostawcy, awaria odczytu) -
 *          wywołujący z przebiegu zbiorczego MUSI to policzyć jako rekord
 *          nieobsłużony, zamiast raportować wysyłkę, której nie było.
 */
export async function notifyReminderEmail(input: ReminderNotifyInput): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const recipient = await resolveRecipient(supabase, input.userId);
    if (!recipient) return false;

    const { lang } = recipient;
    const copy = txCopy(input.kind, lang);
    const plan = await loadPlan(supabase, input.planId, lang);

    const details: TxDetail[] = [];
    if (plan) {
      details.push({ label: copy.labels.plan, value: plan.name });
      if (plan.priceCents !== null && input.kind === "subscription_renewal_reminder") {
        details.push({
          label: copy.labels.price,
          value: formatMoney(plan.priceCents, plan.currency, lang),
        });
      }
    }
    details.push({
      label:
        input.kind === "subscription_renewal_reminder" ? copy.labels.renewsAt : copy.labels.endsAt,
      value: formatDate(input.periodEnd, lang),
    });

    const result = await sendTxEmail({
      type: input.kind,
      to: recipient.email,
      lang,
      metaName: recipient.name,
      subjectName: plan?.name ?? null,
      details,
      bodyVars: {
        planName: plan?.name ?? null,
        amount: plan?.priceCents != null ? formatMoney(plan.priceCents, plan.currency, lang) : null,
        interval: plan?.interval ? INTERVAL_LABEL[lang][plan.interval] : null,
      },

      ctaPath: PROFILE_PLAN_PATH,
      idempotencyKey: `${input.kind}:${input.idempotencySeed}`,
    });
    return result.ok;
  } catch (err) {
    console.error("[billing-emails] reminder notify failed", input.kind, err);
    return false;
  }
}
