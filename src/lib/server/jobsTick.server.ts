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
  runCrmTaskReminders,
  runEventReminders,
} from "@/lib/notifications/dispatch.server";

type DbClient = SupabaseClient<Database>;

export interface JobsTickResult {
  newsletter: { fired: number; continued: number; sent: number } | { error: string };
  push: { claimed: number; sent: number } | { error: string };
  digestDaily: { claimed: number; sent: number } | { error: string };
  digestWeekly: { claimed: number; sent: number } | { error: string };
  eventReminders: number | { error: string };
  crmTaskReminders: number | { error: string };
  linkCheck: { postsScanned: number; linksChecked: number; broken: number } | { error: string };
  integrations: { claimed: number; delivered: number; failed: number } | { error: string };
  semanticIndex: { scanned: number; embedded: number; skipped?: string } | { error: string };
}

// Globalny budżet czasu jednego ticku. Joby biegną sekwencyjnie; gdy budżet się
// wyczerpie, KOLEJNE grupy są pomijane (zwracają { error: "skipped_time_budget" })
// zamiast ryzykować przekroczenie timeoutu workera i zabicie ticku w połowie.
// Wszystkie joby są idempotentne/watermarkowe, więc pominięte wracają w następnym
// ticku. Uzupełnia to re-claim dostaw integracji utkniętych w 'delivering'.
const JOBS_TICK_DEADLINE_MS = 25_000;

/** Uruchamia krok joba tylko w ramach budżetu czasu; błąd/pominięcie łapie w
 *  wspólnym kształcie `{ error }` (każde pole JobsTickResult go dopuszcza). */
async function runJobStep<T>(
  overBudget: () => boolean,
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  if (overBudget()) return { error: "skipped_time_budget" };
  try {
    return await fn();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runJobsTick(admin: DbClient): Promise<JobsTickResult> {
  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt > JOBS_TICK_DEADLINE_MS;

  // Kolejność: tanie joby (DB-only) najpierw, kosztowne sieciowe (link-check,
  // integracje, embeddingi) na końcu - to one są pomijane pierwsze przy
  // wyczerpaniu budżetu, a nie krytyczne wysyłki/przypomnienia.
  const newsletter = await runJobStep(overBudget, () => tickNewsletterCampaigns(admin, {}));
  const push = await runJobStep(overBudget, () => processPushJobs(100));
  const digestDaily = await runJobStep(overBudget, () => processDigests("daily", 50));
  const digestWeekly = await runJobStep(overBudget, () => processDigests("weekly", 50));
  // Follow-upy CRM: skaner watermarkowy (run_crm_task_reminders) enqueue'uje
  // notyfikacje kind 'crm_task' + emituje crm_task.due.v1 na szynę.
  const eventReminders = await runJobStep(overBudget, () => runEventReminders());
  const crmTaskReminders = await runJobStep(overBudget, () => runCrmTaskReminders());
  // Rotacyjny skan linków wychodzących (B7): 3 wpisy per tick.
  const linkCheck = await runJobStep(overBudget, async () => {
    const { runLinkCheckBatch } = await import("@/lib/server/linkCheck.server");
    return runLinkCheckBatch(admin, 3);
  });
  // Dren outboxu integracji (D2): dostawy webhooków płyną cronem.
  const integrations = await runJobStep(overBudget, async () => {
    const { runIntegrationDispatch } = await import("@/lib/integrations/dispatch.functions");
    return runIntegrationDispatch(20);
  });
  // Warstwa semantyczna wyszukiwarki: embeddingi tytuł+zajawka (24 per tick).
  const semanticIndex = await runJobStep(overBudget, async () => {
    const { runSemanticIndexBatch } = await import("@/lib/server/embeddings.server");
    return runSemanticIndexBatch(admin, 24);
  });

  return {
    newsletter,
    push,
    digestDaily,
    digestWeekly,
    eventReminders,
    crmTaskReminders,
    linkCheck,
    integrations,
    semanticIndex,
  };
}

/** Stały czas porównania sekretów (długości też nie zdradzamy wcześniej). */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
