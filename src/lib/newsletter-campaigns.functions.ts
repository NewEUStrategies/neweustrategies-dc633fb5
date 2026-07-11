// Newsletter campaigns — admin CRUD + wysyłka paczkami przez Resend.
//
// Bezpieczeństwo:
//  - wszystkie funkcje wymagają `requireStaff` (admin/editor w ramach tenanta),
//  - wysyłka i log wysyłek idą przez `supabaseAdmin` z pinowaniem po `tenant_id`
//    pochodzącym z profilu wywołującego (nigdy z inputu klienta),
//  - kampania nie może być wysłana ponownie po statusie `sent` / `sending`.
//
// Wysyłka:
//  - `startCampaignSend` przełącza status → `sending`, materializuje odbiorców
//    (audience_filter → newsletter_subscribers), a następnie wysyła
//    paczkami po 20 e-maili (Resend limit ~1 e-mail/sek per konto — chunki
//    zmniejszają ryzyko rate-limita), logując każdą próbę w
//    `newsletter_campaign_recipients`.
//  - Każdy odbiorca dostaje stopkę „Unsubscribe" z indywidualnym tokenem.
//  - Zmienne `{{firstName}}`, `{{lastName}}`, `{{email}}` są renderowane
//    per odbiorca.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DbClient = SupabaseClient<Database>;


const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1100; // Resend free plan ~1 msg/s

const AudienceFilter = z.object({
  languages: z.array(z.enum(["pl", "en"])).max(2).optional(),
  statuses: z.array(z.enum(["subscribed", "pending"])).max(2).optional(),
  source: z.string().trim().max(120).optional(),
});
export type AudienceFilter = z.infer<typeof AudienceFilter>;

const CampaignUpsert = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  subject_pl: z.string().trim().max(300).default(""),
  subject_en: z.string().trim().max(300).default(""),
  html_pl: z.string().max(200_000).default(""),
  html_en: z.string().max(200_000).default(""),
  from_name: z.string().trim().max(160).nullable().optional(),
  from_email: z.string().trim().email().max(254).nullable().optional(),
  reply_to: z.string().trim().email().max(254).nullable().optional(),
  audience_filter: AudienceFilter.default({}),
  scheduled_at: z.string().datetime().nullable().optional(),
});

export interface CampaignRow {
  id: string;
  tenant_id: string;
  name: string;
  subject_pl: string;
  subject_en: string;
  html_pl: string;
  html_en: string;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  audience_filter: AudienceFilter;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function esc(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function originFromRequest(): string {
  const envUrl = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  try {
    const req = getRequest();
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

async function getTenantId(context: { supabase: DbClient; userId: string }): Promise<string> {
  const { data: profile, error } = await context.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (error || !profile?.tenant_id) throw new Error("no_tenant");
  return profile.tenant_id;
}


// ----------------------------------------------------------------------------
// LIST
// ----------------------------------------------------------------------------
export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<CampaignRow[]> => {
    const { data, error } = await context.supabase
      .from("newsletter_campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CampaignRow[];
  });

// ----------------------------------------------------------------------------
// GET
// ----------------------------------------------------------------------------
export const getCampaign = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<CampaignRow | null> => {
    const { data: row, error } = await context.supabase
      .from("newsletter_campaigns")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as unknown as CampaignRow | null;
  });

// ----------------------------------------------------------------------------
// UPSERT
// ----------------------------------------------------------------------------
export const upsertCampaign = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => CampaignUpsert.parse(data))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const tenantId = await getTenantId(context);
    const payload = {
      tenant_id: tenantId,
      name: data.name,
      subject_pl: data.subject_pl,
      subject_en: data.subject_en,
      html_pl: data.html_pl,
      html_en: data.html_en,
      from_name: data.from_name ?? null,
      from_email: data.from_email ?? null,
      reply_to: data.reply_to ?? null,
      audience_filter: data.audience_filter,
      scheduled_at: data.scheduled_at ?? null,
      status: data.scheduled_at ? "scheduled" : "draft",
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("newsletter_campaigns")
        .update(payload)
        .eq("id", data.id)
        .in("status", ["draft", "scheduled", "failed"]);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("newsletter_campaigns")
      .insert({ ...payload, created_by: context.userId })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "insert_failed");
    return { id: inserted.id as string };
  });

// ----------------------------------------------------------------------------
// DELETE
// ----------------------------------------------------------------------------
export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("newsletter_campaigns")
      .delete()
      .eq("id", data.id)
      .in("status", ["draft", "scheduled", "failed", "cancelled"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// AUDIENCE COUNT
// ----------------------------------------------------------------------------
export const countCampaignAudience = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => AudienceFilter.parse(data))
  .handler(async ({ data, context }): Promise<{ count: number }> => {
    const tenantId = await getTenantId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("newsletter_subscribers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    const statuses = data.statuses?.length ? data.statuses : ["subscribed"];
    q = q.in("status", statuses);
    if (data.languages?.length) q = q.in("language", data.languages);
    if (data.source) q = q.eq("source", data.source);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

// ----------------------------------------------------------------------------
// SEND TEST
// ----------------------------------------------------------------------------
export const sendCampaignTest = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        toEmail: z.string().trim().email().max(254),
        language: z.enum(["pl", "en"]).default("pl"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await getTenantId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin
      .from("newsletter_campaigns")
      .select("*")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!c) throw new Error("not_found");
    const camp = c as unknown as CampaignRow;
    const subject = data.language === "pl" ? camp.subject_pl : camp.subject_en;
    const html = renderCampaignHtml(
      data.language === "pl" ? camp.html_pl : camp.html_en,
      { email: data.toEmail, firstName: "", lastName: "" },
      data.language,
      null,
    );
    const from = buildFrom(camp);
    const send = await sendEmail({ to: data.toEmail, subject: `[TEST] ${subject}`, html, from, replyTo: camp.reply_to });
    if (!send.ok) throw new Error(send.error ?? "send_failed");
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// SEND CAMPAIGN
// ----------------------------------------------------------------------------
export const sendCampaign = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true; sent: number; failed: number }> => {
    const tenantId = await getTenantId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Atomically claim the campaign - transition draft/scheduled/failed → sending.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("newsletter_campaigns")
      .update({ status: "sending", started_at: new Date().toISOString(), last_error: null })
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .in("status", ["draft", "scheduled", "failed"])
      .select("*")
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) throw new Error("campaign_not_sendable");
    const camp = claimed as unknown as CampaignRow;

    // Fetch audience.
    const filter = camp.audience_filter ?? {};
    const statuses = filter.statuses?.length ? filter.statuses : ["subscribed"];
    let q = supabaseAdmin
      .from("newsletter_subscribers")
      .select("id, email, first_name, last_name, language, unsubscribe_token")
      .eq("tenant_id", tenantId)
      .in("status", statuses);
    if (filter.languages?.length) q = q.in("language", filter.languages);
    if (filter.source) q = q.eq("source", filter.source);
    const { data: subs, error: subsErr } = await q;
    if (subsErr) {
      await markFailed(supabaseAdmin, camp.id, subsErr.message);
      throw new Error(subsErr.message);
    }
    const audience = (subs ?? []) as Array<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      language: string;
      unsubscribe_token: string | null;
    }>;

    await supabaseAdmin
      .from("newsletter_campaigns")
      .update({ recipient_count: audience.length })
      .eq("id", camp.id);

    const from = buildFrom(camp);
    const origin = originFromRequest();
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < audience.length; i += BATCH_SIZE) {
      const chunk = audience.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (sub) => {
          const lang = (sub.language === "en" ? "en" : "pl") as "pl" | "en";
          const subject = lang === "pl" ? camp.subject_pl : camp.subject_en;
          const rawHtml = lang === "pl" ? camp.html_pl : camp.html_en;
          if (!subject || !rawHtml) {
            await logRecipient(supabaseAdmin, {
              tenantId,
              campaignId: camp.id,
              subscriberId: sub.id,
              email: sub.email,
              language: lang,
              status: "skipped",
              error: "missing_content_for_language",
            });
            return;
          }
          const unsubscribeUrl = sub.unsubscribe_token && origin
            ? `${origin}/newsletter/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}`
            : null;
          const html = renderCampaignHtml(
            rawHtml,
            { email: sub.email, firstName: sub.first_name ?? "", lastName: sub.last_name ?? "" },
            lang,
            unsubscribeUrl,
          );
          const result = await sendEmail({
            to: sub.email,
            subject,
            html,
            from,
            replyTo: camp.reply_to,
            listUnsubscribeUrl: unsubscribeUrl,
          });
          if (result.ok) {
            sent++;
            await logRecipient(supabaseAdmin, {
              tenantId,
              campaignId: camp.id,
              subscriberId: sub.id,
              email: sub.email,
              language: lang,
              status: "sent",
              sentAt: new Date().toISOString(),
            });
          } else {
            failed++;
            await logRecipient(supabaseAdmin, {
              tenantId,
              campaignId: camp.id,
              subscriberId: sub.id,
              email: sub.email,
              language: lang,
              status: "failed",
              error: result.error ?? `http_${result.status ?? "unknown"}`,
            });
          }
        }),
      );
      // best-effort progress update
      await supabaseAdmin
        .from("newsletter_campaigns")
        .update({ sent_count: sent, failed_count: failed })
        .eq("id", camp.id);
      if (i + BATCH_SIZE < audience.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const finalStatus = failed > 0 && sent === 0 ? "failed" : "sent";
    await supabaseAdmin
      .from("newsletter_campaigns")
      .update({
        status: finalStatus,
        sent_count: sent,
        failed_count: failed,
        finished_at: new Date().toISOString(),
      })
      .eq("id", camp.id);

    return { ok: true, sent, failed };
  });

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildFrom(c: CampaignRow): string | undefined {
  if (!c.from_email) return undefined;
  return c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email;
}

function renderCampaignHtml(
  rawHtml: string,
  vars: { email: string; firstName: string; lastName: string },
  lang: "pl" | "en",
  unsubscribeUrl: string | null,
): string {
  const replaced = rawHtml
    .replaceAll("{{email}}", esc(vars.email))
    .replaceAll("{{firstName}}", esc(vars.firstName))
    .replaceAll("{{lastName}}", esc(vars.lastName));
  const footer = unsubscribeUrl
    ? `<hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
       <p style="color:#888;font-size:12px;text-align:center">
         ${
           lang === "pl"
             ? `Nie chcesz otrzymywać tych wiadomości? <a href="${esc(unsubscribeUrl)}" style="color:#888">Wypisz się jednym kliknięciem</a>.`
             : `No longer want these emails? <a href="${esc(unsubscribeUrl)}" style="color:#888">Unsubscribe with one click</a>.`
         }
       </p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px;margin:0 auto">${replaced}${footer}</div>`;
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string | null;
  listUnsubscribeUrl?: string | null;
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    return { ok: false, error: "email_not_configured" };
  }
  try {
    const headers: Record<string, string> = {};
    if (opts.listUnsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${opts.listUnsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const res = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: opts.from || "New European Strategies <onboarding@resend.dev>",
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        reply_to: opts.replyTo || undefined,
        headers: Object.keys(headers).length ? headers : undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: body.slice(0, 500) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function markFailed(admin: DbClient, id: string, message: string): Promise<void> {
  await admin
    .from("newsletter_campaigns")
    .update({ status: "failed", last_error: message.slice(0, 500), finished_at: new Date().toISOString() })
    .eq("id", id);
}

async function logRecipient(
  admin: DbClient,
  row: {
    tenantId: string;
    campaignId: string;
    subscriberId: string;
    email: string;
    language: "pl" | "en";
    status: "sent" | "failed" | "skipped";
    error?: string;
    sentAt?: string;
  },
): Promise<void> {
  await admin
    .from("newsletter_campaign_recipients")
    .upsert(
      {
        tenant_id: row.tenantId,
        campaign_id: row.campaignId,
        subscriber_id: row.subscriberId,
        email: row.email,
        language: row.language,
        status: row.status,
        error: row.error ?? null,
        sent_at: row.sentAt ?? null,
      },
      { onConflict: "campaign_id,email" },
    );
}

