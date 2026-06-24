import { supabase } from "@/integrations/supabase/client";
import type {
  AccessPlan,
  BillingProfile,
  BillingProfileInput,
  PaymentOrder,
  UserSubscriptionRow,
} from "./types";

const PLAN_COLUMNS =
  "id, tenant_id, name_pl, name_en, description_pl, description_en, price_cents, currency, interval, active, sort_order, features_pl, features_en, badge_pl, badge_en, highlighted, trial_days";

function castFeatures(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((x): x is string => typeof x === "string");
}

function rowToPlan(row: Record<string, unknown>): AccessPlan {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    name_pl: String(row.name_pl ?? ""),
    name_en: String(row.name_en ?? ""),
    description_pl: (row.description_pl as string | null) ?? null,
    description_en: (row.description_en as string | null) ?? null,
    price_cents: Number(row.price_cents ?? 0),
    currency: String(row.currency ?? "PLN"),
    interval: (row.interval as AccessPlan["interval"]) ?? "month",
    active: Boolean(row.active),
    sort_order: Number(row.sort_order ?? 0),
    features_pl: castFeatures(row.features_pl),
    features_en: castFeatures(row.features_en),
    badge_pl: (row.badge_pl as string | null) ?? null,
    badge_en: (row.badge_en as string | null) ?? null,
    highlighted: Boolean(row.highlighted),
    trial_days: Number(row.trial_days ?? 0),
  };
}

export async function fetchActivePlans(): Promise<AccessPlan[]> {
  const { data, error } = await supabase
    .from("access_plans")
    .select(PLAN_COLUMNS)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToPlan(r as Record<string, unknown>));
}

export async function fetchPlanById(planId: string): Promise<AccessPlan | null> {
  const { data, error } = await supabase
    .from("access_plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPlan(data as Record<string, unknown>) : null;
}

export async function fetchMyBillingProfile(): Promise<BillingProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("billing_profiles")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return (data as BillingProfile | null) ?? null;
}

export async function upsertMyBillingProfile(input: BillingProfileInput): Promise<BillingProfile> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("not_authenticated");
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", uid)
    .maybeSingle();
  const tenantId = profile?.tenant_id;
  if (!tenantId) throw new Error("no_tenant");

  const { data, error } = await supabase
    .from("billing_profiles")
    .upsert(
      { ...input, user_id: uid, tenant_id: tenantId },
      { onConflict: "user_id,tenant_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as BillingProfile;
}

export async function fetchMyOrders(): Promise<PaymentOrder[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as PaymentOrder[];
}

export async function fetchMySubscription(): Promise<UserSubscriptionRow | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("user_subscriptions")
    .select(`id, user_id, plan_id, status, started_at, current_period_end, canceled_at, plan:access_plans(${PLAN_COLUMNS})`)
    .eq("user_id", uid)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const planRow = row.plan as Record<string, unknown> | null;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    plan_id: String(row.plan_id),
    status: row.status as UserSubscriptionRow["status"],
    started_at: String(row.started_at),
    current_period_end: (row.current_period_end as string | null) ?? null,
    canceled_at: (row.canceled_at as string | null) ?? null,
    plan: planRow ? rowToPlan(planRow) : null,
  };
}

export async function cancelMySubscription(subscriptionId: string): Promise<void> {
  const { error } = await supabase
    .from("user_subscriptions")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", subscriptionId);
  if (error) throw error;
}
