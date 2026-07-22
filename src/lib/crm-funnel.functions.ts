// CRM Marketing Funnel server functions.
//
// Ta warstwa obsługuje lejek marketingowy (subskrybenci newslettera). Widok
// `crm_funnel_view` łączy tabelę `newsletter_subscribers` z `profiles` oraz
// `crm_leads`, dodając flagi `is_registered` / `is_contact`. Dostęp do widoku
// pilnuje `security_invoker=true` + RLS na tabeli subskrybentów (staff-only
// w ramach tenanta). Dodatkowo używamy `requireStaff`, żeby wymusić zalogowaną
// rolę pracownika po stronie serwera.
import { createServerFn } from "@tanstack/react-start";
import { requireStaff } from "@/integrations/supabase/require-staff";
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
  .middleware([requireStaff])
  .inputValidator((d) => ListInput.parse(d))
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
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await tbl(context, "crm_funnel_view")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("not_found");
    return { json: j(row) };
  });

export const funnelStats = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data: rows, error } = await tbl(context, "crm_funnel_view").select(
      "status,is_registered,is_contact",
    );
    if (error) throw new Error(error.message);
    type Row = { status: string; is_registered: boolean; is_contact: boolean };
    const list = (rows as Row[] | null) ?? [];
    const total = list.length;
    let subscribed = 0;
    let pending = 0;
    let unsubscribed = 0;
    let registered = 0;
    let contacts = 0;
    for (const r of list) {
      if (r.status === "subscribed") subscribed += 1;
      else if (r.status === "pending") pending += 1;
      else if (r.status === "unsubscribed") unsubscribed += 1;
      if (r.is_registered) registered += 1;
      if (r.is_contact) contacts += 1;
    }
    return { total, subscribed, pending, unsubscribed, registered, contacts };
  });

const BulkInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export const bulkUnsubscribeFunnel = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => BulkInput.parse(d))
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
 * unique (tenant_id, email_norm) — nie duplikuje istniejących kontaktów.
 */
export const convertFunnelToContacts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => ConvertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: subs, error } = await tbl(context, "newsletter_subscribers")
      .select("id,tenant_id,email,first_name,last_name,language")
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    type Sub = {
      id: string;
      tenant_id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      language: string | null;
    };
    const list = (subs as Sub[] | null) ?? [];
    if (list.length === 0) return { ok: true, count: 0 };

    const now = new Date().toISOString();
    const payload = list.map((s) => ({
      tenant_id: s.tenant_id,
      email: s.email,
      email_norm: s.email.toLowerCase(),
      first_name: s.first_name,
      last_name: s.last_name,
      source_type: "newsletter" as const,
      marketing_consent: true,
      newsletter_status: "subscribed",
      last_activity_at: now,
    }));

    const { error: upErr } = await write(context, "crm_leads").upsert(payload, {
      onConflict: "tenant_id,email_norm",
    });
    if (upErr) throw new Error(upErr.message);
    return { ok: true, count: list.length };
  });

const TagInput = z.object({
  id: z.string().uuid(),
  status: FunnelStatus,
});

export const updateFunnelStatus = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => TagInput.parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "unsubscribed") patch.unsubscribed_at = new Date().toISOString();
    if (data.status === "subscribed") patch.confirmed_at = new Date().toISOString();
    const { error } = await tbl(context, "newsletter_subscribers")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
