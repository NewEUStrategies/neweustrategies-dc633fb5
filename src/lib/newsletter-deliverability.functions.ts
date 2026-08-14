// Dostarczalność newslettera - warstwa serwerowa panelu /admin/newsletter/deliverability.
//
// Panel odpowiada na trzy pytania operatora:
//   1. Czy moja domena jest bezpieczna? (wskaźniki vs progi Google)
//   2. Kogo i dlaczego nie da się już dowieźć? (lista wykluczeń)
//   3. Czy pętla zwrotna w ogóle działa? (status webhooka)
//
// Autoryzacja: requireAdminEditor + RPC/RLS pinowane po current_tenant_id() - dane
// nigdy nie przekraczają granicy tenanta, także dla super admina przełączonego
// kontekstem. Tabele i funkcje pochodzą z migracji 20260725120000 (nowszej niż
// wygenerowane typy Supabase), więc nazwy są rzutowane przy wywołaniu -
// precedens: newsletter_campaign_events w getCampaignEngagement.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminEditor } from "@/integrations/supabase/require-staff";
import {
  computeReputation,
  EMPTY_COUNTS,
  type DeliverabilityCounts,
  type ReputationSummary,
} from "@/lib/email/reputation";
import type { SuppressionReason, SuppressionScope } from "@/lib/email/suppressionPolicy";

export interface DeliverabilityDayPoint {
  day: string;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
}

export interface DeliverabilityCampaignRow {
  id: string;
  name: string;
  finishedAt: string | null;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  suppressed: number;
}

export interface SuppressionReasonCount {
  reason: SuppressionReason;
  scope: SuppressionScope;
  count: number;
}

export interface DeliverabilityMetrics {
  days: number;
  counts: DeliverabilityCounts;
  reputation: ReputationSummary;
  reasons: SuppressionReasonCount[];
  series: DeliverabilityDayPoint[];
  campaigns: DeliverabilityCampaignRow[];
  generatedAt: string | null;
}

export interface SuppressionRow {
  id: string;
  email: string;
  reason: SuppressionReason;
  scope: SuppressionScope;
  source: string;
  occurrences: number;
  diagnostic: string | null;
  note: string | null;
  campaignId: string | null;
  expiresAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  releasedAt: string | null;
}

function num(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

const REASONS: readonly SuppressionReason[] = [
  "hard_bounce",
  "soft_bounce",
  "complaint",
  "manual",
  "unsubscribe",
  "invalid",
  "blocked",
];

function reasonOf(value: unknown): SuppressionReason {
  return typeof value === "string" && (REASONS as readonly string[]).includes(value)
    ? (value as SuppressionReason)
    : "manual";
}

function scopeOf(value: unknown): SuppressionScope {
  return value === "transient" ? "transient" : "permanent";
}

// ----------------------------------------------------------------------------
// METRYKI + REPUTACJA
// ----------------------------------------------------------------------------
export const getDeliverabilityMetrics = createServerFn({ method: "GET" })
  .middleware([requireAdminEditor])
  .validator((data: unknown) =>
    z
      .object({ days: z.number().int().min(1).max(365).default(30) })
      .default({ days: 30 })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<DeliverabilityMetrics> => {
    const { data: raw, error } = await context.supabase.rpc("newsletter_deliverability_metrics", {
      p_days: data.days,
    });
    if (error) throw new Error(error.message);
    const row: Record<string, unknown> = isRecord(raw) ? raw : {};

    const counts: DeliverabilityCounts = {
      ...EMPTY_COUNTS,
      sent: num(row, "sent"),
      delivered: num(row, "delivered"),
      bounced: num(row, "bounced"),
      hardBounced: num(row, "hard_bounced"),
      softBounced: num(row, "soft_bounced"),
      complained: num(row, "complained"),
      failed: num(row, "failed"),
      delayed: num(row, "delayed"),
      suppressedSends: num(row, "suppressed_sends"),
      activeSuppressions: num(row, "active_suppressions"),
    };

    return {
      days: num(row, "days") || data.days,
      counts,
      reputation: computeReputation(counts),
      reasons: records(row.suppression_reasons).map((r) => ({
        reason: reasonOf(r.reason),
        scope: scopeOf(r.scope),
        count: num(r, "count"),
      })),
      series: records(row.series).map((p) => ({
        day: str(p, "day") ?? "",
        sent: num(p, "sent"),
        delivered: num(p, "delivered"),
        bounced: num(p, "bounced"),
        complained: num(p, "complained"),
      })),
      campaigns: records(row.campaigns).map((c) => ({
        id: str(c, "id") ?? "",
        name: str(c, "name") ?? "",
        finishedAt: str(c, "finished_at"),
        sent: num(c, "sent"),
        delivered: num(c, "delivered"),
        bounced: num(c, "bounced"),
        complained: num(c, "complained"),
        suppressed: num(c, "suppressed"),
      })),
      generatedAt: str(row, "generated_at"),
    };
  });

// ----------------------------------------------------------------------------
// LISTA WYKLUCZEŃ
// ----------------------------------------------------------------------------
const SuppressionQuery = z.object({
  search: z.string().trim().max(200).default(""),
  reason: z.enum(["all", ...REASONS] as [string, ...string[]]).default("all"),
  state: z.enum(["active", "released", "all"]).default("active"),
  limit: z.number().int().min(1).max(1000).default(300),
});

export const listSuppressions = createServerFn({ method: "GET" })
  .middleware([requireAdminEditor])
  .validator((data: unknown) => SuppressionQuery.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<SuppressionRow[]> => {
    let query = context.supabase
      .from("email_suppressions")
      .select(
        "id, email, reason, scope, source, occurrences, diagnostic, note, campaign_id, expires_at, first_seen_at, last_seen_at, released_at",
      )
      .order("last_seen_at", { ascending: false })
      .limit(data.limit);

    if (data.reason !== "all") query = query.eq("reason", data.reason);
    if (data.state === "active") query = query.is("released_at", null);
    if (data.state === "released") query = query.not("released_at", "is", null);
    if (data.search) {
      // Wyszukiwanie po fragmencie adresu; znaki sterujące PostgREST usuwane,
      // żeby nie dało się rozszerzyć filtra.
      const term = data.search.toLowerCase().replace(/[%_,()"\\]/g, "");
      if (term) query = query.ilike("email", `%${term}%`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    return records(rows).map((r) => ({
      id: str(r, "id") ?? "",
      email: str(r, "email") ?? "",
      reason: reasonOf(r.reason),
      scope: scopeOf(r.scope),
      source: str(r, "source") ?? "system",
      occurrences: num(r, "occurrences"),
      diagnostic: str(r, "diagnostic"),
      note: str(r, "note"),
      campaignId: str(r, "campaign_id"),
      expiresAt: str(r, "expires_at"),
      firstSeenAt: str(r, "first_seen_at") ?? "",
      lastSeenAt: str(r, "last_seen_at") ?? "",
      releasedAt: str(r, "released_at"),
    }));
  });

export const addSuppression = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((data: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(254),
        reason: z
          .enum(["manual", "blocked", "complaint", "hard_bounce", "invalid"])
          .default("manual"),
        note: z.string().trim().max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("email_suppression_add", {
      p_email: data.email.toLowerCase(),
      p_reason: data.reason,
      // Pominięty klucz => DEFAULT NULL po stronie RPC (patrz recordJobRun).
      p_note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const releaseSuppression = createServerFn({ method: "POST" })
  .middleware([requireAdminEditor])
  .validator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        // Przywrócenie subskrypcji jest osobną, świadomą decyzją - zdjęcie
        // blokady po skardze bez zgody odbiorcy wraca prosto pod próg Google.
        resubscribe: z.boolean().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("email_suppression_release", {
      p_id: data.id,
      p_resubscribe: data.resubscribe,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// STATUS PĘTLI ZWROTNEJ
// ----------------------------------------------------------------------------
export interface DeliverabilitySetup {
  /** Czy RESEND_WEBHOOK_SECRET jest ustawiony (bez niego endpoint zwraca 503). */
  webhookConfigured: boolean;
  /** Adres do wklejenia w panelu Resend. */
  webhookUrl: string;
  /** Zdarzenia, na które endpoint powinien nasłuchiwać. */
  events: readonly string[];
  /** Czy dotarło już jakiekolwiek zdarzenie (dowód, że pętla działa). */
  lastEventAt: string | null;
}

export const getDeliverabilitySetup = createServerFn({ method: "GET" })
  .middleware([requireAdminEditor])
  .handler(async ({ context }): Promise<DeliverabilitySetup> => {
    const origin = (
      process.env.PUBLIC_SITE_URL ??
      process.env.SITE_URL ??
      process.env.URL ??
      ""
    ).replace(/\/+$/, "");

    const { data: rows } = await context.supabase
      .from("email_delivery_events")
      .select("occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(1);
    const last = records(rows)[0];

    return {
      webhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
      webhookUrl: `${origin}/api/public/webhooks/resend`,
      // `email.opened` i `email.clicked` NIE są tu wymienione świadomie.
      // Dostawca mierzy je tym samym mechanizmem, co my (piksel obrazka,
      // przepisany link - w dodatku przepisuje NASZ `nl-click` jeszcze raz na
      // swój), więc włączenie ich w panelu dostawcy dokłada drugi pomiar tego
      // samego zdarzenia. Zaangażowanie ma dokładnie jedno źródło prawdy
      // (`NEWSLETTER_ENGAGEMENT_SOURCE`, patrz docs/ARCHITECTURE.md §11.6);
      // ten webhook odpowiada za dostarczalność, nie za zaangażowanie.
      events: [
        "email.sent",
        "email.delivered",
        "email.delivery_delayed",
        "email.bounced",
        "email.complained",
        "email.failed",
      ],
      lastEventAt: last ? str(last, "occurred_at") : null,
    };
  });
