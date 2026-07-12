// Wspólny "tick" zadań tła wywoływany przez /api/public/jobs-tick
// (pg_cron + pg_net co minutę) oraz - awaryjnie - przez powierzchnie admina.
//
// SQL w cronie nie może wysyłać e-maili ani push-y (potrzebuje env HTTP:
// RESEND_API_KEY / VAPID_*), więc cron jedynie PUKA po HTTP do aplikacji,
// a właściwa praca dzieje się tutaj, ograniczona budżetem na wywołanie.
// Każdy rodzaj pracy jest niezależny: błąd jednego nie blokuje pozostałych.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tickNewsletterCampaigns } from "@/lib/newsletter-campaigns.functions";

type DbClient = SupabaseClient<Database>;

export interface JobsTickResult {
  newsletter: { fired: number; continued: number; sent: number } | { error: string };
}

export async function runJobsTick(admin: DbClient): Promise<JobsTickResult> {
  let newsletter: JobsTickResult["newsletter"];
  try {
    newsletter = await tickNewsletterCampaigns(admin, {});
  } catch (err) {
    newsletter = { error: err instanceof Error ? err.message : String(err) };
  }
  return { newsletter };
}

/** Stały czas porównania sekretów (długości też nie zdradzamy wcześniej). */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
