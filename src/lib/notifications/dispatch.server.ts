// Dispatcher kanałów powiadomień (service role): web push + digest e-mail.
// Wołany przez /api/public/community-cron (sekret w nagłówku) - Postgres
// przygotowuje pracę (kolejka push, claim digestów), tu odbywa się wyłącznie
// I/O HTTP: usługi push przeglądarek i gateway Resend (jak newsletter).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mapWithConcurrency } from "@/lib/async/pool";
import { sendTransactionalEmail } from "@/lib/server/email.server";
import {
  clampPushPayload,
  encodePushPayload,
  pushTopic,
  sendWebPush,
  vapidFromEnv,
  type VapidConfig,
} from "./webpush.server";
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

interface PushDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Jedna wysyłka: gotowe (zserializowane raz na zadanie) ciało + temat kolapsu. */
interface PushTask {
  jobId: number;
  body: Buffer;
  topic: string;
}

/** Kolejka JEDNEGO urządzenia - wysyłki w niej idą po kolei, kolejki równolegle. */
interface PushLane {
  device: PushDevice;
  tasks: PushTask[];
}

interface PushAttempt {
  jobId: number;
  ok: boolean;
  gone: boolean;
  permanent: boolean;
}

interface LaneResult {
  endpoint: string;
  gone: boolean;
  attempts: PushAttempt[];
}

/** Marka jako awaryjny tytuł, gdy powiadomienie nie ma tytułu w żadnym języku. */
const PUSH_TITLE_FALLBACK = "New European Strategies";
/**
 * Ile urządzeń obsługujemy naraz. Partia to do 200 zadań x N urządzeń, a jedna
 * wysyłka to round-trip HTTPS (~100-200 ms), więc sekwencyjnie cała partia nie
 * mieściła się w 25-sekundowym budżecie ticku (jobsTick.server.ts) - reszta
 * wracała do kolejki z backoffem, czyli push spóźniał się minutami.
 */
const PUSH_CONCURRENCY = 8;
/** Równoległość raportów do DB (tanie RPC, ale nie 200 na raz). */
const REPORT_CONCURRENCY = 12;

/**
 * Buduje kolejki wysyłek per urządzenie. Grupowanie po endpoincie (nie po
 * zadaniu) daje dwie rzeczy naraz: pełną równoległość między urządzeniami ORAZ
 * zachowaną kolejność powiadomień na jednym urządzeniu - a przy martwym
 * endpoincie pozwala pominąć resztę jego kolejki bez ruchu sieciowego.
 */
function buildPushLanes(
  jobs: readonly { id: number; user_id: string; tenant_id: string; payload: unknown }[],
  devicesByRecipient: ReadonlyMap<string, PushDevice[]>,
  locales: ReadonlyMap<string, DigestLang>,
): { lanes: PushLane[]; deviceCountByJob: Map<number, number> } {
  const lanes = new Map<string, PushLane>();
  const deviceCountByJob = new Map<number, number>();

  for (const job of jobs) {
    const devices = devicesByRecipient.get(recipientKey(job.tenant_id, job.user_id)) ?? [];
    deviceCountByJob.set(job.id, devices.length);
    if (devices.length === 0) continue;

    const payload = (job.payload ?? {}) as PushJobPayload;
    const lang = locales.get(job.user_id) ?? "pl";
    const title =
      pickDigestText(
        { title_pl: payload.title_pl ?? null, title_en: payload.title_en ?? null },
        lang,
      ) || PUSH_TITLE_FALLBACK;
    const body =
      (lang === "en"
        ? (payload.body_en ?? payload.body_pl)
        : (payload.body_pl ?? payload.body_en)) ?? "";
    const href = payload.href ?? "/";
    // Temat = (rodzaj, cel): druga wiadomość w tej samej rozmowie zastępuje
    // pierwszą zamiast piętrzyć stos powiadomień systemowych, a usługa push
    // kolapsuje też to, co nie doszło do urządzenia offline (RFC 8030 sek. 5.4).
    const topic = pushTopic(payload.kind ?? "notification", href);
    // Serializacja i przycięcie do budżetu 3993 B RAZ na zadanie; per
    // urządzenie zostaje wyłącznie szyfrowanie (klucze są per subskrypcja).
    const encoded = encodePushPayload(clampPushPayload({ title, body, href, lang, tag: topic }));

    for (const device of devices) {
      const lane = lanes.get(device.endpoint) ?? { device, tasks: [] };
      lane.tasks.push({ jobId: job.id, body: encoded, topic });
      lanes.set(device.endpoint, lane);
    }
  }

  return { lanes: [...lanes.values()], deviceCountByJob };
}

/** Wysyła kolejkę jednego urządzenia po kolei; 404/410 ucina resztę kolejki. */
async function drainPushLane(lane: PushLane, vapid: VapidConfig): Promise<LaneResult> {
  const attempts: PushAttempt[] = [];
  let gone = false;

  for (let i = 0; i < lane.tasks.length; i += 1) {
    const task = lane.tasks[i];
    try {
      const result = await sendWebPush(lane.device, task.body, vapid, { topic: task.topic });
      attempts.push({
        jobId: task.jobId,
        ok: result.ok,
        gone: result.gone,
        permanent: result.permanent,
      });
      if (result.retryAfterSec !== null) {
        console.warn(
          `[community] push throttled (${result.status}), retry-after ${result.retryAfterSec}s`,
        );
      }
      if (result.gone) {
        gone = true;
        // Urządzenie odsubskrybowało - reszta kolejki dostałaby to samo 410,
        // więc odhaczamy ją bez ruchu sieciowego.
        for (const skipped of lane.tasks.slice(i + 1)) {
          attempts.push({ jobId: skipped.jobId, ok: false, gone: true, permanent: false });
        }
        break;
      }
    } catch (err) {
      console.error("[community] push send error", err);
      attempts.push({ jobId: task.jobId, ok: false, gone: false, permanent: false });
    }
  }

  return { endpoint: lane.device.endpoint, gone, attempts };
}

/** Klucz adresata: powiadomienie tenanta A nigdy nie idzie na urządzenie tenanta B. */
function recipientKey(tenantId: string, userId: string): string {
  return `${tenantId}|${userId}`;
}

/**
 * Zdejmuje partię zadań push i wysyła do WSZYSTKICH żywych subskrypcji
 * odbiorcy W TYM TENANCIE. Zadanie jest 'sent', gdy dotarło do >=1 endpointu;
 * 'dead', gdy odbiorca nie ma już żadnej żywej subskrypcji albo żądanie nigdy
 * nie przejdzie (413/400). Endpointy 404/410 są trwale oznaczane
 * (mark_push_subscription_failed) - jednym RPC na endpoint, nie na zadanie.
 */
export async function processPushJobs(limit = 100): Promise<{ claimed: number; sent: number }> {
  const vapid = vapidFromEnv();
  if (!vapid) return { claimed: 0, sent: 0 };

  const { data: jobs, error } = await supabaseAdmin.rpc("claim_push_jobs", { p_limit: limit });
  if (error) throw error;
  if (!jobs || jobs.length === 0) return { claimed: 0, sent: 0 };

  const userIds = [...new Set(jobs.map((j) => j.user_id))];
  const tenantIds = [...new Set(jobs.map((j) => j.tenant_id))];
  const [{ data: subs }, locales] = await Promise.all([
    // Rola serwisowa omija RLS, więc filtr tenanta MUSI być tutaj: bez niego
    // to samo konto zapisane na dwóch domenach dostaje powiadomienia obcego
    // tenanta (href rozwiązałby się względem złej domeny w service workerze).
    supabaseAdmin
      .from("push_subscriptions")
      .select("tenant_id, user_id, endpoint, p256dh, auth")
      .in("tenant_id", tenantIds)
      .in("user_id", userIds)
      .is("failed_at", null),
    localesFor(userIds),
  ]);

  const devicesByRecipient = new Map<string, PushDevice[]>();
  for (const sub of subs ?? []) {
    const key = recipientKey(sub.tenant_id, sub.user_id);
    const list = devicesByRecipient.get(key) ?? [];
    list.push({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
    devicesByRecipient.set(key, list);
  }

  const { lanes, deviceCountByJob } = buildPushLanes(jobs, devicesByRecipient, locales);
  const laneResults = await mapWithConcurrency(lanes, PUSH_CONCURRENCY, (lane) =>
    drainPushLane(lane, vapid),
  );

  // Agregacja per zadanie: dostarczenie na jakiekolwiek urządzenie wygrywa;
  // dead tylko gdy nic nie doszło i (payload nieprzechodzący albo wszystkie
  // urządzenia odpadły).
  const tally = new Map<number, { ok: boolean; gone: number; permanent: boolean }>();
  for (const lane of laneResults) {
    for (const attempt of lane.attempts) {
      const entry = tally.get(attempt.jobId) ?? { ok: false, gone: 0, permanent: false };
      entry.ok = entry.ok || attempt.ok;
      entry.gone += attempt.gone ? 1 : 0;
      entry.permanent = entry.permanent || attempt.permanent;
      tally.set(attempt.jobId, entry);
    }
  }

  const reports = jobs.map((job) => {
    const entry = tally.get(job.id);
    const devices = deviceCountByJob.get(job.id) ?? 0;
    const allGone = devices > 0 && (entry?.gone ?? 0) >= devices;
    const ok = entry?.ok ?? false;
    return {
      p_id: job.id,
      p_ok: ok,
      p_dead: !ok && (devices === 0 || allGone || !!entry?.permanent),
    };
  });

  // Błąd JEDNEGO raportu nie może zabrać reszty partii: zadania zostałyby w
  // 'pending' i poszłyby ponownie, czyli odbiorca dostałby duplikat pusha.
  const deadEndpoints = laneResults.filter((lane) => lane.gone).map((lane) => lane.endpoint);
  await mapWithConcurrency(deadEndpoints, REPORT_CONCURRENCY, async (endpoint) => {
    try {
      const { error: rpcError } = await supabaseAdmin.rpc("mark_push_subscription_failed", {
        p_endpoint: endpoint,
      });
      if (rpcError) throw rpcError;
    } catch (err) {
      console.error("[community] mark_push_subscription_failed", err);
    }
  });
  await mapWithConcurrency(reports, REPORT_CONCURRENCY, async (report) => {
    try {
      const { error: rpcError } = await supabaseAdmin.rpc("report_push_job", report);
      if (rpcError) throw rpcError;
    } catch (err) {
      console.error("[community] report_push_job", err);
    }
  });

  return { claimed: jobs.length, sent: reports.filter((r) => r.p_ok).length };
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

/** Fallback dla środowisk bez pg_cron: przypomnienia o follow-upach CRM. */
export async function runCrmTaskReminders(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("run_crm_task_reminders");
  if (error) throw error;
  return data ?? 0;
}
