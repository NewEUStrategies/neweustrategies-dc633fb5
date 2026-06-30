// CRM server functions: list/get/update leads, notes, consents, CSV export,
// Merydian integration push (webhook + API), and integration settings CRUD.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHmac } from "crypto";

const STAGE_ENUM = z.enum(["new","contacted","qualified","proposal","won","lost","archived"]);
type Stage = z.infer<typeof STAGE_ENUM>;

// JSON-safe sanitizer (Supabase returns inet/jsonb as `unknown`, which breaks
// the TanStack Start serializer). Round-tripping coerces everything to JSON.
const safe = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  stage: STAGE_ENUM.optional(),
  scope: z.enum(["tenant","all"]).default("tenant"),
  limit: z.number().int().min(1).max(500).default(200),
});

type AnyQuery = {
  select: (s: string) => AnyQuery;
  order: (c: string, o: { ascending: boolean }) => AnyQuery;
  limit: (n: number) => AnyQuery;
  eq: (c: string, v: unknown) => AnyQuery;
  or: (f: string) => AnyQuery;
  ilike: (c: string, v: string) => AnyQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
  insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
  update: (v: unknown) => AnyQuery;
  delete: () => AnyQuery;
  then: <R>(fn: (r: { data: unknown; error: { message: string } | null }) => R) => Promise<R>;
};
const tbl = (ctx: { supabase: unknown }, name: string): AnyQuery =>
  (ctx.supabase as { from: (t: string) => AnyQuery }).from(name);

export const listCrmLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const view = data.scope === "all" ? "crm_leads_all" : "crm_leads";
    let q = tbl(context, view).select("*").order("last_activity_at", { ascending: false }).limit(data.limit);
    if (data.stage) q = q.eq("stage", data.stage);
    if (data.search) {
      const s = `%${data.search.toLowerCase()}%`;
      q = q.or(`email.ilike.${s},first_name.ilike.${s},last_name.ilike.${s},company.ilike.${s}`);
    }
    const { data: leads, error } = await (q as unknown as Promise<{ data: unknown[]; error: { message: string } | null }>);
    if (error) throw new Error(error.message);
    return { leads: safe((leads ?? []) as Record<string, unknown>[]) };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const getCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: lead, error } = await tbl(context, "crm_leads")
      .select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Lead not found");
    const L = lead as { email: string; tenant_id: string; id: string };

    const [messages, subs, consents, notes] = await Promise.all([
      (tbl(context, "contact_messages")
        .select("id, form_type, form_name, subject, message, lang, source, page_url, referer, ip, consents, newsletter_opt_in, consent, created_at")
        .ilike("email", L.email).eq("tenant_id", L.tenant_id)
        .order("created_at", { ascending: false }).limit(100) as unknown as Promise<{ data: unknown[] }>).then((r) => r.data ?? []),
      (tbl(context, "newsletter_subscribers")
        .select("id, status, source, source_form_id, source_form_name, language, ip, consents, confirmed_at, created_at, updated_at")
        .ilike("email", L.email).eq("tenant_id", L.tenant_id)
        .order("created_at", { ascending: false }).limit(50) as unknown as Promise<{ data: unknown[] }>).then((r) => r.data ?? []),
      (tbl(context, "crm_consent_log").select("*")
        .ilike("email", L.email).eq("tenant_id", L.tenant_id)
        .order("created_at", { ascending: false }).limit(200) as unknown as Promise<{ data: unknown[] }>).then((r) => r.data ?? []),
      (tbl(context, "crm_lead_notes")
        .select("id, body, author_id, created_at").eq("lead_id", L.id)
        .order("created_at", { ascending: false }) as unknown as Promise<{ data: unknown[] }>).then((r) => r.data ?? []),
    ]);

    return safe({ lead: lead as Record<string, unknown>, messages, subscriptions: subs, consents, notes });
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  stage: STAGE_ENUM.optional(),
  owner_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(40)).max(40).optional(),
  follow_up_at: z.string().datetime().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
});

export const updateCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const res = await (tbl(context, "crm_leads").update(patch).eq("id", id) as unknown as Promise<{ error: { message: string } | null }>);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

const NoteInput = z.object({ lead_id: z.string().uuid(), body: z.string().trim().min(1).max(4000) });

export const addCrmNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => NoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const { error } = await tbl(context, "crm_lead_notes").insert({
      lead_id: data.lead_id, body: data.body, author_id: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCrmNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const res = await (tbl(context, "crm_lead_notes").delete().eq("id", data.id) as unknown as Promise<{ error: { message: string } | null }>);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

export const exportCrmLeadsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const view = data.scope === "all" ? "crm_leads_all" : "crm_leads";
    let q = tbl(context, view).select("*").order("last_activity_at", { ascending: false }).limit(5000);
    if (data.stage) q = q.eq("stage", data.stage);
    const { data: rows, error } = await (q as unknown as Promise<{ data: Record<string, unknown>[]; error: { message: string } | null }>);
    if (error) throw new Error(error.message);
    const cols = ["email","first_name","last_name","phone","company","stage","tags","newsletter_status","marketing_consent","source_count","follow_up_at","last_activity_at","created_at"];
    const esc = (v: unknown): string => {
      if (v == null) return "";
      const s = Array.isArray(v) ? v.join("|") : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const r of rows ?? []) lines.push(cols.map((c) => esc(r[c])).join(","));
    return { csv: lines.join("\n"), count: rows?.length ?? 0 };
  });

// ============ Integrations: Merydian ============

const IntegrationsInput = z.object({
  merydian_enabled: z.boolean(),
  merydian_mode: z.enum(["webhook","api","both"]).default("webhook"),
  merydian_webhook_url: z.string().url().nullable().optional(),
  merydian_webhook_secret: z.string().max(200).nullable().optional(),
  merydian_api_base: z.string().url().nullable().optional(),
  merydian_api_key: z.string().max(500).nullable().optional(),
  merydian_workspace_id: z.string().max(120).nullable().optional(),
  forward_stages: z.array(STAGE_ENUM).default(["new"]),
});

export const getCrmIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await tbl(context, "crm_integrations").select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return { settings: safe(data as Record<string, unknown> | null) };
  });

export const upsertCrmIntegrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IntegrationsInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const supabase = (context as { supabase: { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: boolean | null }> } }).supabase;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: existing } = await tbl(context, "crm_integrations").select("id").maybeSingle();
    const E = existing as { id: string } | null;
    const res = E
      ? await (tbl(context, "crm_integrations").update(data).eq("id", E.id) as unknown as Promise<{ error: { message: string } | null }>)
      : await tbl(context, "crm_integrations").insert(data);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

const PushInput = z.object({ lead_id: z.string().uuid() });

export const pushLeadToMerydian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => PushInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: lead, error } = await tbl(context, "crm_leads").select("*").eq("id", data.lead_id).maybeSingle();
    if (error || !lead) throw new Error(error?.message ?? "Lead not found");
    const L = lead as LeadRow;
    const { data: cfg } = await tbl(context, "crm_integrations").select("*").eq("tenant_id", L.tenant_id).maybeSingle();
    if (!cfg || !(cfg as { merydian_enabled: boolean }).merydian_enabled) throw new Error("Merydian integration is disabled");
    const result = await dispatchMerydian(L, cfg as Record<string, unknown>);
    await (tbl(context, "crm_integrations").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: result.ok ? "ok" : "error",
      last_sync_error: result.ok ? null : (result.error ?? "unknown"),
    }).eq("tenant_id", L.tenant_id) as unknown as Promise<unknown>);
    return result;
  });

export type LeadRow = {
  id: string; tenant_id: string; email: string; first_name: string | null; last_name: string | null;
  phone: string | null; company: string | null; stage: Stage; tags: string[] | null;
  marketing_consent: boolean; newsletter_status: string | null; created_at: string; last_activity_at: string;
};

export async function dispatchMerydian(
  lead: LeadRow,
  cfg: Record<string, unknown>,
): Promise<{ ok: boolean; via?: string; status?: number; error?: string }> {
  const mode = String(cfg.merydian_mode ?? "webhook");
  const stages = (cfg.forward_stages as Stage[] | null) ?? ["new"];
  if (!stages.includes(lead.stage)) return { ok: true, via: "skipped_stage" };

  const payload = {
    id: lead.id, email: lead.email,
    first_name: lead.first_name, last_name: lead.last_name,
    phone: lead.phone, company: lead.company,
    stage: lead.stage, tags: lead.tags ?? [],
    marketing_consent: lead.marketing_consent,
    newsletter_status: lead.newsletter_status,
    workspace_id: cfg.merydian_workspace_id ?? null,
    created_at: lead.created_at, last_activity_at: lead.last_activity_at,
  };
  const body = JSON.stringify(payload);
  const out: { webhook?: { ok: boolean; status?: number; error?: string }; api?: { ok: boolean; status?: number; error?: string } } = {};

  if (mode === "webhook" || mode === "both") {
    const url = String(cfg.merydian_webhook_url ?? "");
    if (!url) out.webhook = { ok: false, error: "missing_webhook_url" };
    else {
      const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "NES-CRM/1.0" };
      const secret = (cfg.merydian_webhook_secret as string | null) ?? "";
      if (secret) headers["X-Signature"] = createHmac("sha256", secret).update(body).digest("hex");
      try {
        const r = await fetch(url, { method: "POST", headers, body });
        out.webhook = { ok: r.ok, status: r.status, error: r.ok ? undefined : await r.text().then((t) => t.slice(0, 200)).catch(() => "") };
      } catch (e) { out.webhook = { ok: false, error: String(e).slice(0, 200) }; }
    }
  }

  if (mode === "api" || mode === "both") {
    const base = String(cfg.merydian_api_base ?? "");
    const apiKey = String(cfg.merydian_api_key ?? "");
    if (!base || !apiKey) out.api = { ok: false, error: "missing_api_config" };
    else {
      try {
        const r = await fetch(`${base.replace(/\/$/, "")}/leads`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "User-Agent": "NES-CRM/1.0" },
          body,
        });
        out.api = { ok: r.ok, status: r.status, error: r.ok ? undefined : await r.text().then((t) => t.slice(0, 200)).catch(() => "") };
      } catch (e) { out.api = { ok: false, error: String(e).slice(0, 200) }; }
    }
  }

  const okAny = (out.webhook?.ok ?? false) || (out.api?.ok ?? false);
  const errs = [out.webhook?.error, out.api?.error].filter(Boolean).join(" | ");
  return { ok: okAny, via: mode, error: okAny ? undefined : errs || "no_target" };
}
