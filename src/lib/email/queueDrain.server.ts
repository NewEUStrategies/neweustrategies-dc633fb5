// Dren kolejek pocztowych (pgmq: auth_emails, transactional_emails).
//
// PRZYCZYNA ŹRÓDŁOWA. Cała poczta 1:1 platformy - maile autoryzacyjne,
// transakcyjne (`sendTxEmail`), digesty (`enqueueRawEmail`) - wchodzi do kolejki
// pgmq przez RPC `enqueue_email`. Konsumenta tej kolejki NIE BYŁO w repozytorium:
// migracja 20260728154925 opisuje zadanie pg_cron „process-email-queue" jako
// „applied dynamically by setup_email_infra", wskazujące na funkcję brzegową,
// której w repo nie ma. Skutek dla świeżego wdrożenia: `email_send_log` pełen
// wierszy 'pending', kolejka rosnąca w nieskończoność i po przekroczeniu TTL
// cicha wywózka wiadomości do DLQ. Potwierdzenie zapisu, ostrzeżenie o
// nieudanej płatności i link do portalu płatności nie wychodziły NIGDY, a
// nadawca nie miał o tym pojęcia, bo enqueue zwracał sukces.
//
// Ten moduł jest tym brakującym konsumentem, wpiętym w istniejący, JEDEN
// harmonogram platformy (`runJobsTick` -> pg_cron + pg_net co minutę), zamiast
// wymagać drugiego, zewnętrznego crona. Endpoint HTTP
// /lovable/email/queue/process zostaje jako druga powierzchnia dla środowisk z
// własnym harmonogramem i deleguje TUTAJ - jedna implementacja ponowień.
//
// Gwarancje:
//   * priorytet: auth_emails przed transactional_emails (link do logowania
//     starzeje się szybciej niż potwierdzenie płatności),
//   * idempotencja: przed wysyłką sprawdzamy `email_send_log` na status 'sent'
//     dla tego message_id (wyścig po wygaśnięciu VT), a unikalny indeks w bazie
//     jest ostatnim zabezpieczeniem,
//   * budżet ponowień liczony po RZECZYWISTYCH nieudanych wysyłkach
//     (`email_send_log`), nie po pgmq.read_ct - odczyt bez próby wysyłki
//     (cooldown, TTL) nie zjada budżetu,
//   * TTL: wiadomość starsza niż okno konfiguracji idzie do DLQ zamiast dowieźć
//     link do logowania po godzinie,
//   * limit tempa: 429 od dostawcy wstrzymuje CAŁĄ wysyłkę
//     (`email_send_state.retry_after_until`), nie tylko tę wiadomość,
//   * HIGIENA LISTY: adres jest sprawdzany PONOWNIE w chwili wysyłki - między
//     nadaniem a drenem mogło dojść twarde odbicie albo skarga, a wtedy
//     wysłanie tej wiadomości byłoby dokładnie tym sygnałem, którym psuje się
//     reputację domeny.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { emailProviderConfigured, sendEmail } from "./provider.server";
import { checkSendAllowed } from "./suppression.server";
import { emailCategoryForLabel, suppressionSkipReason } from "./suppressionPolicy";

type DbClient = SupabaseClient<Database>;

/** Kolejki w kolejności priorytetu obsługi. */
export const EMAIL_QUEUES = ["auth_emails", "transactional_emails"] as const;
export type EmailQueueName = (typeof EMAIL_QUEUES)[number];

const MAX_RETRIES = 5;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_SEND_DELAY_MS = 200;
const DEFAULT_TTL_MINUTES: Readonly<Record<EmailQueueName, number>> = {
  auth_emails: 15,
  transactional_emails: 60,
};
/**
 * Czas niewidzialności wiadomości po odczycie. Musi z zapasem przekraczać czas
 * jednej próby wysyłki, inaczej drugi worker podejmie tę samą wiadomość, gdy
 * pierwszy jeszcze czeka na dostawcę (przed podwójną wysyłką broni wtedy tylko
 * check idempotencji, a to wyścig, nie gwarancja).
 */
const VISIBILITY_TIMEOUT_SEC = 60;

export interface DrainOptions {
  /** Górna granica wiadomości wysłanych w jednym przebiegu (budżet ticku). */
  maxMessages?: number;
  /** Twardy deadline przebiegu; po jego przekroczeniu kończymy czysto. */
  deadlineAt?: number;
  /** Tylko wskazane kolejki (domyślnie wszystkie, w kolejności priorytetu). */
  queues?: readonly EmailQueueName[];
}

export interface DrainResult {
  sent: number;
  failed: number;
  suppressed: number;
  dlq: number;
  duplicates: number;
  /** Powód wcześniejszego zakończenia przebiegu (null = kolejki opróżnione). */
  stopped: "rate_limited" | "budget" | "deadline" | "not_configured" | null;
}

const EMPTY_RESULT: DrainResult = {
  sent: 0,
  failed: 0,
  suppressed: 0,
  dlq: 0,
  duplicates: 0,
  stopped: null,
};

interface QueueConfig {
  batchSize: number;
  sendDelayMs: number;
  ttlMinutes: Record<EmailQueueName, number>;
  cooldownUntil: number | null;
}

/** Ładunek wiadomości w kolejce - kształt pisany przez `enqueue_email`. */
interface QueuePayload {
  message_id?: unknown;
  to?: unknown;
  from?: unknown;
  sender_domain?: unknown;
  subject?: unknown;
  html?: unknown;
  text?: unknown;
  label?: unknown;
  idempotency_key?: unknown;
  unsubscribe_token?: unknown;
  unsubscribe_url?: unknown;
  run_id?: unknown;
  tenant_id?: unknown;
  queued_at?: unknown;
}

interface QueueMessage {
  msgId: number;
  readCount: number;
  enqueuedAt: string | null;
  payload: QueuePayload;
}

type RpcCallable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Rzutowanie na granicy niewygenerowanych typów RPC - trzymane w jednym miejscu. */
function rpcClient(admin: DbClient): RpcCallable {
  return admin as unknown as RpcCallable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant z ładunku kolejki, ale TYLKO jeśli jest poprawnym UUID-em.
 *
 * Bez tej walidacji zepsuta wartość dojechałaby do filtru SQL, ten wywróciłby
 * się na rzutowaniu na uuid, a odczyt listy wykluczeń jest fail-open (awaria
 * bazy nie może zamilczeć poczty) - czyli jedna literówka w ładunku wyłączałaby
 * higienę listy po cichu. Odrzucony tenant oznacza tylko jedno dodatkowe
 * zapytanie rozwiązujące adres, nie pominięcie kontroli.
 */
function payloadTenantId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConfig(admin: DbClient): Promise<QueueConfig> {
  const { data } = await admin
    .from("email_send_state")
    .select(
      "retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes",
    )
    .eq("id", 1)
    .maybeSingle();
  // Adnotacja, nie ozdoba: bez niej gałąź `{}` wchodzi do unii typu i odczyt
  // pola przestaje się kompilować. Konfiguracja jest czytana defensywnie (każde
  // pole ma wartość domyślną), bo brak wiersza singletona nie może zatrzymać
  // wysyłki - dren ma wtedy zadziałać na domyślnych limitach.
  const row: Record<string, unknown> = isRecord(data) ? data : {};
  const retryAfter = nullableText(row.retry_after_until);
  const cooldownAt = retryAfter ? Date.parse(retryAfter) : NaN;
  return {
    batchSize: Math.max(1, num(row.batch_size, DEFAULT_BATCH_SIZE)),
    sendDelayMs: Math.max(0, num(row.send_delay_ms, DEFAULT_SEND_DELAY_MS)),
    ttlMinutes: {
      auth_emails: Math.max(1, num(row.auth_email_ttl_minutes, DEFAULT_TTL_MINUTES.auth_emails)),
      transactional_emails: Math.max(
        1,
        num(row.transactional_email_ttl_minutes, DEFAULT_TTL_MINUTES.transactional_emails),
      ),
    },
    cooldownUntil: Number.isFinite(cooldownAt) ? cooldownAt : null,
  };
}

async function readBatch(
  admin: DbClient,
  queue: EmailQueueName,
  batchSize: number,
): Promise<QueueMessage[]> {
  const { data, error } = await rpcClient(admin).rpc("read_email_batch", {
    queue_name: queue,
    batch_size: batchSize,
    vt: VISIBILITY_TIMEOUT_SEC,
  });
  if (error) {
    console.error("[email-queue] read failed", queue, error.message);
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: QueueMessage[] = [];
  for (const row of data) {
    if (!isRecord(row)) continue;
    const msgId = num(row.msg_id, NaN);
    if (!Number.isFinite(msgId)) continue;
    out.push({
      msgId,
      readCount: num(row.read_ct, 0),
      enqueuedAt: nullableText(row.enqueued_at),
      payload: isRecord(row.message) ? (row.message as QueuePayload) : {},
    });
  }
  return out;
}

async function logSend(
  admin: DbClient,
  row: {
    messageId: string | null;
    label: string;
    to: string;
    status: "sent" | "failed" | "suppressed" | "dlq";
    error?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("email_send_log").insert({
    message_id: row.messageId,
    template_name: row.label,
    recipient_email: row.to,
    status: row.status,
    error_message: row.error ? row.error.slice(0, 1000) : null,
  });
  // Wysyłka już się stała - nieudany zapis logu nie może jej „odkręcić", ale
  // musi być widoczny, bo psuje raport dostarczalności.
  if (error) console.error("[email-queue] send log insert failed", row.status, error.message);
}

async function deleteMessage(admin: DbClient, queue: EmailQueueName, msgId: number): Promise<void> {
  const { error } = await rpcClient(admin).rpc("delete_email", {
    queue_name: queue,
    message_id: msgId,
  });
  if (error) console.error("[email-queue] delete failed", queue, msgId, error.message);
}

async function moveToDlq(
  admin: DbClient,
  queue: EmailQueueName,
  msg: QueueMessage,
  reason: string,
): Promise<void> {
  await logSend(admin, {
    messageId: nullableText(msg.payload.message_id),
    label: text(msg.payload.label) || queue,
    to: text(msg.payload.to),
    status: "dlq",
    error: reason,
  });
  const { error } = await rpcClient(admin).rpc("move_to_dlq", {
    source_queue: queue,
    dlq_name: `${queue}_dlq`,
    message_id: msg.msgId,
    payload: msg.payload as unknown as Record<string, unknown>,
  });
  if (error) console.error("[email-queue] dlq move failed", queue, msg.msgId, error.message);
}

/**
 * Licznik NIEUDANYCH prób wysyłki per message_id dla całej porcji (jedno
 * zapytanie zamiast N). Budżet ponowień liczymy po realnych porażkach, a nie po
 * `pgmq.read_ct`, bo odczyt zakończony pominięciem (cooldown, blokada adresu)
 * nie jest próbą wysyłki i nie może zbliżać wiadomości do DLQ.
 */
async function loadFailedAttempts(
  admin: DbClient,
  messageIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (messageIds.length === 0) return counts;
  const { data, error } = await admin
    .from("email_send_log")
    .select("message_id")
    .in("message_id", messageIds as string[])
    .eq("status", "failed");
  if (error) {
    console.error("[email-queue] failed-attempt counters unavailable", error.message);
    return counts;
  }
  for (const row of data ?? []) {
    const id = isRecord(row) ? nullableText(row.message_id) : null;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Czy inny worker zdążył już wysłać tę wiadomość (wyścig po wygaśnięciu VT). */
async function alreadySent(admin: DbClient, messageId: string): Promise<boolean> {
  const { data } = await admin
    .from("email_send_log")
    .select("id")
    .eq("message_id", messageId)
    .eq("status", "sent")
    .maybeSingle();
  return Boolean(data);
}

async function startCooldown(admin: DbClient, seconds: number): Promise<void> {
  const until = new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString();
  const { error } = await admin
    .from("email_send_state")
    .update({ retry_after_until: until, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) console.error("[email-queue] cooldown write failed", error.message);
}

/**
 * Opróżnia kolejki pocztowe w ramach budżetu wiadomości i czasu.
 *
 * Zwraca licznik skutków, nigdy nie rzuca: dren biegnie w ticku obok innych
 * zadań i awaria poczty nie może zabrać reszcie ticku jego budżetu.
 */
export async function drainEmailQueues(
  admin: DbClient,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const result: DrainResult = { ...EMPTY_RESULT };
  if (!emailProviderConfigured()) return { ...result, stopped: "not_configured" };

  const budgetTotal = Math.max(1, opts.maxMessages ?? 50);
  let budget = budgetTotal;
  const deadlineAt = opts.deadlineAt ?? null;
  const overDeadline = () => deadlineAt !== null && Date.now() > deadlineAt;

  const config = await loadConfig(admin);
  if (config.cooldownUntil !== null && config.cooldownUntil > Date.now()) {
    return { ...result, stopped: "rate_limited" };
  }

  for (const queue of opts.queues ?? EMAIL_QUEUES) {
    if (budget <= 0) {
      result.stopped ??= "budget";
      break;
    }
    if (overDeadline()) {
      result.stopped ??= "deadline";
      break;
    }

    const messages = await readBatch(admin, queue, Math.min(config.batchSize, budget));
    if (messages.length === 0) continue;

    const failedAttempts = await loadFailedAttempts(
      admin,
      Array.from(
        new Set(
          messages
            .map((msg) => nullableText(msg.payload.message_id))
            .filter((id): id is string => id !== null),
        ),
      ),
    );

    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i];
      const payload = msg.payload;
      const messageId = nullableText(payload.message_id);
      const label = text(payload.label) || queue;
      const to = text(payload.to).trim().toLowerCase();

      if (budget <= 0) {
        result.stopped ??= "budget";
        break;
      }
      if (overDeadline()) {
        result.stopped ??= "deadline";
        break;
      }

      // Wiadomość bez adresu albo bez treści nigdy nie wyjdzie - ponawianie jej
      // przez pięć cykli to tylko hałas w logu.
      if (!to || !text(payload.subject)) {
        await moveToDlq(admin, queue, msg, "invalid_payload (missing recipient or subject)");
        result.dlq += 1;
        continue;
      }

      // TTL: `queued_at` z ładunku, a gdy go nie ma - `enqueued_at` z pgmq.
      const queuedAt = nullableText(payload.queued_at) ?? msg.enqueuedAt;
      if (queuedAt) {
        const queuedMs = Date.parse(queuedAt);
        const ttlMs = config.ttlMinutes[queue] * 60_000;
        if (Number.isFinite(queuedMs) && Date.now() - queuedMs > ttlMs) {
          await moveToDlq(admin, queue, msg, `TTL exceeded (${config.ttlMinutes[queue]} minutes)`);
          result.dlq += 1;
          continue;
        }
      }

      const attempts = messageId ? (failedAttempts.get(messageId) ?? 0) : msg.readCount;
      if (attempts >= MAX_RETRIES) {
        await moveToDlq(admin, queue, msg, `Max retries (${MAX_RETRIES}) exceeded`);
        result.dlq += 1;
        continue;
      }

      if (messageId && (await alreadySent(admin, messageId))) {
        await deleteMessage(admin, queue, msg.msgId);
        result.duplicates += 1;
        continue;
      }

      // HIGIENA LISTY w chwili wysyłki. Wiadomość mogła czekać w kolejce, a w
      // tym czasie adres mógł twardo odbić albo zgłosić spam; polityka decyduje,
      // czy TA kategoria respektuje TEN powód blokady (wypis nie zatrzymuje
      // potwierdzenia płatności, skarga zatrzymuje wszystko).
      const gate = await checkSendAllowed(admin, {
        email: to,
        category: emailCategoryForLabel(label),
        tenantId: payloadTenantId(payload.tenant_id),
      });
      if (!gate.allowed) {
        await logSend(admin, {
          messageId,
          label,
          to,
          status: "suppressed",
          error: gate.hit ? suppressionSkipReason(gate.hit.reason) : "suppressed",
        });
        await deleteMessage(admin, queue, msg.msgId);
        result.suppressed += 1;
        continue;
      }

      const sendResult = await sendEmail({
        to,
        subject: text(payload.subject),
        html: text(payload.html),
        text: text(payload.text) || undefined,
        from: nullableText(payload.from) ?? undefined,
        senderDomain: nullableText(payload.sender_domain) ?? undefined,
        listUnsubscribeUrl: nullableText(payload.unsubscribe_url),
        unsubscribeToken: nullableText(payload.unsubscribe_token) ?? undefined,
        idempotencyKey: nullableText(payload.idempotency_key) ?? undefined,
        runId: nullableText(payload.run_id) ?? undefined,
        messageId: messageId ?? undefined,
        label,
        // Tagi zamykają pętlę zwrotną: webhook odbicia wraca z identyfikatorem
        // wiadomości, a te tagi mówią, do jakiego tenanta i kanału należała.
        tags: {
          ...(gate.tenantId ? { tenant: gate.tenantId } : {}),
          label: label.slice(0, 60),
          queue,
        },
      });
      budget -= 1;

      if (sendResult.ok) {
        await logSend(admin, { messageId, label, to, status: "sent" });
        await deleteMessage(admin, queue, msg.msgId);
        result.sent += 1;
      } else if (sendResult.rateLimited) {
        // Limit tempa dotyczy CAŁEGO konta nadawczego: zapisujemy próbę,
        // włączamy wspólny cooldown i kończymy przebieg. Wiadomości zostają w
        // kolejce i wrócą po wygaśnięciu VT.
        await logSend(admin, {
          messageId,
          label,
          to,
          status: "failed",
          error: sendResult.error ?? "rate_limited",
        });
        await startCooldown(admin, sendResult.retryAfterSeconds ?? 60);
        result.failed += 1;
        return { ...result, stopped: "rate_limited" };
      } else if (sendResult.permanent) {
        await moveToDlq(
          admin,
          queue,
          msg,
          sendResult.error ?? `http_${sendResult.status ?? "4xx"}`,
        );
        result.dlq += 1;
      } else {
        await logSend(admin, {
          messageId,
          label,
          to,
          status: "failed",
          error: sendResult.error ?? `http_${sendResult.status ?? "unknown"}`,
        });
        if (messageId) failedAttempts.set(messageId, attempts + 1);
        result.failed += 1;
        // Wiadomość zostaje w kolejce - wróci po wygaśnięciu VT.
      }

      // Wygładzenie tempa między wysyłkami (dostawcy liczą wiadomości na
      // sekundę); ostatnia w porcji nie musi czekać.
      if (config.sendDelayMs > 0 && i < messages.length - 1 && budget > 0) {
        await sleep(config.sendDelayMs);
      }
    }
  }

  // Wyczerpany budżet MUSI być widoczny w wyniku, nawet gdy porcja skończyła
  // się „równo": `stopped === null` znaczy dla wywołującego „kolejki puste", a
  // przy zużytym budżecie to nieprawda - w kolejce zostały wiadomości i
  // następny tick ma po nie wrócić. Bez tego rosnąca zaległość wyglądałaby jak
  // spokojnie opróżniona kolejka.
  if (budget <= 0) result.stopped ??= "budget";

  return result;
}
