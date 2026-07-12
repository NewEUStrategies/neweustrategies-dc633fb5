// Newsletter campaigns — admin CRUD + wysyłka paczkami przez Resend.
//
// Bezpieczeństwo:
//  - wszystkie funkcje wymagają `requireStaff` (admin/editor w ramach tenanta),
//  - wysyłka i log wysyłek idą przez `supabaseAdmin` z pinowaniem po `tenant_id`
//    pochodzącym z profilu wywołującego (nigdy z inputu klienta),
//  - kampania nie może być wysłana ponownie po statusie `sent`; świeże
//    `sending` też jest zablokowane (wyjątek: crash recovery, patrz niżej).
//
// Wysyłka:
//  - `sendCampaign` przełącza status → `sending`, materializuje odbiorców
//    (audience_filter → newsletter_subscribers), a następnie wysyła
//    paczkami po 20 e-maili (Resend limit ~1 e-mail/sek per konto — chunki
//    zmniejszają ryzyko rate-limita), logując każdą próbę w
//    `newsletter_campaign_recipients`.
//  - Każdy odbiorca dostaje stopkę „Unsubscribe" z indywidualnym tokenem.
//  - Zmienne `{{firstName}}`, `{{lastName}}`, `{{email}}` są renderowane
//    per odbiorca.
//
// Praca porcjami + dzierżawa (od 20260713170000):
//  - jedno wywołanie wysyła najwyżej MAX_EMAILS_PER_INVOCATION e-maili
//    i ODDAJE dzierżawę (lease_until=NULL) - koniec z jednym requestem
//    trzymanym przez całą listę (timeout na dużych listach). Kampania
//    w `sending` bez aktywnej dzierżawy jest natychmiast wznawialna
//    przez UI, drugiego admina albo automatyczny tick.
//  - Wznowienie jest idempotentne: odbiorcy z logu ze statusem `sent`
//    nigdy nie dostają wiadomości drugi raz; `failed`/`skipped` są ponawiani.
//
// Harmonogram:
//  - automatyczny: pg_cron + pg_net POST-uje co minutę na
//    /api/public/jobs-tick (sekret w job_runner_settings), który woła
//    `tickNewsletterCampaigns` cross-tenant - kampanie zaplanowane wysyłają
//    się BEZ udziału człowieka (SQL sam nie może: wysyłka wymaga env
//    RESEND_API_KEY, stąd wywołanie HTTP do aplikacji).
//  - zapasowy (opportunistic, docs/ARCHITECTURE.md §2.6): `processDueCampaigns`
//    przy wejściu admina na listę kampanii / overview + przycisk ręczny.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { rewriteTrackingLinks, trackingPixelImg } from "@/lib/newsletter/tracking";

type DbClient = SupabaseClient<Database>;

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1100; // Resend free plan ~1 msg/s
const DUE_CAMPAIGNS_PER_TICK = 3; // limit kampanii odpalanych w jednym ticku
// Górna granica e-maili wysłanych w JEDNYM wywołaniu server fn / ticku:
// ~200 * (1.1s / 20) ≈ 12 s requestu - bezpiecznie poniżej timeoutów runtime.
const MAX_EMAILS_PER_INVOCATION = 200;
// Dzierżawa aktywnego procesora: chroni przed równoległym podwójnym
// przetwarzaniem; wygasa sama, gdyby proces zginął w trakcie porcji.
const LEASE_MS = 3 * 60 * 1000;

const AudienceFilter = z.object({
  languages: z
    .array(z.enum(["pl", "en"]))
    .max(2)
    .optional(),
  statuses: z
    .array(z.enum(["subscribed", "pending"]))
    .max(2)
    .optional(),
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
  /** Dzierżawa aktywnego procesora (NULL/przeszłość = wznawialna). */
  lease_until: string | null;
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

async function originFromRequest(): Promise<string> {
  const envUrl = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  try {
    // Dynamicznie: eksport tickNewsletterCampaigns (zwykła funkcja) trzyma ten
    // moduł w grafie klienta, a statyczny import react-start/server wywala
    // import-protection buildu.
    const { getRequest } = await import("@tanstack/react-start/server");
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
// ENGAGEMENT (open/click counts for the admin editor)
// ----------------------------------------------------------------------------
export const getCampaignEngagement = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ opens: number; clicks: number }> => {
    const tenantId = await getTenantId(context);
    // `newsletter_campaign_events` has staff-read RLS (tenant-scoped), so the
    // caller's own user-scoped client can count it. Table not in generated
    // types yet -> cast (precedent: web_vitals).
    const countKind = async (kind: "open" | "click"): Promise<number> => {
      const { count, error } = await context.supabase
        .from("newsletter_campaign_events" as never)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("campaign_id", data.id)
        .eq("kind", kind);
      if (error) return 0;
      return count ?? 0;
    };
    const [opens, clicks] = await Promise.all([countKind("open"), countKind("click")]);
    return { opens, clicks };
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
      null,
    );
    const from = buildFrom(camp);
    const send = await sendEmail({
      to: data.toEmail,
      subject: `[TEST] ${subject}`,
      html,
      from,
      replyTo: camp.reply_to,
    });
    if (!send.ok) throw new Error(send.error ?? "send_failed");
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// SEND CAMPAIGN
// ----------------------------------------------------------------------------
export const sendCampaign = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; sent: number; failed: number; done: boolean; remaining: number }> => {
      const tenantId = await getTenantId(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const camp = await claimCampaign(supabaseAdmin, data.id, tenantId, "manual");
      if (!camp) throw new Error("campaign_not_sendable");
      const result = await runCampaignSend(supabaseAdmin, camp, tenantId, {
        maxEmails: MAX_EMAILS_PER_INVOCATION,
      });
      return { ok: true, ...result };
    },
  );

// ----------------------------------------------------------------------------
// PROCESS DUE CAMPAIGNS (opportunistic tick)
// ----------------------------------------------------------------------------
// Odpala zaległe kampanie `scheduled` z `scheduled_at <= now()` - wywoływane
// przy wejściu admina na listę kampanii / overview (fallback zamiast pg_cron,
// bo wysyłka wymaga env HTTP: RESEND_API_KEY / LOVABLE_API_KEY).
export const processDueCampaigns = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<{ fired: number; continued: number; sent: number }> => {
    const tenantId = await getTenantId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return tickNewsletterCampaigns(supabaseAdmin, { tenantId });
  });

/**
 * Wspólny tick wysyłki: (1) odpala zaległe kampanie `scheduled`,
 * (2) kontynuuje kampanie `sending` z oddaną/wygasłą dzierżawą.
 * Praca ograniczona budżetem e-maili na wywołanie; wywoływany przez
 * staff-owy `processDueCampaigns` (tenant-scoped) oraz przez
 * /api/public/jobs-tick (cross-tenant, pg_cron + pg_net).
 */
export async function tickNewsletterCampaigns(
  admin: DbClient,
  opts: { tenantId?: string; maxEmails?: number } = {},
): Promise<{ fired: number; continued: number; sent: number }> {
  const budgetTotal = Math.max(1, opts.maxEmails ?? MAX_EMAILS_PER_INVOCATION);
  let budget = budgetTotal;
  let fired = 0;
  let continued = 0;
  let sentTotal = 0;

  // (1) Zaległe kampanie zaplanowane.
  let dueQ = admin
    .from("newsletter_campaigns")
    .select("id, tenant_id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(DUE_CAMPAIGNS_PER_TICK);
  if (opts.tenantId) dueQ = dueQ.eq("tenant_id", opts.tenantId);
  const { data: due, error } = await dueQ;
  if (error) throw new Error(error.message);

  for (const row of due ?? []) {
    if (budget <= 0) break;
    // Atomowy claim gwarantuje, że równoległy tick (druga karta admina,
    // cron) nie odpali tej samej kampanii dwa razy.
    const camp = await claimCampaign(admin, row.id, row.tenant_id, "due");
    if (!camp) continue;
    fired++;
    try {
      const r = await runCampaignSend(admin, camp, row.tenant_id, { maxEmails: budget });
      sentTotal += r.processed;
      budget -= Math.min(budget, r.processed);
    } catch {
      // runCampaignSend oznaczył już kampanię jako failed - lecimy dalej,
      // żeby jedna zepsuta kampania nie blokowała pozostałych zaległych.
    }
  }

  // (2) Kontynuacje: `sending` bez aktywnej dzierżawy (porcja się skończyła
  // albo poprzedni proces zginął). Idempotencja per odbiorca czyni wznowienie
  // bezpiecznym.
  if (budget > 0) {
    let contQ = admin
      .from("newsletter_campaigns")
      .select("id, tenant_id")
      .eq("status", "sending")
      .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
      .order("started_at", { ascending: true })
      .limit(DUE_CAMPAIGNS_PER_TICK);
    if (opts.tenantId) contQ = contQ.eq("tenant_id", opts.tenantId);
    const { data: cont, error: contErr } = await contQ;
    if (contErr) throw new Error(contErr.message);
    for (const row of cont ?? []) {
      if (budget <= 0) break;
      const camp = await claimCampaign(admin, row.id, row.tenant_id, "continue");
      if (!camp) continue;
      continued++;
      try {
        const r = await runCampaignSend(admin, camp, row.tenant_id, { maxEmails: budget });
        sentTotal += r.processed;
        budget -= Math.min(budget, r.processed);
      } catch {
        /* jw. - kampania oznaczona jako failed */
      }
    }
  }

  return { fired, continued, sent: sentTotal };
}

// ----------------------------------------------------------------------------
// Shared send pipeline (manual send + scheduled fire use the same path)
// ----------------------------------------------------------------------------

/**
 * Atomowe przejęcie kampanii (status → `sending` + świeża dzierżawa).
 *
 * - `due`: tylko `scheduled` z `scheduled_at <= now()` (tick nie może odpalić
 *   szkicu ani kampanii przełożonej w międzyczasie).
 * - `continue`: tylko `sending` z oddaną/wygasłą dzierżawą (kontynuacja
 *   porcji lub przejęcie po martwym procesie).
 * - `manual`: `draft`/`scheduled`/`failed` oraz `sending` bez aktywnej
 *   dzierżawy (przycisk "Wyślij"/"Wznów" w UI).
 *
 * Dzierżawa (lease_until) wyklucza dwa równoległe procesory; wznowienie jest
 * idempotentne per odbiorca (patrz `runCampaignSend`).
 */
async function claimCampaign(
  admin: DbClient,
  campaignId: string,
  tenantId: string,
  mode: "manual" | "due" | "continue",
): Promise<CampaignRow | null> {
  const nowIso = new Date().toISOString();
  const leaseIso = new Date(Date.now() + LEASE_MS).toISOString();
  // lease_until jest nowsze niż wygenerowane typy -> cast payloadu.
  let q = admin
    .from("newsletter_campaigns")
    .update({
      status: "sending",
      started_at: nowIso,
      last_error: null,
      lease_until: leaseIso,
    } as never)
    .eq("id", campaignId)
    .eq("tenant_id", tenantId);
  if (mode === "due") {
    q = q.eq("status", "scheduled").lte("scheduled_at", nowIso);
  } else if (mode === "continue") {
    q = q.eq("status", "sending").or(`lease_until.is.null,lease_until.lt.${nowIso}`);
  } else {
    q = q.or(
      `status.in.(draft,scheduled,failed),and(status.eq.sending,lease_until.is.null),and(status.eq.sending,lease_until.lt.${nowIso})`,
    );
  }
  const { data: claimed, error } = await q.select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (claimed ?? null) as unknown as CampaignRow | null;
}

interface AudienceSubscriber {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  language: string;
  unsubscribe_token: string | null;
}

/**
 * Właściwa wysyłka zaklamowanej kampanii (wspólna dla `sendCampaign`
 * i ticku - jedna implementacja pętli paczek).
 *
 * Praca porcjami: wywołanie wysyła najwyżej `maxEmails` wiadomości, odnawia
 * dzierżawę po każdej paczce i - jeśli zostali odbiorcy - ODDAJE dzierżawę
 * (status zostaje `sending`, lease_until=NULL), zwracając done=false.
 * Kolejne wywołanie (auto-kontynuacja UI, tick crona, drugi admin) podejmuje
 * kampanię natychmiast.
 *
 * Idempotencja wznowienia: przed wysyłką czytamy log
 * `newsletter_campaign_recipients` - odbiorcy ze statusem `sent` są pomijani
 * (nigdy nie dostają wiadomości drugi raz), a `failed`/`skipped` są ponawiani.
 * Licznik `sent` startuje od liczby już wysłanych, więc statystyki po
 * wznowieniu pozostają spójne.
 *
 * Każdy błąd oznacza kampanię jako `failed` (markFailed) i jest rzucany dalej.
 */
async function runCampaignSend(
  admin: DbClient,
  camp: CampaignRow,
  tenantId: string,
  opts: { maxEmails?: number } = {},
): Promise<{ sent: number; failed: number; done: boolean; remaining: number; processed: number }> {
  const maxEmails = Math.max(1, opts.maxEmails ?? MAX_EMAILS_PER_INVOCATION);
  try {
    // Fetch audience.
    const filter = camp.audience_filter ?? {};
    const statuses = filter.statuses?.length ? filter.statuses : ["subscribed"];
    let q = admin
      .from("newsletter_subscribers")
      .select("id, email, first_name, last_name, language, unsubscribe_token")
      .eq("tenant_id", tenantId)
      .in("status", statuses);
    if (filter.languages?.length) q = q.in("language", filter.languages);
    if (filter.source) q = q.eq("source", filter.source);
    const { data: subs, error: subsErr } = await q;
    if (subsErr) throw new Error(subsErr.message);
    const audience = (subs ?? []) as AudienceSubscriber[];

    // Resume-idempotency: skip recipients already logged as "sent" by a
    // previous (crashed) run; retry "failed"/"skipped" ones.
    const { data: logged, error: loggedErr } = await admin
      .from("newsletter_campaign_recipients")
      .select("email, status")
      .eq("tenant_id", tenantId)
      .eq("campaign_id", camp.id);
    if (loggedErr) throw new Error(loggedErr.message);
    const alreadySent = new Set(
      (logged ?? []).filter((r) => r.status === "sent").map((r) => r.email),
    );
    const allPending = audience.filter((sub) => !alreadySent.has(sub.email));
    // Porcja tego wywołania; reszta zostaje na kolejne wywołania/tick.
    const pending = allPending.slice(0, maxEmails);
    const recipientCount = new Set([...audience.map((sub) => sub.email), ...alreadySent]).size;

    let sent = alreadySent.size;
    let failed = 0;

    await admin
      .from("newsletter_campaigns")
      .update({ recipient_count: recipientCount, sent_count: sent, failed_count: 0 })
      .eq("id", camp.id);

    const from = buildFrom(camp);
    const origin = await originFromRequest();

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const chunk = pending.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (sub) => {
          const lang = (sub.language === "en" ? "en" : "pl") as "pl" | "en";
          const subject = lang === "pl" ? camp.subject_pl : camp.subject_en;
          const rawHtml = lang === "pl" ? camp.html_pl : camp.html_en;
          if (!subject || !rawHtml) {
            await logRecipient(admin, {
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
          const unsubscribeUrl =
            sub.unsubscribe_token && origin
              ? `${origin}/newsletter/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}`
              : null;
          const html = renderCampaignHtml(
            rawHtml,
            { email: sub.email, firstName: sub.first_name ?? "", lastName: sub.last_name ?? "" },
            lang,
            unsubscribeUrl,
            origin && sub.unsubscribe_token
              ? { origin, campaignId: camp.id, token: sub.unsubscribe_token }
              : null,
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
            await logRecipient(admin, {
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
            await logRecipient(admin, {
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
      // Postęp + odnowienie dzierżawy (proces wciąż żyje).
      await admin
        .from("newsletter_campaigns")
        .update({
          sent_count: sent,
          failed_count: failed,
          lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
        } as never)
        .eq("id", camp.id);
      if (i + BATCH_SIZE < pending.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const remaining = allPending.length - pending.length;
    if (remaining > 0) {
      // Porcja wyczerpana - kampania zostaje w `sending` z oddaną dzierżawą,
      // gotowa do natychmiastowego podjęcia przez kolejne wywołanie.
      await admin
        .from("newsletter_campaigns")
        .update({ sent_count: sent, failed_count: failed, lease_until: null } as never)
        .eq("id", camp.id);
      return { sent, failed, done: false, remaining, processed: pending.length };
    }

    const finalStatus = failed > 0 && sent === 0 ? "failed" : "sent";
    await admin
      .from("newsletter_campaigns")
      .update({
        status: finalStatus,
        sent_count: sent,
        failed_count: failed,
        finished_at: new Date().toISOString(),
        lease_until: null,
      } as never)
      .eq("id", camp.id);

    return { sent, failed, done: true, remaining: 0, processed: pending.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(admin, camp.id, message);
    throw err instanceof Error ? err : new Error(message);
  }
}

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
  // When present, body links are rewritten through the click-tracking redirect
  // and an open-tracking pixel is appended. `token` reuses the subscriber's
  // existing unsubscribe token. Null for test sends (no tracking).
  tracking: { origin: string; campaignId: string; token: string } | null = null,
): string {
  const replaced = rawHtml
    .replaceAll("{{email}}", esc(vars.email))
    .replaceAll("{{firstName}}", esc(vars.firstName))
    .replaceAll("{{lastName}}", esc(vars.lastName));
  // Rewrite body links BEFORE the unsubscribe footer is appended, so the
  // one-click unsubscribe link (and List-Unsubscribe / RFC-8058) is never
  // routed through the tracker.
  const content = tracking
    ? rewriteTrackingLinks(replaced, tracking.origin, tracking.campaignId, tracking.token)
    : replaced;
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
  const pixel = tracking
    ? trackingPixelImg(tracking.origin, tracking.campaignId, tracking.token)
    : "";
  return `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px;margin:0 auto">${content}${footer}${pixel}</div>`;
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
    .update({
      status: "failed",
      last_error: message.slice(0, 500),
      finished_at: new Date().toISOString(),
      lease_until: null,
    } as never)
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
  await admin.from("newsletter_campaign_recipients").upsert(
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
