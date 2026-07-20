// Wspólny "tick" zadań tła wywoływany przez /api/public/jobs-tick
// (pg_cron + pg_net co minutę) oraz - awaryjnie - przez powierzchnie admina.
//
// SQL w cronie nie może wysyłać e-maili ani push-y (potrzebuje env HTTP:
// RESEND_API_KEY / VAPID_*), więc cron jedynie PUKA po HTTP do aplikacji,
// a właściwa praca dzieje się tutaj, ograniczona budżetem na wywołanie.
// Każdy rodzaj pracy jest niezależny: błąd jednego nie blokuje pozostałych.
//
// Kanały powiadomień idą przez KANONICZNY dispatcher
// (src/lib/notifications/dispatch.server.ts - kolejka notification_push_queue,
// claim_push_jobs / claim_due_digests, przypomnienia o wydarzeniach), ten sam
// co POST /api/public/community-cron. Dzięki temu push, digesty i reminders
// działają bez zewnętrznego harmonogramu - wystarczy pg_cron z migracji
// 20260713170000. Claimy są atomowe (SKIP LOCKED), więc równoległe ticki
// z obu endpointów niczego nie dublują.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tickNewsletterCampaigns } from "@/lib/newsletter-campaigns.functions";
import {
  processDigests,
  processPushJobs,
  runEventReminders,
} from "@/lib/notifications/dispatch.server";

type DbClient = SupabaseClient<Database>;

export interface JobsTickResult {
  newsletter: { fired: number; continued: number; sent: number } | { error: string };
  push: { claimed: number; sent: number } | { error: string };
  digestDaily: { claimed: number; sent: number } | { error: string };
  digestWeekly: { claimed: number; sent: number } | { error: string };
  eventReminders: number | { error: string };
  linkCheck: { postsScanned: number; linksChecked: number; broken: number } | { error: string };
}

export async function runJobsTick(admin: DbClient): Promise<JobsTickResult> {
  let newsletter: JobsTickResult["newsletter"];
  try {
    newsletter = await tickNewsletterCampaigns(admin, {});
  } catch (err) {
    newsletter = { error: err instanceof Error ? err.message : String(err) };
  }
  let push: JobsTickResult["push"];
  try {
    push = await processPushJobs(100);
  } catch (err) {
    push = { error: err instanceof Error ? err.message : String(err) };
  }
  let digestDaily: JobsTickResult["digestDaily"];
  try {
    digestDaily = await processDigests("daily", 50);
  } catch (err) {
    digestDaily = { error: err instanceof Error ? err.message : String(err) };
  }
  let digestWeekly: JobsTickResult["digestWeekly"];
  try {
    digestWeekly = await processDigests("weekly", 50);
  } catch (err) {
    digestWeekly = { error: err instanceof Error ? err.message : String(err) };
  }
  let eventReminders: JobsTickResult["eventReminders"];
  try {
    eventReminders = await runEventReminders();
  } catch (err) {
    eventReminders = { error: err instanceof Error ? err.message : String(err) };
  }
  let linkCheck: JobsTickResult["linkCheck"];
  try {
    // Rotacyjny skan linków wychodzących (B7): 3 wpisy per tick, wpisy
    // najdawniej sprawdzone najpierw, re-skan po 7 dniach.
    const { runLinkCheckBatch } = await import("@/lib/server/linkCheck.server");
    linkCheck = await runLinkCheckBatch(admin, 3);
  } catch (err) {
    linkCheck = { error: err instanceof Error ? err.message : String(err) };
  }
  return { newsletter, push, digestDaily, digestWeekly, eventReminders, linkCheck };
}

/** Stały czas porównania sekretów (długości też nie zdradzamy wcześniej). */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
