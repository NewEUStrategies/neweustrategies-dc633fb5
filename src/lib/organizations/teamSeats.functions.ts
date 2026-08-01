// Panel: zarządzanie liczbą miejsc planu Zespół (rozliczanego za miejsce).
//
// Autorytet ma BAZA: `org_set_seats_limit` (SECURITY DEFINER) sprawdza, czy
// wołający jest administratorem tenanta albo właścicielem organizacji, i sama
// dopasowuje uprawnienia miejsc do limitu. Dlatego RPC wołamy klientem
// UŻYTKOWNIKA (context.supabase), nigdy serwisowym.
//
// Serwerowe są te funkcje z jednego powodu: przy organizacji spiętej z płatną
// subskrypcją trzeba NAJPIERW zmienić liczbę opłaconych miejsc u operatora
// (klucze bramki są serwerowe), a dopiero potem limit w bazie - inaczej panel
// twierdziłby, że klient ma miejsca, za które nikt nie zapłacił.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_GRACE_DAYS,
  MAX_REMINDER_DAY,
  MAX_REMINDER_SLOTS,
  MAX_TEAM_SEATS,
  MIN_GRACE_DAYS,
  MIN_REMINDER_DAY,
  MIN_TEAM_SEATS,
  normalizeReminderDays,
  type SeatsSource,
} from "@/lib/organizations/teamSeats";

const seatsSchema = z.object({
  org_id: z.string().uuid(),
  seats: z.number().int().min(MIN_TEAM_SEATS).max(MAX_TEAM_SEATS),
});

const linkSchema = z.object({
  org_id: z.string().uuid(),
  subscription_id: z
    .string()
    .trim()
    .max(120)
    .regex(/^sub_[A-Za-z0-9]+$/, "subscription_id")
    .nullable(),
});

export interface SeatsLimitResult {
  seatsLimit: number;
  active: number;
  suspended: number;
  source: SeatsSource;
  grace: number;
  /** Czy liczbę miejsc zmieniono także u operatora płatności. */
  providerSynced: boolean;
}

function readReconcile(value: unknown): {
  seatsLimit: number;
  active: number;
  grace: number;
  suspended: number;
} {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    seatsLimit: typeof row.seats_limit === "number" ? row.seats_limit : 0,
    active: typeof row.active === "number" ? row.active : 0,
    grace: typeof row.grace === "number" ? row.grace : 0,
    suspended: typeof row.suspended === "number" ? row.suspended : 0,
  };
}

/**
 * Zmiana liczby miejsc: u operatora (jeśli plan jest płatny za miejsce),
 * potem limit + zawieszenie/przywrócenie miejsc ponad limit.
 */
export const setTeamSeatLimit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => seatsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: org, error: orgError } = await supabase
      .from("member_organizations")
      .select("id, seats_limit, seats_source, paddle_subscription_id")
      .eq("id", data.org_id)
      .maybeSingle();
    if (orgError || !org) {
      return { ok: false as const, error: "orgs: not allowed" };
    }

    let providerSynced = false;
    if (org.paddle_subscription_id) {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("price_id, quantity, environment, status")
        .eq("paddle_subscription_id", org.paddle_subscription_id)
        .maybeSingle();
      if (!sub) {
        return { ok: false as const, error: "orgs: subscription not visible" };
      }
      const { updateSubscriptionQuantity } =
        await import("@/lib/billing/paddleSubscription.server");
      const res = await updateSubscriptionQuantity(
        sub.environment === "live" ? "live" : "sandbox",
        org.paddle_subscription_id,
        {
          priceExternalId: sub.price_id,
          quantity: data.seats,
          previousQuantity: sub.quantity ?? 1,
        },
      );
      if (!res.ok) {
        return { ok: false as const, error: `provider: ${res.error}`.slice(0, 160) };
      }
      providerSynced = true;
      await supabase
        .from("subscriptions")
        .update({ quantity: data.seats })
        .eq("paddle_subscription_id", org.paddle_subscription_id);
    }

    const source: SeatsSource = org.paddle_subscription_id ? "subscription" : "manual";
    const { data: result, error } = await supabase.rpc("org_set_seats_limit", {
      p_org: data.org_id,
      p_limit: data.seats,
      p_source: source,
    });
    if (error) {
      return { ok: false as const, error: error.message.slice(0, 160) };
    }

    // Karencja i powiadomienia: osoby ponad limit dostają mail z datą końca
    // dostępu, zanim faktycznie go stracą.
    const { notifySeatAccessChanges } = await import("@/lib/organizations/teamSeats.server");
    await notifySeatAccessChanges({ orgId: data.org_id, reconcile: result }).catch(() => undefined);

    const summary = readReconcile(result);
    return { ok: true as const, ...summary, source, providerSynced } satisfies {
      ok: true;
    } & SeatsLimitResult;
  });

/**
 * Spięcie organizacji z płatną subskrypcją zespołową (albo rozpięcie).
 * Po spięciu limit miejsc pochodzi z liczby opłaconych miejsc, a każde
 * zdarzenie operatora aktualizuje go automatycznie.
 */
export const linkTeamSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => linkSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) {
      return { ok: false as const, error: "orgs: not allowed" };
    }

    if (!data.subscription_id) {
      const { error } = await supabase
        .from("member_organizations")
        .update({ paddle_subscription_id: null, seats_source: "manual" })
        .eq("id", data.org_id);
      if (error) return { ok: false as const, error: error.message.slice(0, 160) };
      return { ok: true as const, linked: false, seatsLimit: null };
    }

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("quantity, price_id")
      .eq("paddle_subscription_id", data.subscription_id)
      .maybeSingle();
    if (!sub) {
      return { ok: false as const, error: "orgs: subscription not found" };
    }

    const { error } = await supabase
      .from("member_organizations")
      .update({
        paddle_subscription_id: data.subscription_id,
        seats_source: "subscription",
      })
      .eq("id", data.org_id);
    if (error) return { ok: false as const, error: error.message.slice(0, 160) };

    const { data: result, error: rpcError } = await supabase.rpc("org_set_seats_limit", {
      p_org: data.org_id,
      p_limit: Math.max(MIN_TEAM_SEATS, Math.min(MAX_TEAM_SEATS, sub.quantity ?? 1)),
      p_source: "subscription",
    });
    if (rpcError) return { ok: false as const, error: rpcError.message.slice(0, 160) };

    return { ok: true as const, linked: true, ...readReconcile(result) };
  });

/**
 * Ręczne przeliczenie miejsc względem limitu - awaryjne domknięcie, gdy dane
 * rozjechały się po imporcie albo ręcznej korekcie w bazie.
 */
export const reconcileTeamSeats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ org_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: org } = await supabase
      .from("member_organizations")
      .select("seats_limit")
      .eq("id", data.org_id)
      .maybeSingle();
    if (!org) return { ok: false as const, error: "orgs: not allowed" };

    const { data: result, error } = await supabase.rpc("org_set_seats_limit", {
      p_org: data.org_id,
      p_limit: org.seats_limit,
      p_source: undefined,
    });
    if (error) return { ok: false as const, error: error.message.slice(0, 160) };
    return { ok: true as const, ...readReconcile(result) };
  });

/**
 * Długość okresu karencji organizacji (0-90 dni). 0 = utrata dostępu od razu
 * po zmniejszeniu limitu. Zmiana od razu przelicza miejsca i wysyła
 * powiadomienia do osób, których dotyczy.
 */
export const setTeamSeatGraceDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        org_id: z.string().uuid(),
        days: z.number().int().min(MIN_GRACE_DAYS).max(MAX_GRACE_DAYS),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("org_set_seats_grace_days", {
      p_org: data.org_id,
      p_days: data.days,
    });
    if (error) return { ok: false as const, error: error.message.slice(0, 160) };

    const { notifySeatAccessChanges } = await import("@/lib/organizations/teamSeats.server");
    await notifySeatAccessChanges({ orgId: data.org_id, reconcile: result }).catch(() => undefined);

    return { ok: true as const, graceDays: data.days, ...readReconcile(result) };
  });

/**
 * Awaryjne domknięcie karencji z panelu: gasi dostęp tam, gdzie termin minął,
 * i wysyła mail końcowy. Normalnie robi to zaplecze cyklicznie.
 */
export const runSeatGraceExpiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false as const, error: "orgs: not allowed" };

    const { expireSeatGrace } = await import("@/lib/organizations/teamSeats.server");
    return { ok: true as const, ...(await expireSeatGrace()) };
  });

/**
 * Progi przypomnień w trakcie karencji dla organizacji (np. 14/7/3/1).
 * Pusta lista = brak przypomnień, zostaje tylko mail o końcu dostępu.
 * Autorytet ma baza (`org_set_seats_grace_reminder_days`), więc RPC wołamy
 * klientem użytkownika.
 */
export const setTeamSeatGraceReminderDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        org_id: z.string().uuid(),
        days: z
          .array(z.number().int().min(MIN_REMINDER_DAY).max(MAX_REMINDER_DAY))
          .max(MAX_REMINDER_SLOTS),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const days = normalizeReminderDays(data.days);
    const { error } = await context.supabase.rpc("org_set_seats_grace_reminder_days", {
      p_org: data.org_id,
      p_days: days,
    });
    if (error) return { ok: false as const, error: error.message.slice(0, 160) };
    return { ok: true as const, days };
  });

/**
 * Ręczne wysłanie przypomnień o kończącej się karencji. Bez podanych progów
 * używamy konfiguracji każdej organizacji. Normalnie robi to cykliczne
 * zaplecze - tu jako akcja awaryjna.
 */
export const runSeatGraceReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        days: z
          .array(z.number().int().min(MIN_REMINDER_DAY).max(MAX_REMINDER_DAY))
          .max(MAX_REMINDER_SLOTS)
          .optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false as const, error: "orgs: not allowed" };

    const { sendSeatGraceReminders } = await import("@/lib/organizations/teamSeats.server");
    const result = await sendSeatGraceReminders(data.days ?? null);
    return { ok: true as const, ...result };
  });
