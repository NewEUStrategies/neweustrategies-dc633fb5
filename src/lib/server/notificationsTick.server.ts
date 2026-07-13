// Przetwarzanie tła kanałów powiadomień (woła runJobsTick):
//   - push_outbox -> Web Push (VAPID) na wszystkie aktywne subskrypcje
//     odbiorcy; martwe endpointy (404/410) są dezaktywowane,
//   - claim_due_digest_users -> e-mail z nieprzeczytanymi powiadomieniami.
// Claimy są atomowe po stronie SQL (SKIP LOCKED), więc równoległe ticki
// niczego nie dublują; obie ścieżki są bezpieczne do wielokrotnego wywołania.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isWebPushConfigured, sendWebPush } from "@/lib/server/webPush.server";
import { sendTransactionalEmail } from "@/lib/server/email.server";

type DbClient = SupabaseClient<Database>;

interface PushOutboxRow {
  id: number;
  user_id: string;
  attempts: number;
  payload: {
    title?: string;
    body?: string | null;
    href?: string | null;
    icon?: string | null;
    tag?: string | null;
  };
}

interface PushSubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const PUSH_DEAD_AFTER_ATTEMPTS = 8;

export async function processPushOutbox(
  admin: DbClient,
  opts: { max?: number } = {},
): Promise<{ delivered: number; failed: number; skipped: boolean }> {
  if (!isWebPushConfigured()) return { delivered: 0, failed: 0, skipped: true };

  const { data, error } = await admin.rpc(
    "claim_push_outbox" as never,
    {
      p_limit: Math.max(1, Math.min(opts.max ?? 100, 200)),
    } as never,
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PushOutboxRow[];
  if (rows.length === 0) return { delivered: 0, failed: 0, skipped: false };

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: subsData } = await admin
    .from("push_subscriptions" as never)
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds)
    .is("disabled_at", null);
  const subsByUser = new Map<string, PushSubRow[]>();
  for (const s of (subsData ?? []) as unknown as PushSubRow[]) {
    const arr = subsByUser.get(s.user_id) ?? [];
    arr.push(s);
    subsByUser.set(s.user_id, arr);
  }

  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    const subs = subsByUser.get(row.user_id) ?? [];
    if (subs.length === 0) {
      // Subskrypcje zniknęły po zakolejkowaniu - wpis uznajemy za zamknięty.
      await admin
        .from("push_outbox" as never)
        .update({
          dead_at: new Date().toISOString(),
          last_error: "no_active_subscriptions",
        } as never)
        .eq("id", row.id);
      continue;
    }
    let anyOk = false;
    let lastError = "";
    for (const sub of subs) {
      const res = await sendWebPush(sub, row.payload);
      if (res.ok) {
        anyOk = true;
      } else if (res.gone) {
        await admin
          .from("push_subscriptions" as never)
          .update({ disabled_at: new Date().toISOString() } as never)
          .eq("id", sub.id);
      } else {
        lastError = res.error;
      }
    }
    if (anyOk) {
      delivered++;
      await admin
        .from("push_outbox" as never)
        .update({ delivered_at: new Date().toISOString(), last_error: null } as never)
        .eq("id", row.id);
    } else {
      failed++;
      // attempts podbił już claim; po przekroczeniu progu wpis umiera.
      const patch: Record<string, unknown> = { last_error: lastError || "all_endpoints_failed" };
      if (row.attempts >= PUSH_DEAD_AFTER_ATTEMPTS) patch.dead_at = new Date().toISOString();
      await admin
        .from("push_outbox" as never)
        .update(patch as never)
        .eq("id", row.id);
    }
  }
  return { delivered, failed, skipped: false };
}

interface DigestUserRow {
  user_id: string;
  email: string | null;
  frequency: string;
  since: string;
}

interface DigestNotificationRow {
  title_pl: string | null;
  title_en: string | null;
  body_pl: string | null;
  body_en: string | null;
  href: string | null;
  created_at: string;
}

function esc(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Publiczny origin do linków w digestach: konfiguracja runnera, potem env. */
async function digestOrigin(admin: DbClient): Promise<string> {
  const { data } = await admin
    .from("job_runner_settings" as never)
    .select("base_url")
    .eq("id", 1)
    .maybeSingle();
  const fromRunner = ((data ?? null) as { base_url?: string } | null)?.base_url?.trim();
  if (fromRunner) return fromRunner.replace(/\/+$/, "");
  const envUrl = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "";
  return envUrl.replace(/\/+$/, "");
}

export function buildDigestHtml(
  items: DigestNotificationRow[],
  origin: string,
): { subject: string; html: string } {
  const count = items.length;
  const subject =
    count === 1
      ? "1 nieprzeczytane powiadomienie · New European Strategies"
      : `${count} nieprzeczytanych powiadomień · New European Strategies`;
  const rows = items
    .map((n) => {
      const title = (n.title_pl ?? n.title_en ?? "").trim() || "Powiadomienie";
      const body = (n.body_pl ?? n.body_en ?? "")?.trim();
      const href = n.href ? `${origin}${n.href.startsWith("/") ? "" : "/"}${n.href}` : null;
      const titleHtml = href
        ? `<a href="${esc(href)}" style="color:#1a3a6b;text-decoration:underline">${esc(title)}</a>`
        : esc(title);
      return `<li style="margin:0 0 12px">${titleHtml}${
        body ? `<br/><span style="color:#555;font-size:13px">${esc(body)}</span>` : ""
      }</li>`;
    })
    .join("");
  const settingsHint = origin
    ? `<p style="color:#888;font-size:12px">Częstotliwość tego podsumowania zmienisz w <a href="${esc(
        origin,
      )}/profile" style="color:#888">ustawieniach powiadomień</a>.</p>`
    : "";
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px;margin:0 auto">
  <h2 style="font-size:18px">Twoje nieprzeczytane powiadomienia</h2>
  <ul style="padding-left:18px;margin:16px 0">${rows}</ul>
  ${settingsHint}
</div>`;
  return { subject, html };
}

export async function processNotificationDigests(
  admin: DbClient,
  opts: { max?: number } = {},
): Promise<{ sent: number; skipped: number }> {
  const { data, error } = await admin.rpc(
    "claim_due_digest_users" as never,
    {
      p_limit: Math.max(1, Math.min(opts.max ?? 50, 200)),
    } as never,
  );
  if (error) throw new Error(error.message);
  const users = (data ?? []) as unknown as DigestUserRow[];
  if (users.length === 0) return { sent: 0, skipped: 0 };

  const origin = await digestOrigin(admin);
  let sent = 0;
  let skipped = 0;
  for (const u of users) {
    let email = u.email?.trim() ?? "";
    if (!email) {
      // profiles.email bywa puste - ostatnia deska: konto auth.
      const { data: authUser } = await admin.auth.admin.getUserById(u.user_id);
      email = authUser?.user?.email ?? "";
    }
    if (!email) {
      skipped++;
      continue;
    }
    const { data: notifs } = await admin
      .from("notifications")
      .select("title_pl, title_en, body_pl, body_en, href, created_at")
      .eq("user_id", u.user_id)
      .is("read_at", null)
      .gt("created_at", u.since)
      .order("created_at", { ascending: false })
      .limit(20);
    const items = (notifs ?? []) as DigestNotificationRow[];
    if (items.length === 0) {
      skipped++;
      continue;
    }
    const { subject, html } = buildDigestHtml(items, origin);
    const res = await sendTransactionalEmail({ to: email, subject, html });
    if (res.ok) sent++;
    else skipped++;
  }
  return { sent, skipped };
}
