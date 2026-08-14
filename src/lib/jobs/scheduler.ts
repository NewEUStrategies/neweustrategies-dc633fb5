// Kontrakt harmonogramu zadań tła - CZĘŚĆ CZYSTA (bez zależności serwerowych).
//
// Trzy niezależne ścieżki wołają ten sam dyspozytor i raportują do tego samego
// logu (public.job_runner_runs), więc nazwy jobów, nazwy źródeł i progi
// świeżości muszą być JEDNYM kontraktem - inaczej panel admina pokazuje
// "brak przebiegów" przy działającym cronie, bo źródło nazwało się inaczej:
//
//   1. pg_cron + pg_net -> POST /api/public/jobs-tick        (co minutę, PODSTAWOWA)
//   2. GitHub Actions   -> POST /api/public/community-cron   (co 5 min, siatka bezpieczeństwa)
//   3. panel admina     -> runSchedulerTickNow()             (ręcznie, na żądanie)
//
// Moduł jest czysty (bez importów server-only), żeby próg świeżości i parsowanie
// wejścia były testowalne bez klienta service role i żeby ten sam kod mógł
// policzyć stan w UI.
//
// Dlatego NIE leży w src/lib/server/: ochrona importów TanStacka blokuje
// `**/server/**` w środowisku klienta (build fails), a panel admina musi znać
// ten sam kontrakt co endpointy. Praca serwerowa (log przebiegów, zbrojenie
// runnera) siedzi obok, w src/lib/server/jobScheduler.server.ts.

/** Joby przyjmowane przez /api/public/community-cron (`?job=` albo body). */
export const SCHEDULER_JOBS = [
  "all",
  "push",
  "digest-daily",
  "digest-weekly",
  "event-reminders",
  "crm-task-reminders",
  // Retencja plików CV kandydatów: usuwa pliki osierocone (kreator porzucony po
  // wyborze pliku, przed wysyłką) i te po okresie retencji domkniętego procesu.
  "career-cv-retention",
] as const;

export type SchedulerJob = (typeof SCHEDULER_JOBS)[number];

/** Źródła przebiegu - muszą zgadzać się z CHECK-iem job_runner_runs.source. */
export const SCHEDULER_SOURCES = ["pg_cron", "github_actions", "external", "admin", "dev"] as const;

export type SchedulerSource = (typeof SCHEDULER_SOURCES)[number];

/**
 * Świeżość harmonogramu liczona z OSTATNIEGO UDANEGO przebiegu:
 *   fresh    - ścieżka podstawowa (co minutę) albo repo (co 5 min) odpowiada,
 *   lagging  - minutowy cron milczy, ale siatka 5-minutowa jeszcze łapie,
 *   stale    - nikt nie drenuje kolejki: push i digesty stoją,
 *   never    - żaden przebieg nigdy nie dotarł (harmonogram nieuzbrojony).
 * Progi są luźniejsze niż same interwały, bo GitHub Actions potrafi spóźnić
 * kilka minut - alarm ma znaczyć awarię, nie zwykłą kolejkę runnerów.
 */
export const SCHEDULER_FRESH_MS = 6 * 60_000;
export const SCHEDULER_LAGGING_MS = 20 * 60_000;

export type SchedulerFreshness = "fresh" | "lagging" | "stale" | "never";

export function schedulerFreshness(
  lastOkAt: string | number | Date | null | undefined,
  now: number = Date.now(),
): SchedulerFreshness {
  if (lastOkAt === null || lastOkAt === undefined || lastOkAt === "") return "never";
  const at = lastOkAt instanceof Date ? lastOkAt.getTime() : new Date(lastOkAt).getTime();
  if (!Number.isFinite(at)) return "never";
  // Zegar w przyszłości (rozjazd runnera vs baza) traktujemy jak świeży - to
  // nie jest awaria doręczeń, a alarm w tym miejscu byłby fałszywy.
  const ageMs = now - at;
  if (ageMs <= SCHEDULER_FRESH_MS) return "fresh";
  if (ageMs <= SCHEDULER_LAGGING_MS) return "lagging";
  return "stale";
}

/** Czy stan wymaga reakcji operatora (kolejka realnie stoi). */
export function isSchedulerAlarming(freshness: SchedulerFreshness): boolean {
  return freshness === "stale" || freshness === "never";
}

/** Wejście z sieci -> nazwa joba; `null` = job nieznany (400, nie ciche 'all'). */
export function parseSchedulerJob(raw: string | null | undefined): SchedulerJob | null {
  if (raw === null || raw === undefined) return "all";
  const value = raw.trim().toLowerCase();
  if (value === "") return "all";
  return (SCHEDULER_JOBS as readonly string[]).includes(value) ? (value as SchedulerJob) : null;
}

/**
 * Wejście z sieci -> nazwa źródła. Nieznane źródło NIE jest błędem (log ma
 * przyjąć każdy zewnętrzny scheduler), spada do 'external' - dokładnie jak
 * normalizacja w record_job_run(), żeby UI nie widziało dwóch prawd.
 */
export function normalizeSchedulerSource(raw: string | null | undefined): SchedulerSource {
  const value = (raw ?? "").trim().toLowerCase().replace(/-/g, "_");
  if ((SCHEDULER_SOURCES as readonly string[]).includes(value)) {
    return value as SchedulerSource;
  }
  // Popularne aliasy zewnętrznych wywołań (GitHub Actions ustawia GITHUB_*).
  if (value === "github" || value === "actions" || value === "gha") return "github_actions";
  if (value === "cron" || value === "pgcron" || value === "postgres") return "pg_cron";
  return "external";
}

/** Origin bez ścieżki i bez końcowego '/' - tylko https (cel dla crona bazy). */
export function normalizeArmOrigin(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "0.0.0.0" || host.startsWith("127.")) return null;
  return `${url.protocol}//${url.host}`;
}

/**
 * Ile jobów w wyniku ticku zgłosiło błąd. Wynik joba ma kształt
 * `{ error }` albo dane - pomijamy pominięcia (budżet czasu / cykl pracy), bo
 * to zaplanowane zachowanie, nie awaria.
 *
 * Parametr jest `object`, a nie `Record<string, unknown>`: dzięki temu
 * `JobsTickResult` (interfejs bez indeksu) wchodzi tu bez rzutowania - a to on
 * jest realnym wejściem w dyspozytorze i w panelu admina.
 */
const SKIPPED_ERRORS = new Set(["skipped_time_budget", "skipped_duty_cycle"]);

export function countTickFailures(result: object): string[] {
  const failed: string[] = [];
  for (const [job, value] of Object.entries(result)) {
    if (value === null || typeof value !== "object") continue;
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string" && !SKIPPED_ERRORS.has(error)) failed.push(`${job}: ${error}`);
  }
  return failed;
}
