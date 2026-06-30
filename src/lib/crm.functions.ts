// CRM server functions: list/get/update leads, notes, consents, CSV export,
// Merydian integration push (webhook + API), and integration settings CRUD.
// All write paths require staff (admin/editor) or super_admin; super_admin sees
// cross-tenant data via the crm_leads_all view.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHmac } from "crypto";

type Stage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "archived";
const STAGES: Stage[] = ["new", "contacted", "qualified", "proposal", "won", "lost", "archived"];

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  stage: z.enum(["new","contacted","qualified","proposal","won","lost","archived"]).optional(),
  scope: z.enum(["tenant","all"]).default("tenant"),
  limit: z.number().int().min(1).max(500).default(200),
});

export const listCrmLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const view = data.scope === "all" ? "crm_leads_all" : "crm_leads";
    let q = supabase.from(view).select("*").order("last_activity_at", { ascending: false }).limit(data.limit);
    if (data.stage) q = q.eq("stage", data.stage);
    if (data.search) {
      const s = `%${data.search.toLowerCase()}%`;
      q = q.or(`email.ilike.${s},first_name.ilike.${s},last_name.ilike.${s},company.ilike.${s}`);
    }
    const { data: leads, error } = await q;
    if (error) throw new Error(error.message);
    return { leads: leads ?? [] };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const getCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: lead, error } = await supabase
      .from("crm_leads").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Lead not found");

    const [{ data: messages }, { data: subs }, { data: consents }, { data: notes }] = await Promise.all([
      supabase.from("contact_messages")
        .select("id, form_type, form_name, subject, message, lang, source, page_url, referer, ip, consents, newsletter_opt_in, consent, created_at")
        .ilike("email", lead.email)
        .eq("tenant_id", lead.tenant_id)
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("newsletter_subscribers")
        .select("id, status, source, source_form_id, source_form_name, language, ip, consents, confirmed_at, created_at, updated_at")
        .ilike("email", lead.email)
        .eq("tenant_id", lead.tenant_id)
        .order("created_at", { ascending: false }).limit(50),
      supabase.from("crm_consent_log")
        .select("*").ilike("email", lead.email).eq("tenant_id", lead.tenant_id)
        .order("created_at", { ascending: false }).limit(200),
      supabase.from("crm_lead_notes")
        .select("id, body, author_id, created_at").eq("lead_id", lead.id)
        .order("created_at", { ascending: false }),
    ]);

    return { lead, messages: messages ?? [], subscriptions: subs ?? [], consents: consents ?? [], notes: notes ?? [] };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  stage: z.enum(["new","contacted","qualified","proposal","won","lost","archived"]).optional(),
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
    const { error } = await context.supabase.from("crm_leads").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const NoteInput = z.object({ lead_id: z.string().uuid(), body: z.string().trim().min(1).max(4000) });

export const addCrmNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => NoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("crm_lead_notes").insert({
      lead_id: data.lead_id, body: data.body, author_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCrmNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("crm_lead_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const exportCrmLeadsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const view = data.scope === "all" ? "crm_leads_all" : "crm_leads";
    let q = context.supabase.from(view).select("*").order("last_activity_at", { ascending: false }).limit(5000);
    if (data.stage) q = q.eq("stage", data.stage);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const cols = ["email","first_name","last_name","phone","company","stage","tags","newsletter_status","marketing_consent","source_count","follow_up_at","last_activity_at","created_at"];
    const esc = (v: unknown): string => {
      if (v == null) return "";
      const s = Array.isArray(v) ? v.join("|") : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const r of rows ?? []) {
      const row = r as Record<string, unknown>;
      lines.push(cols.map((c) => esc(row[c])).join(","));
    }
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
  forward_stages: z.array(z.enum(["new","contacted","qualified","proposal","won","lost","archived"])).default(["new"]),
});

export const getCrmIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("crm_integrations").select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return { settings: data };
  });

export const upsertCrmIntegrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IntegrationsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: existing } = await context.supabase
      .from("crm_integrations").select("id").maybeSingle();

    const payload = { ...data };
    const { error } = existing
      ? await context.supabase.from("crm_integrations").update(payload).eq("id", existing.id)
      : await context.supabase.from("crm_integrations").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PushInput = z.object({ lead_id: z.string().uuid() });

export const pushLeadToMerydian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => PushInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lead, error } = await context.supabase
      .from("crm_leads").select("*").eq("id", data.lead_id).maybeSingle();
    if (error || !lead) throw new Error(error?.message ?? "Lead not found");

    const { data: cfg } = await supabaseAdmin
      .from("crm_integrations").select("*").eq("tenant_id", lead.tenant_id).maybeSingle();
    if (!cfg || !cfg.merydian_enabled) throw new Error("Merydian integration is disabled");

    const result = await dispatchMerydian(lead, cfg as Record<string, unknown>);

    await supabaseAdmin.from("crm_integrations").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: result.ok ? "ok" : "error",
      last_sync_error: result.ok ? null : (result.error ?? "unknown"),
    }).eq("tenant_id", lead.tenant_id);

    return result;
  });

type LeadRow = {
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
    id: lead.id,
    email: lead.email,
    first_name: lead.first_name,
    last_name: lead.last_name,
    phone: lead.phone,
    company: lead.company,
    stage: lead.stage,
    tags: lead.tags ?? [],
    marketing_consent: lead.marketing_consent,
    newsletter_status: lead.newsletter_status,
    workspace_id: cfg.merydian_workspace_id ?? null,
    created_at: lead.created_at,
    last_activity_at: lead.last_activity_at,
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
      } catch (e) {
        out.webhook = { ok: false, error: String(e).slice(0, 200) };
      }
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
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "User-Agent": "NES-CRM/1.0",
          },
          body,
        });
        out.api = { ok: r.ok, status: r.status, error: r.ok ? undefined : await r.text().then((t) => t.slice(0, 200)).catch(() => "") };
      } catch (e) {
        out.api = { ok: false, error: String(e).slice(0, 200) };
      }
    }
  }

  const okAny = (out.webhook?.ok ?? false) || (out.api?.ok ?? false);
  const errs = [out.webhook?.error, out.api?.error].filter(Boolean).join(" | ");
  return { ok: okAny, via: mode, error: okAny ? undefined : errs || "no_target" };
}
