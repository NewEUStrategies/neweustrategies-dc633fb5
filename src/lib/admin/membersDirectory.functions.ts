// Katalog członków (panel admina, /admin/members).
//
// PRZYCZYNA ŹRÓDŁOWA. Warstwa członkostwa użytkownika rozstrzyga się z trzech
// niezależnych źródeł: nadania ręcznego (`membership_grants`), subskrypcji
// (`user_subscriptions` -> `access_plans.tier_key`) i progu domyślnego. Operator
// nie miał jednego ekranu, na którym widzi wynik tego rozstrzygnięcia razem
// z pieniędzmi (`payment_orders`), więc pytanie „jaki plan ma ta osoba i za co
// zapłaciła?" wymagało zapytania SQL.
//
// NIEZALEŻNOŚĆ OD OPERATORA. Ręczna zmiana planu zapisuje nadanie w
// `membership_grants`. Nadanie ma wyższy priorytet niż subskrypcja, więc dostęp
// działa nawet wtedy, gdy Stripe jest niedostępny albo płatność przyszła poza
// platformą (przelew, faktura, wymiana barterowa).
//
// GRANICA NAJEMCY. Klient serwisowy omija RLS, więc każde zapytanie jest jawnie
// zawężone do tenanta wywołującego admina - nigdy do tenanta wiersza docelowego.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";

export interface MemberDirectoryRow {
  userId: string;
  email: string;
  displayName: string | null;
  jobTitle: string | null;
  company: string | null;
  createdAt: string;
  /** Warstwa rozstrzygnięta z nadań, subskrypcji i progu domyślnego. */
  tierKey: string;
  tierName: string;
  tierSource: "grant" | "subscription" | "default";
  /** Nadanie ręczne, jeżeli to ono decyduje o warstwie. */
  grantId: string | null;
  grantExpiresAt: string | null;
  subscriptionStatus: string | null;
  subscriptionPeriodEnd: string | null;
  paidCents: number;
  currency: string;
  lastPaymentAt: string | null;
  paymentsCount: number;
}

export interface MemberDirectoryResult {
  rows: MemberDirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  tiers: { key: string; name: string; rank: number }[];
}

export interface MemberPaymentRow {
  id: string;
  kind: string;
  status: string;
  amountCents: number;
  currency: string;
  date: string;
  provider: string | null;
  invoiceUrl: string | null;
  environment: string | null;
}

export interface MemberGrantRow {
  id: string;
  tierKey: string;
  source: string;
  note: string | null;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface MemberBillingResult {
  payments: MemberPaymentRow[];
  grants: MemberGrantRow[];
}

const PAGE_SIZE = 25;

const ListSchema = z.object({
  search: z.string().trim().max(160).nullable().default(null),
  tierKey: z.string().trim().max(64).nullable().default(null),
  page: z.number().int().min(1).max(400).default(1),
});

const TargetSchema = z.object({ userId: z.string().uuid() });

const GrantSchema = z.object({
  userId: z.string().uuid(),
  tierKey: z.string().trim().min(1).max(64),
  /** `null` = bezterminowo. */
  months: z.number().int().min(1).max(120).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});

/** Tenant wywołującego - jedyna dopuszczalna granica danych dla klienta serwisowego. */
async function callerTenant(context: {
  supabase: { from: (t: string) => never } | unknown;
  userId: string;
}): Promise<string> {
  const ctx = context as {
    supabase: {
      from: (table: "profiles") => {
        select: (cols: string) => {
          eq: (
            col: string,
            value: string,
          ) => { maybeSingle: () => Promise<{ data: { tenant_id: string | null } | null }> };
        };
      };
    };
    userId: string;
  };
  const { data } = await ctx.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  const tenantId = data?.tenant_id ?? null;
  if (!tenantId) throw new Error("Forbidden: missing tenant");
  return tenantId;
}

function isGrantActive(
  grant: { starts_at: string; expires_at: string | null; revoked_at: string | null },
  now: number,
): boolean {
  if (grant.revoked_at) return false;
  if (new Date(grant.starts_at).getTime() > now) return false;
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= now) return false;
  return true;
}

function isSubscriptionActive(
  sub: { status: string; current_period_end: string | null },
  now: number,
): boolean {
  if (sub.status !== "active" && sub.status !== "pending") return false;
  if (!sub.current_period_end) return sub.status === "active";
  return new Date(sub.current_period_end).getTime() > now;
}

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((input: unknown) => ListSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<MemberDirectoryResult> => {
    const tenantId = await callerTenant(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = Date.now();

    const { data: tierRows } = await supabaseAdmin
      .from("membership_tiers")
      .select("key, name_pl, name_en, rank, is_default, active")
      .eq("tenant_id", tenantId);
    const tiers = (tierRows ?? []).map((t) => ({
      key: t.key,
      name: t.name_pl || t.name_en || t.key,
      rank: t.rank ?? 0,
      isDefault: t.is_default === true,
    }));
    const tierByKey = new Map(tiers.map((t) => [t.key, t]));
    const defaultTier = tiers.find((t) => t.isDefault) ?? tiers[0] ?? null;

    let query = supabaseAdmin
      .from("profiles")
      .select("id, email, display_name, job_title, current_company, created_at", {
        count: "exact",
      })
      .eq("tenant_id", tenantId);

    const search = data.search?.trim();
    if (search) {
      const safe = search.replace(/[%,()]/g, " ").trim();
      if (safe) {
        query = query.or(
          `email.ilike.%${safe}%,display_name.ilike.%${safe}%,current_company.ilike.%${safe}%`,
        );
      }
    }

    const from = (data.page - 1) * PAGE_SIZE;
    const { data: profiles, count } = await query
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    const ids = (profiles ?? []).map((p) => p.id);
    if (ids.length === 0) {
      return {
        rows: [],
        total: count ?? 0,
        page: data.page,
        pageSize: PAGE_SIZE,
        tiers: tiers.map((t) => ({ key: t.key, name: t.name, rank: t.rank })),
      };
    }

    const [grantsRes, subsRes, plansRes, ordersRes] = await Promise.all([
      supabaseAdmin
        .from("membership_grants")
        .select("id, user_id, tier_key, starts_at, expires_at, revoked_at")
        .eq("tenant_id", tenantId)
        .in("user_id", ids),
      supabaseAdmin
        .from("user_subscriptions")
        .select("user_id, plan_id, status, current_period_end, started_at")
        .eq("tenant_id", tenantId)
        .in("user_id", ids),
      supabaseAdmin.from("access_plans").select("id, tier_key").eq("tenant_id", tenantId),
      supabaseAdmin
        .from("payment_orders")
        .select("user_id, amount_cents, currency, paid_at, status")
        .eq("tenant_id", tenantId)
        .eq("status", "paid")
        .in("user_id", ids),
    ]);

    const planTier = new Map((plansRes.data ?? []).map((p) => [p.id, p.tier_key ?? ""]));

    const bestGrant = new Map<
      string,
      { id: string; tierKey: string; expiresAt: string | null; rank: number }
    >();
    for (const grant of grantsRes.data ?? []) {
      if (!isGrantActive(grant, now)) continue;
      const rank = tierByKey.get(grant.tier_key)?.rank ?? 0;
      const current = bestGrant.get(grant.user_id);
      if (!current || rank > current.rank) {
        bestGrant.set(grant.user_id, {
          id: grant.id,
          tierKey: grant.tier_key,
          expiresAt: grant.expires_at,
          rank,
        });
      }
    }

    const bestSub = new Map<
      string,
      { tierKey: string; status: string; periodEnd: string | null; rank: number }
    >();
    for (const sub of subsRes.data ?? []) {
      if (!isSubscriptionActive(sub, now)) continue;
      const tierKey = planTier.get(sub.plan_id) ?? "";
      if (!tierKey) continue;
      const rank = tierByKey.get(tierKey)?.rank ?? 0;
      const current = bestSub.get(sub.user_id);
      if (!current || rank > current.rank) {
        bestSub.set(sub.user_id, {
          tierKey,
          status: sub.status,
          periodEnd: sub.current_period_end,
          rank,
        });
      }
    }

    const money = new Map<
      string,
      { cents: number; currency: string; last: string | null; count: number }
    >();
    for (const order of ordersRes.data ?? []) {
      if (!order.user_id) continue;
      const entry = money.get(order.user_id) ?? {
        cents: 0,
        currency: order.currency ?? "PLN",
        last: null,
        count: 0,
      };
      entry.cents += order.amount_cents ?? 0;
      entry.count += 1;
      const paidAt = order.paid_at;
      if (paidAt && (!entry.last || paidAt > entry.last)) entry.last = paidAt;
      money.set(order.user_id, entry);
    }

    const rows: MemberDirectoryRow[] = (profiles ?? []).map((profile) => {
      const grant = bestGrant.get(profile.id) ?? null;
      const sub = bestSub.get(profile.id) ?? null;
      const useGrant = grant !== null && (sub === null || grant.rank >= sub.rank);
      const tierKey = useGrant ? grant.tierKey : (sub?.tierKey ?? defaultTier?.key ?? "reader");
      const paid = money.get(profile.id) ?? null;
      return {
        userId: profile.id,
        email: profile.email ?? "",
        displayName: profile.display_name,
        jobTitle: profile.job_title,
        company: profile.current_company,
        createdAt: profile.created_at,
        tierKey,
        tierName: tierByKey.get(tierKey)?.name ?? tierKey,
        tierSource: useGrant ? "grant" : sub ? "subscription" : "default",
        grantId: useGrant ? grant.id : null,
        grantExpiresAt: useGrant ? grant.expiresAt : null,
        subscriptionStatus: sub?.status ?? null,
        subscriptionPeriodEnd: sub?.periodEnd ?? null,
        paidCents: paid?.cents ?? 0,
        currency: paid?.currency ?? "PLN",
        lastPaymentAt: paid?.last ?? null,
        paymentsCount: paid?.count ?? 0,
      };
    });

    return {
      rows,
      total: count ?? rows.length,
      page: data.page,
      pageSize: PAGE_SIZE,
      tiers: tiers
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map((t) => ({ key: t.key, name: t.name, rank: t.rank })),
    };
  });

export const getMemberBilling = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .validator((input: unknown) => TargetSchema.parse(input))
  .handler(async ({ data, context }): Promise<MemberBillingResult> => {
    const tenantId = await callerTenant(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [ordersRes, grantsRes] = await Promise.all([
      supabaseAdmin
        .from("payment_orders")
        .select(
          "id, kind, status, amount_cents, currency, paid_at, created_at, provider, invoice_url, environment",
        )
        .eq("tenant_id", tenantId)
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("membership_grants")
        .select("id, tier_key, source, note, starts_at, expires_at, revoked_at, created_at")
        .eq("tenant_id", tenantId)
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    return {
      payments: (ordersRes.data ?? []).map((order) => ({
        id: order.id,
        kind: order.kind,
        status: order.status,
        amountCents: order.amount_cents ?? 0,
        currency: order.currency ?? "PLN",
        date: order.paid_at ?? order.created_at,
        provider: order.provider,
        invoiceUrl: order.invoice_url,
        environment: order.environment,
      })),
      grants: (grantsRes.data ?? []).map((grant) => ({
        id: grant.id,
        tierKey: grant.tier_key,
        source: grant.source,
        note: grant.note,
        startsAt: grant.starts_at,
        expiresAt: grant.expires_at,
        revokedAt: grant.revoked_at,
        createdAt: grant.created_at,
      })),
    };
  });

/** Ręczna zmiana planu - nadanie warstwy niezależne od operatora płatności. */
export const setMemberTier = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => GrantSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ grantId: string }> => {
    const tenantId = await callerTenant(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: target }, { data: tier }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", data.userId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabaseAdmin
        .from("membership_tiers")
        .select("key")
        .eq("tenant_id", tenantId)
        .eq("key", data.tierKey)
        .maybeSingle(),
    ]);
    if (!target) throw new Error("Forbidden: user outside tenant");
    if (!tier) throw new Error("Unknown membership tier");

    const now = new Date();
    // Jedno aktywne nadanie na osobę: wcześniejsze wygaszamy, żeby historia
    // pozostała czytelna, a rozstrzygnięcie warstwy jednoznaczne.
    await supabaseAdmin
      .from("membership_grants")
      .update({ revoked_at: now.toISOString() })
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId)
      .is("revoked_at", null);

    const expiresAt =
      data.months === null
        ? null
        : new Date(
            Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth() + data.months,
              now.getUTCDate(),
              now.getUTCHours(),
              now.getUTCMinutes(),
              now.getUTCSeconds(),
            ),
          ).toISOString();

    const { data: inserted, error } = await supabaseAdmin
      .from("membership_grants")
      .insert({
        tenant_id: tenantId,
        user_id: data.userId,
        tier_key: data.tierKey,
        source: "manual",
        note: data.note,
        granted_by: (context as { userId: string }).userId,
        starts_at: now.toISOString(),
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Grant failed");

    await supabaseAdmin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_id: (context as { userId: string }).userId,
      action: "membership.manual_grant",
      entity_type: "membership_grant",
      entity_id: inserted.id,
      metadata: { tier_key: data.tierKey, months: data.months, user_id: data.userId },
    });

    return { grantId: inserted.id };
  });

/** Cofnięcie ręcznego nadania - warstwa wraca do wyniku subskrypcji/progu domyślnego. */
export const revokeMemberTier = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => z.object({ grantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const tenantId = await callerTenant(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("membership_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", data.grantId)
      .is("revoked_at", null);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_id: (context as { userId: string }).userId,
      action: "membership.manual_revoke",
      entity_type: "membership_grant",
      entity_id: data.grantId,
      metadata: {},
    });

    return { ok: true };
  });
