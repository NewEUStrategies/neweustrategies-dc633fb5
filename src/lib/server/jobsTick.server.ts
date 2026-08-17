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
import { drainEmailQueues, type DrainResult } from "@/lib/email/queueDrain.server";
import { tickNewsletterCampaigns } from "@/lib/newsletter-campaigns.functions";
import {
  processDigests,
  processPushJobs,
  runCrmTaskReminders,
  runEventReminders,
} from "@/lib/notifications/dispatch.server";
import { countTickFailures, type SchedulerSource } from "@/lib/jobs/scheduler";
import { recordJobRun } from "@/lib/server/jobScheduler.server";

type DbClient = SupabaseClient<Database>;

export interface JobsTickResult {
  newsletter: { fired: number; continued: number; sent: number } | { error: string };
  /**
   * Dren kolejek pocztowych (auth_emails, transactional_emails). Do 20260731120000
   * konsumenta tej kolejki w repo NIE BYŁO: maile transakcyjne wchodziły do pgmq
   * i zostawały tam do przekroczenia TTL. Teraz drenuje je ten sam tick, który
   * wysyła kampanie - jeden harmonogram dla całej poczty wychodzącej.
   */
  emailQueue: DrainResult | { error: string };
  /**
   * `skipped: "vapid_not_configured"` zamiast cichego zera: brak kluczy VAPID
   * wygląda w logu identycznie jak pusta kolejka, a to najczęstsza przyczyna
   * „push nie wychodzi" przy sprawnym harmonogramie.
   */
  push: { claimed: number; sent: number; skipped?: string } | { error: string };
  digestDaily: { claimed: number; sent: number } | { error: string };
  digestWeekly: { claimed: number; sent: number } | { error: string };
  eventReminders: number | { error: string };
  crmTaskReminders: number | { error: string };
  /**
   * `archived`/`alerted`: skaner nie tylko raportuje martwe linki, ale też
   * dobiera im migawkę Internet Archive i - po przekroczeniu progu - powiadamia
   * redakcję. Oba licznikami w logu przebiegów, żeby dało się odróżnić "brak
   * zepsutych linków" od "polityka działania przestała działać".
   */
  linkCheck:
    | {
        postsScanned: number;
        linksChecked: number;
        broken: number;
        archived: number;
        alerted: number;
      }
    | { error: string };
  integrations: { claimed: number; delivered: number; failed: number } | { error: string };
  semanticIndex: { scanned: number; embedded: number; skipped?: string } | { error: string };
  /**
   * Warstwa semantyczna KATALOGU OSÓB (20260807144000). Osobne pole, nie
   * wspólny licznik z wpisami: obie kolejki mogą degradować niezależnie
   * (bramka bez embeddingów gasi obie, ale pusty katalog gasi tylko tę), a bez
   * rozdzielenia nie da się z logu odczytać, KTÓRA kolejka stoi.
   * `pruned` = wektory usunięte po opt-oucie z katalogu.
   */
  profileIndex:
    { scanned: number; embedded: number; pruned?: number; skipped?: string } | { error: string };
  /**
   * Warstwa semantyczna WĄTKÓW KLUBOWYCH. Znowu osobne pole, nie wspólny
   * licznik z profilami: tabela wektorów klubu (A6) stała pusta, bo nikt jej
   * nie karmił, i po wspólnym liczniku nie dałoby się tego odczytać z logu.
   */
  clubThreadIndex:
    { scanned: number; embedded: number; pruned?: number; skipped?: string } | { error: string };
  /**
   * Harmonogram Discussion Club (V2 §5): otwarcia grup zaplanowanych, zamknięcia
   * okien dyskusji, wygasłe kadencje ról i zaproszenia, usypianie martwych
   * tematów, odświeżenie rankingu. JEDEN job zamiast pięciu - runbook społeczności
   * opisuje jeden kanoniczny potok doręczeń, a drugi cron by go rozspoił.
   */
  clubScheduler:
    | {
        groups_opened: number;
        groups_closed: number;
        roles_expired: number;
        invitations_expired: number;
        threads_dormant: number;
        hotness_refreshed: number;
      }
    | { error: string };
}

/** Kto wywołał tick - ląduje w logu przebiegów (public.job_runner_runs). */
export interface JobsTickMeta {
  source?: SchedulerSource;
  /** Tylko tick ręczny z panelu: ślad audytowy (tenant + operator). */
  tenantId?: string | null;
  actorId?: string | null;
}

// Globalny budżet czasu jednego ticku. Joby biegną sekwencyjnie; gdy budżet się
// wyczerpie, KOLEJNE grupy są pomijane (zwracają { error: "skipped_time_budget" })
// zamiast ryzykować przekroczenie timeoutu workera i zabicie ticku w połowie.
// Wszystkie joby są idempotentne/watermarkowe, więc pominięte wracają w następnym
// ticku. Uzupełnia to re-claim dostaw integracji utkniętych w 'delivering'.
const JOBS_TICK_DEADLINE_MS = 25_000;

/**
 * Deadline drenu poczty w ramach ticku. Kolejka po awarii dostawcy potrafi mieć
 * tysiące wiadomości; bez własnego, wcześniejszego limitu jeden dren wyczerpałby
 * cały budżet ticku i zagłodził przypomnienia oraz push. Reszta kolejki wyjdzie
 * w następnej minucie - tick biegnie co minutę, a wysyłka jest idempotentna.
 */
const EMAIL_DRAIN_DEADLINE_MS = 10_000;

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

/**
 * Cykl pracy: tick biegnie co minutę (push musi być natychmiastowy), ale joby
 * kosztowne sieciowo nie mają sensu z taką częstotliwością - link-check i
 * embeddingi mielą wtedy ten sam budżet co minutę i zjadają czas potrzebny
 * na wysyłki. Bramkujemy je po minucie zegara UTC: praca jest watermarkowa,
 * więc rzadszy rytm niczego nie gubi, jedynie rozkłada koszt.
 */
export function everyNthMinute(n: number, now = new Date()): boolean {
  return now.getUTCMinutes() % n === 0;
}

export async function runJobsTick(
  admin: DbClient,
  meta: JobsTickMeta = {},
): Promise<JobsTickResult> {
  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt > JOBS_TICK_DEADLINE_MS;
  const skipped = { error: "skipped_duty_cycle" } as const;

  // Kolejność: tanie joby (DB-only) najpierw, kosztowne sieciowe (link-check,
  // integracje, embeddingi) na końcu - to one są pomijane pierwsze przy
  // wyczerpaniu budżetu, a nie krytyczne wysyłki/przypomnienia.
  const newsletter = await runJobStep(overBudget, () => tickNewsletterCampaigns(admin, {}));
  // Poczta 1:1 (autoryzacja, transakcyjne, digesty) idzie zaraz po kampaniach:
  // link do logowania i ostrzeżenie o nieudanej płatności starzeją się szybciej
  // niż cokolwiek innego w ticku. Dren dostaje własny, krótszy deadline, żeby
  // duża kolejka nie zjadła budżetu przypomnieniom i przypisaniom.
  const emailQueue = await runJobStep(overBudget, () =>
    drainEmailQueues(admin, {
      maxMessages: 60,
      deadlineAt: startedAt + EMAIL_DRAIN_DEADLINE_MS,
    }),
  );
  const push = await runJobStep(overBudget, () => processPushJobs(100));
  // Digesty mają własne okna czasowe w claim_due_digests - wystarczy zaglądać
  // co 5 minut zamiast co minutę (dwa RPC mniej na tick).
  const digestsDue = everyNthMinute(5);
  const digestDaily = digestsDue
    ? await runJobStep(overBudget, () => processDigests("daily", 50))
    : skipped;
  const digestWeekly = digestsDue
    ? await runJobStep(overBudget, () => processDigests("weekly", 50))
    : skipped;
  // Follow-upy CRM: skaner watermarkowy (run_crm_task_reminders) enqueue'uje
  // notyfikacje kind 'crm_task' + emituje crm_task.due.v1 na szynę.
  const eventReminders = await runJobStep(overBudget, () => runEventReminders());
  const crmTaskReminders = await runJobStep(overBudget, () => runCrmTaskReminders());
  // Rotacyjny skan linków wychodzących (B7): 6 wpisów co 15 minut zamiast 3 co
  // minutę - ta sama przepustowość dzienna przy ~15x mniejszym ruchu HTTP.
  const linkCheck = everyNthMinute(15)
    ? await runJobStep(overBudget, async () => {
        const { runLinkCheckBatch } = await import("@/lib/server/linkCheck.server");
        return runLinkCheckBatch(admin, 6);
      })
    : skipped;
  // Dren outboxu integracji (D2): dostawy webhooków płyną cronem.
  const integrations = await runJobStep(overBudget, async () => {
    const { runIntegrationDispatch } = await import("@/lib/integrations/dispatch.functions");
    return runIntegrationDispatch(20);
  });
  // Warstwa semantyczna wyszukiwarki: embeddingi tytuł+zajawka, co 5 minut.
  const semanticIndex = everyNthMinute(5)
    ? await runJobStep(overBudget, async () => {
        const { runSemanticIndexBatch } = await import("@/lib/server/embeddings.server");
        return runSemanticIndexBatch(admin, 24);
      })
    : skipped;
  // Wektory PROFILI: rzadziej niż wpisy (co 15 minut, partia 16), bo profil
  // zmienia się o rzędy wielkości rzadziej niż pojawia się nowa treść, a obie
  // kolejki dzielą ten sam limit bramki. Sprzątanie po opt-oucie z katalogu
  // (`prune`) jest raz na godzinę - to operacja czysto bazowa i tania.
  const profileIndex = everyNthMinute(15)
    ? await runJobStep(overBudget, async () => {
        const { runProfileSemanticIndexBatch } = await import("@/lib/server/embeddings.server");
        return runProfileSemanticIndexBatch(admin, 16, { prune: everyNthMinute(60) });
      })
    : skipped;

  // Wektory WĄTKÓW KLUBOWYCH: co 15 minut, partia 16 - ta sama kadencja co
  // profile, bo obie kolejki dzielą limit bramki embeddingów, a dyskusja
  // klubowa nie musi być przeszukiwalna semantycznie w minutę od publikacji.
  // Sprzątanie raz na godzinę (operacja czysto bazowa).
  const clubThreadIndex = everyNthMinute(15)
    ? await runJobStep(overBudget, async () => {
        const { runClubThreadIndexBatch } = await import("@/lib/server/embeddings.server");
        return runClubThreadIndexBatch(admin, 16, { prune: everyNthMinute(60) });
      })
    : skipped;

  // Harmonogram klubów: operacja czysto bazowa i tania (jeden RPC), ale nie ma
  // sensu co minutę - grupa otwierana "co do minuty" i tak czeka na najbliższy
  // tick, a kadencje ról są egzekwowane w locie przez club_effective_member_role,
  // więc ten job je tylko sprząta. Co 5 minut wystarcza.
  const clubScheduler = everyNthMinute(5)
    ? await runJobStep(overBudget, async () => {
        const { data, error } = await admin.rpc("club_scheduler_tick");
        if (error) throw error;
        const row = (data ?? {}) as Record<string, unknown>;
        const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
        return {
          groups_opened: n(row.groups_opened),
          groups_closed: n(row.groups_closed),
          roles_expired: n(row.roles_expired),
          invitations_expired: n(row.invitations_expired),
          threads_dormant: n(row.threads_dormant),
          hotness_refreshed: n(row.hotness_refreshed),
        };
      })
    : skipped;

  const result: JobsTickResult = {
    newsletter,
    emailQueue,
    push,
    digestDaily,
    digestWeekly,
    eventReminders,
    crmTaskReminders,
    linkCheck,
    integrations,
    semanticIndex,
    profileIndex,
    clubThreadIndex,
    clubScheduler,
  };

  // Heartbeat: KAŻDY tick (cron bazy, scheduler repo, ręczny z panelu) zostawia
  // wpis w public.job_runner_runs. To jedyny sposób, żeby odróżnić "kolejka
  // pusta" od "nikt nie woła dyspozytora" - pg_net jest fire-and-forget, więc
  // bez tego wpisu awaria harmonogramu jest niewidzialna. Zapis jest
  // best-effort i nie może unieważnić pracy, która już się wykonała.
  const failures = countTickFailures(result);
  await recordJobRun(
    {
      source: meta.source ?? "external",
      job: "all",
      ok: failures.length === 0,
      durationMs: Date.now() - startedAt,
      result,
      error: failures.length > 0 ? failures.join("; ") : null,
      tenantId: meta.tenantId ?? null,
      actorId: meta.actorId ?? null,
    },
    admin,
  );

  return result;
}

/** Stały czas porównania sekretów (długości też nie zdradzamy wcześniej). */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
