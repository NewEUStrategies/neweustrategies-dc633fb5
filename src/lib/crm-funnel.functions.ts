// CRM Marketing Funnel server functions.
//
// Ta warstwa obsługuje lejek marketingowy (subskrybenci newslettera). Widok
// `crm_funnel_view` łączy tabelę `newsletter_subscribers` z `profiles` oraz
// `crm_leads`, dodając flagi `is_registered` / `is_contact`. Dostęp do widoku
// pilnuje `security_invoker=true` + RLS na tabeli subskrybentów (staff-only
// w ramach tenanta). Dodatkowo używamy `requireCrmStaff`, żeby wymusić zalogowaną
// rolę pracownika po stronie serwera.
import { createServerFn } from "@tanstack/react-start";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import { funnelMarketingConsent } from "@/lib/crm/funnelConsent";
import { z } from "zod";

type AnyQuery = {
  select: (s: string, opts?: { count?: "exact"; head?: boolean }) => AnyQuery;
  order: (c: string, o: { ascending: boolean }) => AnyQuery;
  limit: (n: number) => AnyQuery;
  eq: (c: string, v: unknown) => AnyQuery;
  neq: (c: string, v: unknown) => AnyQuery;
  is: (c: string, v: unknown) => AnyQuery;
  in: (c: string, v: unknown[]) => AnyQuery;
  or: (f: string) => AnyQuery;
  ilike: (c: string, v: string) => AnyQuery;
  gte: (c: string, v: unknown) => AnyQuery;
  lte: (c: string, v: unknown) => AnyQuery;
  update: (v: unknown) => AnyQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
  then: <R>(fn: (r: { data: unknown; error: { message: string } | null }) => R) => Promise<R>;
};

const tbl = (ctx: { supabase: unknown }, name: string): AnyQuery =>
  (ctx.supabase as { from: (t: string) => AnyQuery }).from(name);

const write = (
  ctx: { supabase: unknown },
  name: string,
): {
  insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
  upsert: (
    v: unknown,
    o?: { onConflict?: string },
  ) => Promise<{ error: { message: string } | null }>;
} =>
  (
    ctx.supabase as {
      from: (t: string) => {
        insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
        upsert: (
          v: unknown,
          o?: { onConflict?: string },
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  ).from(name);

const j = (v: unknown): string => JSON.stringify(v ?? null);

const FunnelStatus = z.enum(["subscribed", "pending", "unsubscribed", "bounced", "complained"]);
const AudienceFilter = z.enum(["all", "registered", "unregistered", "contact", "non_contact"]);

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  status: FunnelStatus.optional(),
  audience: AudienceFilter.default("all"),
  source: z.string().trim().max(120).optional(),
  language: z.enum(["pl", "en"]).optional(),
  created_from: z.string().datetime().optional(),
  created_to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const listFunnelSubscribers = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    let q = tbl(context, "crm_funnel_view")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.search && data.search.length > 0) {
      const term = data.search.replace(/[%_]/g, "");
      q = q.or(
        `email.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,display_name.ilike.%${term}%`,
      );
    }
    if (data.status) q = q.eq("status", data.status);
    if (data.source) q = q.eq("source", data.source);
    if (data.language) q = q.eq("language", data.language);
    if (data.created_from) q = q.gte("created_at", data.created_from);
    if (data.created_to) q = q.lte("created_at", data.created_to);

    switch (data.audience) {
      case "registered":
        q = q.eq("is_registered", true);
        break;
      case "unregistered":
        q = q.eq("is_registered", false);
        break;
      case "contact":
        q = q.eq("is_contact", true);
        break;
      case "non_contact":
        q = q.eq("is_contact", false);
        break;
      default:
        break;
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { json: j(rows ?? []) };
  });

export const getFunnelSubscriber = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await tbl(context, "crm_funnel_view")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("not_found");
    return { json: j(row) };
  });

export type FunnelStats = {
  total: number;
  subscribed: number;
  pending: number;
  unsubscribed: number;
  registered: number;
  contacts: number;
};

// Agregacja liczona w bazie (crm_funnel_stats, migracja 20260802130000):
// jeden skan z COUNT(*) FILTER zamiast ściągania całej tabeli i pętli w JS.
// RPC jest SECURITY INVOKER, więc RLS subskrybentów obowiązuje bez zmian.
export const funnelStats = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }): Promise<FunnelStats> => {
    const supabase = context.supabase as unknown as {
      rpc: (n: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await supabase.rpc("crm_funnel_stats");
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Partial<
      Record<keyof FunnelStats, number | string | null>
    > | null;
    const n = (v: number | string | null | undefined): number => Number(v ?? 0);
    return {
      total: n(row?.total),
      subscribed: n(row?.subscribed),
      pending: n(row?.pending),
      unsubscribed: n(row?.unsubscribed),
      registered: n(row?.registered),
      contacts: n(row?.contacts),
    };
  });

const BulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export const bulkUnsubscribeFunnel = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => BulkInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await tbl(context, "newsletter_subscribers")
      .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true, count: data.ids.length };
  });

const ConvertInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Konwersja zaznaczonych subskrybentów do Kontaktów CRM. Idempotentne dzięki
 * unique (tenant_id, email_norm) - nie duplikuje istniejących kontaktów.
 * Zgoda marketingowa i status newslettera są PRZEPISYWANE ze stanu
 * subskrybenta (patrz lib/crm/funnelConsent.ts), nigdy ustawiane w ciemno.
 */
export const convertFunnelToContacts = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ConvertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: subs, error } = await tbl(context, "newsletter_subscribers")
      .select("id,tenant_id,email,first_name,last_name,language,status,confirmed_at,consents")
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    type Sub = {
      id: string;
      tenant_id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      language: string | null;
      status: string | null;
      confirmed_at: string | null;
      consents: unknown;
    };
    const list = (subs as Sub[] | null) ?? [];
    if (list.length === 0) return { ok: true, count: 0 };

    const now = new Date().toISOString();
    const base = (s: Sub) => ({
      tenant_id: s.tenant_id,
      email: s.email,
      email_norm: s.email.toLowerCase(),
      first_name: s.first_name,
      last_name: s.last_name,
      source_type: "newsletter" as const,
      newsletter_status: s.status,
      last_activity_at: now,
    });

    // Dwa upserty, bo PostgREST nadpisuje na konflikcie WSZYSTKIE kolumny z
    // payloadu: dla subskrybenta bez dowodu zgody `marketing_consent` musi
    // zostać poza payloadem, inaczej konwersja zdjęłaby zgodę udowodnioną z
    // innego źródła (np. formularza kontaktowego).
    const consented = list.filter((s) => funnelMarketingConsent(s));
    const unproven = list.filter((s) => !funnelMarketingConsent(s));

    if (consented.length > 0) {
      const { error: upErr } = await write(context, "crm_leads").upsert(
        consented.map((s) => ({ ...base(s), marketing_consent: true })),
        { onConflict: "tenant_id,email_norm" },
      );
      if (upErr) throw new Error(upErr.message);
    }
    if (unproven.length > 0) {
      const { error: upErr } = await write(context, "crm_leads").upsert(unproven.map(base), {
        onConflict: "tenant_id,email_norm",
      });
      if (upErr) throw new Error(upErr.message);
    }

    try {
      await write(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.funnel.convert",
        entity_type: "crm_lead",
        entity_id: null,
        metadata: {
          count: list.length,
          with_marketing_consent: consented.length,
          without_marketing_consent: unproven.length,
          subscriber_ids: list.map((s) => s.id),
        },
      });
    } catch {
      /* audyt best-effort */
    }
    return { ok: true, count: list.length };
  });

const TagInput = z.object({
  id: z.string().uuid(),
  status: FunnelStatus,
});

export const updateFunnelStatus = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => TagInput.parse(d))
  .handler(async ({ data, context }) => {
    // `confirmed_at` to stempel POTWIERDZENIA ZAPISU przez subskrybenta
    // (double opt-in albo zapis bez DOI) - ręczna zmiana statusu przez staff go
    // nie wytwarza, bo byłby to fałszywy dowód zgody.
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "unsubscribed") patch.unsubscribed_at = new Date().toISOString();
    const { error } = await tbl(context, "newsletter_subscribers").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    try {
      await write(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.funnel.status_change",
        entity_type: "newsletter_subscriber",
        entity_id: data.id,
        metadata: { status: data.status },
      });
    } catch {
      /* audyt best-effort */
    }
    return { ok: true };
  });
