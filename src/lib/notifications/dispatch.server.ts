// Dispatcher kanałów powiadomień (service role): web push + digest e-mail.
// Wołany przez /api/public/community-cron (sekret w nagłówku) - Postgres
// przygotowuje pracę (kolejka push, claim digestów), tu odbywa się wyłącznie
// I/O HTTP: usługi push przeglądarek i gateway Resend (jak newsletter).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mapWithConcurrency } from "@/lib/async/pool";
import { enqueueRawEmail } from "@/lib/email/transactional.server";
import {
  clampPushPayload,
  encodePushPayload,
  pushTopic,
  sendWebPush,
  vapidFromEnv,
  type PushSendOptions,
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

interface RecipientProfile {
  lang: DigestLang;
  /** Tenant odbiorcy - wymagany, by digest przeszedł przez listę wykluczeń. */
  tenantId: string | null;
}

/**
 * Profil odbiorcy potrzebny do wysyłki: język (profiles.prefs->>'locale',
 * domyślnie pl) i tenant. Jedno zapytanie na paczkę - tenant jest tu po to,
 * żeby digest nie omijał listy wykluczeń (adres po twardym odbiciu nie może
 * dostawać kolejnych wiadomości tylko dlatego, że to inny kanał).
 */
async function recipientsFor(userIds: string[]): Promise<Map<string, RecipientProfile>> {
  const map = new Map<string, RecipientProfile>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, prefs, tenant_id")
    .in("id", userIds);
  // Profil niesie wyłącznie język i tenant, więc jego awaria degraduje do
  // języka domyślnego zamiast przerywać wysyłkę. Rzucenie byłoby tu gorsze od
  // błędu: digest jest już ostemplowany przez claim_due_digests
  // (digest_last_sent_at), więc wyjątek po claimie zgubiłby całe jego okno.
  // Degradacja jest jednak GŁOŚNA - pusty wynik bez logu wyglądał dokładnie
  // jak "nikt nie ustawił języka".
  if (error) {
    console.error("[community] odczyt profili odbiorców nie powiódł się - język domyślny", error);
  }
  for (const row of data ?? []) {
    const prefs = (row.prefs ?? {}) as Record<string, unknown>;
    map.set(row.id, {
      lang: prefs.locale === "en" ? "en" : "pl",
      tenantId: row.tenant_id ?? null,
    });
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

/** Jedna wysyłka: gotowe (zserializowane raz na zadanie) ciało + opcje (temat kolapsu, TTL). */
interface PushTask {
  jobId: number;
  body: Buffer;
  options: PushSendOptions;
}

/**
 * Push rodzaju `event` (przypomnienia o wydarzeniu i sesji, oferta miejsca):
 * godzina życia zamiast doby i pilność `high`. Przypomnienie „sesja za 15 minut"
 * dostarczone po trzech godzinach offline jest szkodliwe, nie pomocne - usługa
 * push ma je raczej porzucić niż doręczyć po czasie (D8).
 */
const EVENT_PUSH_OPTIONS: Readonly<Pick<PushSendOptions, "ttlSec" | "urgency">> = {
  ttlSec: 3600,
  urgency: "high",
};

function pushOptionsForKind(kind: string | undefined): Pick<PushSendOptions, "ttlSec" | "urgency"> {
  return kind === "event" ? EVENT_PUSH_OPTIONS : {};
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

    const options: PushSendOptions = { topic, ...pushOptionsForKind(payload.kind) };

    for (const device of devices) {
      const lane = lanes.get(device.endpoint) ?? { device, tasks: [] };
      lane.tasks.push({ jobId: job.id, body: encoded, options });
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
      const result = await sendWebPush(lane.device, task.body, vapid, task.options);
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

/** Wynik jednego zadania - kształt elementu `p_reports` w report_push_jobs. */
interface PushJobReport {
  id: number;
  ok: boolean;
  dead: boolean;
}

/**
 * Finalizuje partię JEDNYM RPC (report_push_jobs, migracja 20261002190300)
 * zamiast round-tripu na zadanie: przy partii 100 zadań to było 100 żądań
 * PostgREST na każdy tick, w falach po REPORT_CONCURRENCY.
 *
 * Raport per zadanie zostaje jako siatka, bo błąd raportu nie może zabrać
 * partii: zadanie bez raportu zostaje w 'pending' i idzie ponownie, czyli
 * odbiorca dostaje duplikat pusha. Zbiorcze RPC to jedna instrukcja UPDATE
 * (wszystko albo nic), więc po jego błędzie przechodzimy na raport per
 * zadanie, gdzie awaria jednego wiersza nie dotyka reszty. Ta sama siatka
 * pokrywa okno wdrożenia, w którym kod wyprzedza migrację (PGRST202).
 * Powtórzenie raportu po wywołaniu zbiorczym, które jednak doszło (zerwana
 * odpowiedź), jest nieszkodliwe: ten sam raport daje ten sam status.
 */
async function reportPushJobs(reports: readonly PushJobReport[]): Promise<void> {
  if (reports.length === 0) return;
  try {
    const { error } = await supabaseAdmin.rpc("report_push_jobs", {
      // Kopia literałem, nie `reports` wprost: interfejs nie ma niejawnej
      // sygnatury indeksu, więc nie pasuje do `Json` z wygenerowanych typów.
      p_reports: reports.map(({ id, ok, dead }) => ({ id, ok, dead })),
    });
    if (error) throw error;
    return;
  } catch (err) {
    console.error("[community] report_push_jobs - przejście na raport per zadanie", err);
  }
  await mapWithConcurrency(reports, REPORT_CONCURRENCY, async (report) => {
    try {
      const { error } = await supabaseAdmin.rpc("report_push_job", {
        p_id: report.id,
        p_ok: report.ok,
        p_dead: report.dead,
      });
      if (error) throw error;
    } catch (err) {
      console.error("[community] report_push_job", err);
    }
  });
}

/**
 * Zdejmuje partię zadań push i wysyła do WSZYSTKICH żywych subskrypcji
 * odbiorcy W TYM TENANCIE. Zadanie jest 'sent', gdy dotarło do >=1 endpointu;
 * 'dead', gdy odbiorca nie ma już żadnej żywej subskrypcji albo żądanie nigdy
 * nie przejdzie (413/400). Endpointy 404/410 są trwale oznaczane
 * (mark_push_subscription_failed) - jednym RPC na endpoint, nie na zadanie.
 * Błąd odczytu subskrypcji rzuca BEZ raportu: zajęta partia wraca do kolejki
 * z backoffem claimu, zamiast umrzeć jako "odbiorca bez urządzeń".
 */
export async function processPushJobs(
  limit = 100,
): Promise<{ claimed: number; sent: number; skipped?: "vapid_not_configured" }> {
  const vapid = vapidFromEnv();
  // Brak kluczy VAPID wygląda w logu identycznie jak pusta kolejka - a to
  // najczęstsza przyczyna "push nie wychodzi" przy poprawnym harmonogramie.
  // Nazywamy pominięcie wprost, żeby panel i scheduler repo mogły to pokazać.
  if (!vapid) {
    console.warn("[community] push pominięty: brak VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY");
    return { claimed: 0, sent: 0, skipped: "vapid_not_configured" };
  }

  const { data: jobs, error } = await supabaseAdmin.rpc("claim_push_jobs", { p_limit: limit });
  if (error) throw error;
  if (!jobs || jobs.length === 0) return { claimed: 0, sent: 0 };

  const userIds = [...new Set(jobs.map((j) => j.user_id))];
  const tenantIds = [...new Set(jobs.map((j) => j.tenant_id))];
  const [{ data: subs, error: subsError }, recipients] = await Promise.all([
    supabaseAdmin
      .from("push_subscriptions")
      .select("tenant_id, user_id, endpoint, p256dh, auth")
      .in("tenant_id", tenantIds)
      .in("user_id", userIds)
      .is("failed_at", null),
    recipientsFor(userIds),
  ]);

  // Błąd odczytu urządzeń NIE jest "brakiem urządzeń". `subs ?? []` zamieniało
  // go w pustą listę, więc każde zadanie partii wyglądało jak odbiorca bez
  // żywej subskrypcji i szło w 'dead' (devices === 0) - cała zajęta partia
  // przepadała bez jednej próby wysyłki. Dlatego NIE raportujemy niczego:
  // claim_push_jobs przesunął już next_attempt_at (to jest dzierżawa), więc
  // zadania bez raportu wracają do kolejki z backoffem - ta sama ścieżka, co
  // crash dyspozytora.
  //
  // Koszt jest jawny: claim podbił też `attempts`, więc nieudany odczyt zużywa
  // próbę z budżetu 8 i wydłuża backoff (aż do 64 min). Awaria dłuższa niż
  // ~2 h (1+2+...+64 min) zostawia zadania z wyczerpanym budżetem - po
  // powrocie dostają jedną realną próbę, a pierwsza porażka przechodnia daje
  // 'dead'. Próby NIE oddajemy osobnym RPC, bo przyrost `attempts` jest
  // jedynym hamulcem kolejki: claim bierze najstarsze id, a backoff liczy się
  // z `attempts`. Partia, której odczyt pada z powodu samej partii (np. długość
  // filtra IN), a nie całej bazy, po zwrocie próby wracałaby co minutę na
  // czoło kolejki i głodziła nowsze zadania. Push jest kanałem ulotnym
  // (powiadomienie in-app zostaje), więc ~2-godzinne okno życia to właściwa
  // granica, a nie strata do odrobienia.
  //
  // Rzucamy, bo taki jest kontrakt wołających (runJobStep w jobsTick, step w
  // community-cron): błąd ląduje w logu przebiegów, a scheduler świeci
  // czerwono z konkretną przyczyną.
  if (subsError) {
    console.error("[community] push: odczyt push_subscriptions nie powiódł się", subsError);
    throw new Error(
      `push_subscriptions: ${subsError.message} - zadania wracają do kolejki bez raportu ` +
        `(liczba zadań: ${jobs.length})`,
    );
  }

  const devicesByRecipient = new Map<string, PushDevice[]>();
  for (const sub of subs ?? []) {
    const key = recipientKey(sub.tenant_id, sub.user_id);
    const list = devicesByRecipient.get(key) ?? [];
    list.push({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
    devicesByRecipient.set(key, list);
  }

  const locales = new Map<string, DigestLang>();
  for (const [uid, prof] of recipients) locales.set(uid, prof.lang);

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

  const reports = jobs.map((job): PushJobReport => {
    const entry = tally.get(job.id);
    const devices = deviceCountByJob.get(job.id) ?? 0;
    const allGone = devices > 0 && (entry?.gone ?? 0) >= devices;
    const ok = entry?.ok ?? false;
    return {
      id: job.id,
      ok,
      dead: !ok && (devices === 0 || allGone || !!entry?.permanent),
    };
  });

  // TRIPWIRE KONTRAKTU. Zadanie trafia do kolejki WYŁĄCZNIE wtedy, gdy trigger
  // tg_notifications_enqueue_push zobaczył żywą subskrypcję odbiorcy - więc
  // zero urządzeń po stronie dyspozytora nie jest stanem normalnym, tylko
  // dowodem, że obie połowy kontraktu rozeszły się co do klucza adresata
  // (tenant_id, user_id). Taki wiersz idzie w 'dead' bez ani jednej próby
  // wysyłki, czyli w logu wygląda identycznie jak pusta kolejka - dokładnie ten
  // sam rodzaj niemej awarii, co brak kluczy VAPID wyżej. Nazywamy go wprost.
  const orphaned = jobs.filter((job) => (deviceCountByJob.get(job.id) ?? 0) === 0);
  if (orphaned.length > 0) {
    const keys = [...new Set(orphaned.map((job) => recipientKey(job.tenant_id, job.user_id)))];
    console.warn(
      `[community] push: zadania bez ani jednego urzadzenia (liczba: ${orphaned.length}; ` +
        `kolejka widziala subskrypcje, dyspozytor nie) - klucze tenant|user: ${keys.join(", ")}`,
    );
  }

  // Oznaczenie martwych endpointów i finalizacja zadań dotyczą różnych tabel i
  // są best-effort, więc idą równolegle zamiast jedno po drugim.
  const deadEndpoints = laneResults.filter((lane) => lane.gone).map((lane) => lane.endpoint);
  await Promise.all([
    mapWithConcurrency(deadEndpoints, REPORT_CONCURRENCY, async (endpoint) => {
      try {
        const { error: rpcError } = await supabaseAdmin.rpc("mark_push_subscription_failed", {
          p_endpoint: endpoint,
        });
        if (rpcError) throw rpcError;
      } catch (err) {
        console.error("[community] mark_push_subscription_failed", err);
      }
    }),
    reportPushJobs(reports),
  ]);

  return { claimed: jobs.length, sent: reports.filter((r) => r.ok).length };
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

  const recipients = await recipientsFor(due.map((d) => d.user_id));
  const base = siteUrl();

  let sent = 0;
  for (const row of due) {
    const claimedItems = (Array.isArray(row.items) ? row.items : []) as unknown as DigestItem[];
    // Rodzaj `event` NIE trafia do digestu (D8): przypomnienie o sesji
    // w zbiorczym mailu następnego dnia jest po czasie z definicji. Digest,
    // w którym zostały same przypomnienia, nie wychodzi wcale.
    const items = claimedItems.filter((item) => item.kind !== "event");
    if (items.length === 0) continue;
    const recipient = recipients.get(row.user_id);
    const lang = recipient?.lang ?? "pl";
    const html = buildDigestHtml({
      displayName: row.display_name,
      items,
      lang,
      siteUrl: base,
      frequency,
    });
    // Digest idzie tą samą kolejką NES co maile transakcyjne/autoryzacyjne:
    // jeden nadawca (noreply@neweuropeanstrategies.com), jedna lista wykluczeń
    // i jeden log dostarczalności (email_send_log) zamiast osobnej ścieżki.
    const window = new Date().toISOString().slice(0, 10);
    const result = await enqueueRawEmail({
      to: row.email,
      subject: digestSubject(items.length, lang, frequency),
      html,
      label: `digest_${frequency}`,
      idempotencyKey: `digest:${frequency}:${row.user_id}:${window}`,
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
