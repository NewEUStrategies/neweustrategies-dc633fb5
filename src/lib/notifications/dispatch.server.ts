// Dispatcher kanałów powiadomień (service role): web push + digest e-mail.
// Wołany przez /api/public/community-cron (sekret w nagłówku) - Postgres
// przygotowuje pracę (kolejka push, claim digestów), tu odbywa się wyłącznie
// I/O HTTP: usługi push przeglądarek i gateway Resend (jak newsletter).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTransactionalEmail } from "@/lib/server/email.server";
import { sendWebPush, vapidFromEnv } from "./webpush.server";
import {
  buildDigestHtml,
  digestSubject,
  pickDigestText,
  type DigestItem,
  type DigestLang,
} from "./digestEmail";

function siteUrl(): string {
  return (
    process.env.PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.URL ||
    "http://localhost:8080"
  );
}

/** Preferowany język per użytkownik: profiles.prefs->>'locale', domyślnie pl. */
async function localesFor(userIds: string[]): Promise<Map<string, DigestLang>> {
  const map = new Map<string, DigestLang>();
  if (userIds.length === 0) return map;
  const { data } = await supabaseAdmin.from("profiles").select("id, prefs").in("id", userIds);
  for (const row of data ?? []) {
    const prefs = (row.prefs ?? {}) as Record<string, unknown>;
    map.set(row.id, prefs.locale === "en" ? "en" : "pl");
  }
  return map;
}

interface PushJobPayload {
  kind?: string;
  title_pl?: string | null;
  title_en?: string | null;
  body_pl?: string | null;
  body_en?: string | null;
  href?: string | null;
}

/**
 * Zdejmuje partię zadań push i wysyła do WSZYSTKICH żywych subskrypcji
 * odbiorcy. Zadanie jest 'sent', gdy dotarło do >=1 endpointu; 'dead', gdy
 * odbiorca nie ma już żadnej żywej subskrypcji. Endpointy 404/410 są trwale
 * oznaczane (mark_push_subscription_failed).
 */
export async function processPushJobs(limit = 100): Promise<{ claimed: number; sent: number }> {
  const vapid = vapidFromEnv();
  if (!vapid) return { claimed: 0, sent: 0 };

  const { data: jobs, error } = await supabaseAdmin.rpc("claim_push_jobs", { p_limit: limit });
  if (error) throw error;
  if (!jobs || jobs.length === 0) return { claimed: 0, sent: 0 };

  const userIds = [...new Set(jobs.map((j) => j.user_id))];
  const [{ data: subs }, locales] = await Promise.all([
    supabaseAdmin
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", userIds)
      .is("failed_at", null),
    localesFor(userIds),
  ]);
  const subsByUser = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();
  for (const s of subs ?? []) {
    const list = subsByUser.get(s.user_id) ?? [];
    list.push(s);
    subsByUser.set(s.user_id, list);
  }

  let sent = 0;
  for (const job of jobs) {
    const userSubs = subsByUser.get(job.user_id) ?? [];
    if (userSubs.length === 0) {
      await supabaseAdmin.rpc("report_push_job", { p_id: job.id, p_ok: false, p_dead: true });
      continue;
    }
    const payload = (job.payload ?? {}) as PushJobPayload;
    const lang = locales.get(job.user_id) ?? "pl";
    const title = pickDigestText(
      { title_pl: payload.title_pl ?? null, title_en: payload.title_en ?? null },
      lang,
    );
    const body =
      (lang === "en"
        ? (payload.body_en ?? payload.body_pl)
        : (payload.body_pl ?? payload.body_en)) ?? "";

    let delivered = false;
    for (const sub of userSubs) {
      try {
        const result = await sendWebPush(
          sub,
          { title: title || "New European Strategies", body, href: payload.href ?? "/" },
          vapid,
        );
        if (result.ok) delivered = true;
        if (result.gone) {
          await supabaseAdmin.rpc("mark_push_subscription_failed", { p_endpoint: sub.endpoint });
        }
      } catch (err) {
        console.error("[community] push send error", err);
      }
    }
    await supabaseAdmin.rpc("report_push_job", { p_id: job.id, p_ok: delivered, p_dead: false });
    if (delivered) sent += 1;
  }
  return { claimed: jobs.length, sent };
}

/**
 * Zdejmuje partię należnych digestów (claim atomowy w DB) i wysyła e-maile.
 * Okna czasowe pilnowane są w claim_due_digests, więc endpoint można wołać
 * co godzinę bez ryzyka duplikatów.
 */
export async function processDigests(
  frequency: "daily" | "weekly",
  limit = 50,
): Promise<{ claimed: number; sent: number }> {
  const { data: due, error } = await supabaseAdmin.rpc("claim_due_digests", {
    p_frequency: frequency,
    p_limit: limit,
  });
  if (error) throw error;
  if (!due || due.length === 0) return { claimed: 0, sent: 0 };

  const locales = await localesFor(due.map((d) => d.user_id));
  const base = siteUrl();

  let sent = 0;
  for (const row of due) {
    const items = (Array.isArray(row.items) ? row.items : []) as unknown as DigestItem[];
    if (items.length === 0) continue;
    const lang = locales.get(row.user_id) ?? "pl";
    const html = buildDigestHtml({
      displayName: row.display_name,
      items,
      lang,
      siteUrl: base,
      frequency,
    });
    const result = await sendTransactionalEmail({
      to: row.email,
      subject: digestSubject(items.length, lang, frequency),
      html,
    });
    if (!result.ok) {
      console.error("[community] digest send failed", result.error);
    }
    if (result.ok) sent += 1;
  }
  return { claimed: due.length, sent };
}

/** Fallback dla środowisk bez pg_cron: przypomnienia o wydarzeniach. */
export async function runEventReminders(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("run_event_reminders");
  if (error) throw error;
  return data ?? 0;
}
