// Wykonanie zdarzenia operatora płatności - JEDEN rdzeń dla czterech wejść:
//   * trasa `/api/public/payments/webhook` (dostawa na żywo),
//   * ponowienie z panelu admina (`webhookRetry.functions`),
//   * naprawa z uzgadniania (`reconcile.server`),
//   * automatyczna zamiatarka (`sweepWebhookEvents` - tick zadań co 5 minut
//     i dobowy `billing-cron` jako siatka bezpieczeństwa).
//
// Każde wejście najpierw REZERWUJE wiersz dziennika tym samym
// porównaj-i-zamień (`webhookLog.server`), a dopiero potem woła rdzeń. Rdzeń
// przekazuje identyfikator zdarzenia do dyspozytora (strażnik kolejności
// subskrypcji rozpoznaje po nim powtórkę TEGO SAMEGO zdarzenia) i zawsze
// domyka wiersz - także porażką, żeby zamiatarka i panel widziały, co ponowić.
//
// DLACZEGO ZAMIATARKA. Operator ponawia dostawę tylko przez ~3 doby, a dwie
// klasy wierszy nie mają po stronie operatora nikogo, kto by je ponowił:
// zdarzenia z naprawy (`reconcile_*`) i wiersze, których domknięcie nie
// doszło do bazy. Do tej pory `failed` i porzucone `received` czekały na
// człowieka z rolą `super_admin` - a klient, który zapłacił, czekał bez
// uprawnienia.
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import type { StripeEnv, VerifiedWebhookEvent } from "@/lib/stripe.server";
import {
  STUCK_AFTER_MS,
  finishWebhookEvent,
  isAbandonedClaim,
  reclaimWebhookEventRow,
  type WebhookEventClaimRow,
  type WebhookEventTarget,
} from "@/lib/billing/webhookLog.server";

/** Zdarzenie po normalizacji - kształt, którego oczekuje dyspozytor. */
export interface NormalizedWebhookEvent {
  eventType: string;
  data: unknown;
}

/** Zdarzenie, którego wiersz dziennika wołający już PRZEJĄŁ (`claimed`). */
export interface ClaimedWebhookEvent {
  eventId: string;
  environment: StripeEnv;
  occurredAt: string;
  /** `null` = zdarzenie spoza zakresu integracji - domykamy je jako `skipped`. */
  normalized: NormalizedWebhookEvent | null;
  /** Zakres najemcy domknięcia (ścieżki biegnące w imieniu admina). */
  tenantId?: string;
}

export interface WebhookReplayOutcome {
  status: "processed" | "skipped" | "failed";
  error: string | null;
  durationMs: number;
}

/**
 * Obsługa przejętego zdarzenia i domknięcie jego wiersza. NIGDY nie rzuca:
 * porażka obsługi wraca jako `failed` z komunikatem (i ląduje w dzienniku),
 * a decyzję o odpowiedzi podejmuje wołający (trasa: 500, panel: komunikat,
 * zamiatarka: kolejna próba z odstępem).
 */
export async function processClaimedWebhookEvent(
  event: ClaimedWebhookEvent,
): Promise<WebhookReplayOutcome> {
  const target: WebhookEventTarget = {
    eventId: event.eventId,
    environment: event.environment,
    ...(event.tenantId !== undefined ? { tenantId: event.tenantId } : {}),
  };
  const startedAt = Date.now();

  if (!event.normalized) {
    // Zdarzenie spoza zakresu integracji (np. sesja "unpaid" albo typ, którego
    // nie obsługujemy) - domykamy, żeby nikt go nie ponawiał w kółko.
    const durationMs = Date.now() - startedAt;
    await finishWebhookEvent(target, "skipped", { durationMs });
    return { status: "skipped", error: null, durationMs };
  }

  try {
    const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
    const outcome = await dispatchWebhookEvent({
      // Ten sam identyfikator przy każdej powtórce (dostawa, panel, zamiatarka)
      // - strażnik kolejności subskrypcji rozpoznaje po nim TO SAMO zdarzenie.
      eventId: event.eventId,
      eventType: event.normalized.eventType,
      data: event.normalized.data,
      environment: event.environment,
      occurredAt: event.occurredAt,
    });
    const status = outcome === "processed" ? "processed" : "skipped";
    const durationMs = Date.now() - startedAt;
    await finishWebhookEvent(target, status, { durationMs });
    return { status, error: null, durationMs };
  } catch (err) {
    // Identyfikator w logu: przy zamiatarce i panelu nie ma żądania HTTP,
    // po którym dałoby się skojarzyć wyjątek ze zdarzeniem.
    console.error("[payments] webhook error", event.eventId, err);
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startedAt;
    await finishWebhookEvent(target, "failed", { error: message, durationMs });
    return { status: "failed", error: message, durationMs };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rozpoznaje SUROWE zdarzenie operatora zapisane w dzienniku przez trasę
 * webhooka (`payload: verified`), czyli `{ id, type, created, data: { object } }`.
 */
function asVerifiedStripeEvent(payload: Record<string, unknown>): VerifiedWebhookEvent | null {
  const { id, type, created, data } = payload;
  if (typeof id !== "string" || typeof type !== "string" || typeof created !== "number")
    return null;
  if (!isRecord(data) || !isRecord(data.object)) return null;
  return { id, type, created, data: { object: data.object } };
}

/**
 * Zdarzenie do odtworzenia z zapisanego wiersza dziennika albo `null`, gdy
 * ładunek jest pusty i nie ma czego odtwarzać.
 *
 * Dziennik trzyma TRZY kształty ładunku i odtworzenie musi rozumieć każdy:
 *   * SUROWE zdarzenie operatora (trasa webhooka) - przechodzi przez tę samą
 *     normalizację co dostawa przychodząca; bez tego obsługa dostawała
 *     opakowanie `{ object: ... }` zamiast modelu domenowego, nie robiła nic
 *     i kończyła się fałszywym „przetworzono",
 *   * całe zdarzenie po normalizacji (`{ eventType, data }` z uzgadniania) -
 *     typ bierzemy Z ŁADUNKU: starsze wiersze uzgadniania trzymają w
 *     `event_type` surowy typ operatora („customer.subscription.updated"),
 *     którego dyspozytor nie zna, więc ponowienie kończyło się `skipped`,
 *   * sam obiekt danych (wiersze historyczne) - typ z kolumny `event_type`.
 *
 * Pusty ładunek (`null` w kolumnie, `{ data: null }`, `{}`) znaczy jedno: nie
 * ma czego odtworzyć. Wpis `processed` przy takim wierszu zamykałby zgłoszenie
 * klienta, który dalej nie ma uprawnienia.
 */
export async function loggedWebhookEvent(row: {
  event_type: string;
  payload: unknown;
}): Promise<{ normalized: NormalizedWebhookEvent | null } | null> {
  const payload = isRecord(row.payload) ? row.payload : null;
  if (!payload) return null;

  const verified = asVerifiedStripeEvent(payload);
  if (verified) {
    const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
    const normalized = normalizeStripeEvent(verified);
    // Typ poza integracją: zdarzenie jest kompletne, tylko nas nie dotyczy.
    if (!normalized) return { normalized: null };
    return isRecord(normalized.data) && Object.keys(normalized.data).length > 0
      ? { normalized }
      : null;
  }

  const data = "data" in payload ? payload.data : payload;
  if (!isRecord(data) || Object.keys(data).length === 0) return null;
  const eventType =
    "data" in payload && typeof payload.eventType === "string" && payload.eventType !== ""
      ? payload.eventType
      : row.event_type;
  return { normalized: { eventType, data } };
}

/** Komunikat dla wiersza, którego ładunek nie daje się odtworzyć. */
export const EMPTY_PAYLOAD_ERROR = "Zapisany ładunek jest pusty - nie ma czego ponowić.";

// ─── Zamiatarka ─────────────────────────────────────────────────────────────

/**
 * Sufit automatycznych prób (licznik `retry_count` obejmuje też ponowne
 * dostawy operatora i ponowienia z panelu). Zdarzenie, które padło osiem razy,
 * jest usterką do diagnozy, a nie chwilową czkawką - dalsze próby tylko
 * powtarzałyby skutki uboczne sprzed awarii (maile, wpisy CRM).
 */
export const WEBHOOK_SWEEP_MAX_ATTEMPTS = 8;

/** Ile wierszy zamiatarka wykonuje w jednym przebiegu. */
export const WEBHOOK_SWEEP_BATCH = 20;

/**
 * Ilu kandydatów czytamy, żeby wybrać partię. Więcej niż partia, bo część
 * czeka jeszcze na swój odstęp (backoff) i nie jest do wzięcia.
 */
const WEBHOOK_SWEEP_CANDIDATES = 100;

/**
 * Pierwszy odstęp po porażce; każda kolejna próba podwaja go
 * (5, 10, 20, ... min - osiem prób mieści się w ~21 h).
 */
export const WEBHOOK_SWEEP_BACKOFF_BASE_MS = 5 * 60 * 1000;

/**
 * Horyzont automatu: zdarzenia starsze niż 3 doby (okno ponowień operatora)
 * wymagają człowieka. Odtworzenie tygodniowego zdarzenia „płatność nieudana"
 * wysłałoby klientowi mail o problemie dawno rozwiązanym - automat nie ma jak
 * ocenić, czy świat po zdarzeniu poszedł już dalej.
 */
export const WEBHOOK_SWEEP_HORIZON_MS = 3 * 24 * 60 * 60 * 1000;

/** Wiersz kandydata - kolumny decyzji + to, czego potrzeba do odtworzenia. */
export interface WebhookSweepRow extends WebhookEventClaimRow {
  event_id: string;
  event_type: string;
  environment: string;
  occurred_at: string | null;
  processed_at: string | null;
}

export interface WebhookSweepResult {
  /** Kandydaci odczytani z dziennika (`failed` + `received`). */
  scanned: number;
  /** Kandydaci, którym minął odstęp - do wzięcia w tym przebiegu. */
  due: number;
  processed: number;
  skipped: number;
  failed: number;
  /** Przegrany wyścig o przejęcie - zdarzenie obsługuje właśnie ktoś inny. */
  busy: number;
  /** Wiersz, którego nie dało się przejąć ani odczytać (awaria bazy). */
  errors: number;
  /** Do wzięcia, ale termin przebiegu minął - wrócą w następnym. */
  deferred: number;
  /** Odczyt kandydatów padł - jedyny błąd całego przebiegu (log ticku go pokaże). */
  error?: string;
}

export interface WebhookSweepOptions {
  /** Maksymalna liczba wykonań w przebiegu (domyślnie `WEBHOOK_SWEEP_BATCH`). */
  limit?: number;
  /** Termin (ms od epoki): po nim kolejne wiersze czekają na następny przebieg. */
  deadlineAt?: number;
}

/**
 * Czy wiersz jest do automatycznego ponowienia TERAZ (czysta decyzja).
 *
 *  - `received` - wyłącznie porzucony (od ostatniego PRZEJĘCIA minęło okno
 *    bezpieczeństwa), inaczej obsługuje go właśnie ktoś inny,
 *  - `failed`   - po odstępie liczonym od ostatniej próby (domknięcie porażki
 *    stempluje `processed_at`), podwajanym z każdą próbą.
 */
export function isDueForSweep(row: WebhookSweepRow, now: number): boolean {
  const attempts = Number(row.retry_count ?? 0);
  if (attempts >= WEBHOOK_SWEEP_MAX_ATTEMPTS) return false;
  if (row.status === "received") return isAbandonedClaim(row, now);
  if (row.status !== "failed") return false;
  const lastAttempt = Date.parse(row.processed_at ?? row.last_retried_at ?? row.created_at ?? "");
  // Bez żadnego znacznika czasu nie wiemy, kiedy padło - bierzemy od razu,
  // bo sufit prób i tak ogranicza liczbę powtórek.
  if (!Number.isFinite(lastAttempt)) return true;
  return now - lastAttempt >= WEBHOOK_SWEEP_BACKOFF_BASE_MS * 2 ** attempts;
}

const SWEEP_COLUMNS =
  "id, event_id, event_type, environment, occurred_at, status, created_at, last_retried_at, processed_at, retry_count";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Automatyczne ponowienie zdarzeń `failed` i porzuconych `received`.
 *
 * Najstarsze najpierw, mała partia, termin przebiegu. Każdy wiersz jest
 * PRZEJMOWANY tym samym porównaj-i-zamień co dostawa od operatora, więc
 * zamiatarka nigdy nie biegnie równolegle z żywą dostawą tego samego
 * zdarzenia ani z ponowieniem z panelu. NIGDY nie rzuca: awaria jednego
 * wiersza nie zatrzymuje pozostałych, a padnięty odczyt kandydatów wraca jako
 * `error` w wyniku (log przebiegów ticku liczy go jako awarię).
 */
export async function sweepWebhookEvents(
  options: WebhookSweepOptions = {},
): Promise<WebhookSweepResult> {
  const result: WebhookSweepResult = {
    scanned: 0,
    due: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    busy: 0,
    errors: 0,
    deferred: 0,
  };
  const limit = Math.max(1, Math.floor(options.limit ?? WEBHOOK_SWEEP_BATCH));
  const now = Date.now();

  let candidates: WebhookSweepRow[];
  try {
    const supabase = await admin();
    const { data, error } = await supabase
      .from("payment_webhook_events")
      .select(SWEEP_COLUMNS)
      .in("status", ["failed", "received"])
      .lt("retry_count", WEBHOOK_SWEEP_MAX_ATTEMPTS)
      .gte("created_at", new Date(now - WEBHOOK_SWEEP_HORIZON_MS).toISOString())
      // Wiersz młodszy niż okno bezpieczeństwa jest albo w toku, albo w swoim
      // pierwszym odstępie po porażce - w obu wypadkach jeszcze nie nasz.
      .lt("created_at", new Date(now - STUCK_AFTER_MS).toISOString())
      .order("created_at", { ascending: true })
      .limit(WEBHOOK_SWEEP_CANDIDATES);
    if (error) throw new Error(error.message);
    candidates = (data ?? []) as WebhookSweepRow[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payments] webhook sweep: candidates unreadable", err);
    return { ...result, error: `webhook sweep read failed: ${message}` };
  }

  result.scanned = candidates.length;
  const due = candidates.filter((row) => isDueForSweep(row, now));
  result.due = due.length;

  let attempted = 0;
  for (const row of due) {
    if (attempted >= limit) break;
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
    attempted += 1;
    try {
      const outcome = await sweepOne(row);
      result[outcome] += 1;
    } catch (err) {
      result.errors += 1;
      console.error("[payments] webhook sweep: row failed", row.event_id, err);
    }
  }
  result.deferred = Math.max(0, Math.min(due.length, limit) - attempted);
  return result;
}

/** Przejęcie i odtworzenie jednego wiersza zamiatarki. */
async function sweepOne(
  row: WebhookSweepRow,
): Promise<"processed" | "skipped" | "failed" | "busy"> {
  if (row.environment !== "sandbox" && row.environment !== "live") return "skipped";
  const environment: StripeEnv = row.environment;

  const claim = await reclaimWebhookEventRow(row);
  if (claim !== "claimed") return "busy";

  // Ładunek czytamy DOPIERO po przejęciu i tylko dla wiersza, który faktycznie
  // odtwarzamy - pełne zdarzenia operatora potrafią ważyć kilobajty, a
  // kandydatów jest do stu.
  const supabase = await admin();
  const { data, error } = await supabase
    .from("payment_webhook_events")
    .select("payload")
    .eq("id", row.id)
    .maybeSingle();
  if (error) {
    // Wiersz jest już przejęty (`received`) - domykamy go porażką, żeby nie
    // czekał na okno porzucenia, tylko wrócił w następnym przebiegu.
    await finishWebhookEvent({ eventId: row.event_id, environment }, "failed", {
      error: `webhook sweep payload read failed: ${error.message}`,
    });
    return "failed";
  }

  const replay = await loggedWebhookEvent({ event_type: row.event_type, payload: data?.payload });
  if (!replay) {
    await finishWebhookEvent({ eventId: row.event_id, environment }, "failed", {
      error: EMPTY_PAYLOAD_ERROR,
    });
    return "failed";
  }

  const outcome = await processClaimedWebhookEvent({
    eventId: row.event_id,
    environment,
    occurredAt: row.occurred_at ?? new Date().toISOString(),
    normalized: replay.normalized,
  });
  return outcome.status;
}
