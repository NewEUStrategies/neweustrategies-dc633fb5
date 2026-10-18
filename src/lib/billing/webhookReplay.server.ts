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
  lastClaimedAtMs,
  reclaimWebhookEventRowWithGeneration,
  type WebhookEventClaimRow,
  type WebhookEventTarget,
  type WebhookFinishOutcome,
} from "@/lib/billing/webhookLog.server";
import { runAfterResponse } from "@/lib/http/waitUntil.server";

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
  /**
   * Pokolenie przejęcia (`WebhookClaimResult.generation`). Z nim domknięcie
   * dotyka wyłącznie TEGO przejęcia - spóźniony wykonawca nie nadpisze wyniku
   * nowszego (przegląd 3.4). Wołający, który go nie przekazuje (trasa,
   * uzgadnianie, ponowienie z panelu), dostaje pokolenie odczytane z wiersza
   * tuż po przejęciu - patrz `claimedGeneration`.
   */
  generation?: number;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Pokolenie przejęcia dla wołającego, który go nie przekazał (przegląd 3.4).
 *
 * Bez pokolenia domknięcie szło po samym kluczu zdarzenia. Ponowienie
 * z panelu, które przeciągnęło się ponad okno porzucenia, nadpisywało wtedy
 * wiersz przejęty w międzyczasie przez zamiatarkę (`failed` w trakcie jej
 * obsługi albo na jej `processed`) - strażnik pokolenia działał wyłącznie
 * w zamiatarce, a najdłużej biegną właśnie wywołania z panelu.
 *
 * Odczyt jest poprawny, bo pada CHWILĘ po przejęciu: przejęcie stempluje
 * wiersz (`last_retried_at`, przy nowym wierszu `created_at`), a nikt inny nie
 * może go przejąć przed upływem okna porzucenia. Wiersz `received` w tej
 * chwili jest więc NASZYM przejęciem, a jego `retry_count` - naszym
 * pokoleniem. Awaria odczytu albo stan inny niż `received` nie blokują
 * obsługi: domknięcie wraca wtedy do dawnego zapisu po kluczu (z logiem).
 */
async function claimedGeneration(target: WebhookEventTarget): Promise<number | undefined> {
  try {
    const supabase = await admin();
    let query = supabase
      .from("payment_webhook_events")
      .select("status, retry_count")
      .eq("event_id", target.eventId)
      .eq("environment", target.environment);
    if (target.tenantId !== undefined) query = query.eq("tenant_id", target.tenantId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    // `retry_count` jest NOT NULL DEFAULT 0 - wiersz `received` zawsze go niesie.
    if (data?.status === "received") return data.retry_count;
    console.warn(
      "[payments] webhook claim generation unknown - domknięcie bez strażnika pokolenia",
      target.eventId,
      data?.status ?? null,
    );
  } catch (err) {
    console.warn("[payments] webhook claim generation unreadable", target.eventId, err);
  }
  return undefined;
}

export interface WebhookReplayOutcome {
  status: "processed" | "skipped" | "failed";
  error: string | null;
  durationMs: number;
  /**
   * Los wiersza dziennika. `deferred` = obsługa się wykonała, ale domknięcie
   * nie doszło do bazy w próbach na miejscu (kolejne biegną „za
   * odpowiedzią"); `superseded` = wiersz przejął już ktoś inny. Wołający może
   * na tej podstawie zgłosić niespójność.
   */
  finish: WebhookFinishOutcome;
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
  const startedAt = Date.now();
  const key: WebhookEventTarget = {
    eventId: event.eventId,
    environment: event.environment,
    ...(event.tenantId !== undefined ? { tenantId: event.tenantId } : {}),
  };
  // Pokolenie PRZED obsługą - po niej wiersz mógł już przejąć ktoś inny.
  const generation = event.generation ?? (await claimedGeneration(key));
  const target: WebhookEventTarget = generation !== undefined ? { ...key, generation } : key;

  if (!event.normalized) {
    // Zdarzenie spoza zakresu integracji (np. sesja "unpaid" albo typ, którego
    // nie obsługujemy) - domykamy, żeby nikt go nie ponawiał w kółko.
    const durationMs = Date.now() - startedAt;
    const finish = await finishWebhookEvent(target, "skipped", { durationMs });
    return { status: "skipped", error: null, durationMs, finish };
  }

  try {
    const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");
    // Wynik dyspozytora (`processed` | `skipped`) jest wprost statusem domknięcia.
    const status = await dispatchWebhookEvent({
      // Ten sam identyfikator przy każdej powtórce (dostawa, panel, zamiatarka)
      // - strażnik kolejności subskrypcji rozpoznaje po nim TO SAMO zdarzenie.
      eventId: event.eventId,
      eventType: event.normalized.eventType,
      data: event.normalized.data,
      environment: event.environment,
      occurredAt: event.occurredAt,
    });
    const durationMs = Date.now() - startedAt;
    const finish = await finishWebhookEvent(target, status, { durationMs });
    return { status, error: null, durationMs, finish };
  } catch (err) {
    // Identyfikator w logu: przy zamiatarce i panelu nie ma żądania HTTP,
    // po którym dałoby się skojarzyć wyjątek ze zdarzeniem.
    console.error("[payments] webhook error", event.eventId, err);
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startedAt;
    const finish = await finishWebhookEvent(target, "failed", { error: message, durationMs });
    return { status: "failed", error: message, durationMs, finish };
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
 *
 * Ładunek PO RETENCJI (`_redacted`, audyt SUB-11) też daje `null`, choć
 * kształtem wygląda na kompletny: e-mail, adres i dane karty są wyzerowane,
 * więc odtworzenie zapisałoby w księgach puste pola zamiast prawdziwych.
 * Komunikat dla wołającego rozróżnia oba przypadki -
 * `unreplayablePayloadError`.
 */
export async function loggedWebhookEvent(row: {
  event_type: string;
  payload: unknown;
}): Promise<{ normalized: NormalizedWebhookEvent | null } | null> {
  const payload = isRecord(row.payload) ? row.payload : null;
  if (!payload || isRedactedWebhookPayload(payload)) return null;

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

/**
 * Komunikat dla ładunku po retencji. Zdarzenie żywe u operatora odtwarza
 * uzgadnianie (`reconcile`) - czyta je OD OPERATORA, nie z dziennika.
 */
export const REDACTED_PAYLOAD_ERROR =
  "Ładunek zdarzenia został zanonimizowany (retencja danych) - ponowienie z dziennika nie jest możliwe. Użyj uzgodnienia ze Stripe.";

/**
 * Czy ładunek przeszedł retencję dziennika (audyt SUB-11): znacznik
 * `_redacted: { at, reason }` dopisuje `payment_webhook_payload_redact`
 * (po 30/90 dniach albo od razu przy zamknięciu konta).
 */
export function isRedactedWebhookPayload(payload: unknown): boolean {
  return isRecord(payload) && isRecord(payload._redacted);
}

/** Przyczyna, dla której `loggedWebhookEvent` nie zwrócił zdarzenia do odtworzenia. */
export function unreplayablePayloadError(payload: unknown): string {
  return isRedactedWebhookPayload(payload) ? REDACTED_PAYLOAD_ERROR : EMPTY_PAYLOAD_ERROR;
}

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
 * Pierwszy odstęp po porażce; każda kolejna próba podwaja go
 * (5, 10, 20, ... min - osiem prób mieści się w ~21 h). Ten sam odstęp
 * dostaje wiersz `received` porzucony przez wykonawcę (patrz `isDueForSweep`).
 */
export const WEBHOOK_SWEEP_BACKOFF_BASE_MS = 5 * 60 * 1000;

/**
 * Horyzont automatu: zdarzenia starsze niż 3 doby (okno ponowień operatora)
 * wymagają człowieka. Odtworzenie tygodniowego zdarzenia „płatność nieudana"
 * wysłałoby klientowi mail o problemie dawno rozwiązanym - automat nie ma jak
 * ocenić, czy świat po zdarzeniu poszedł już dalej.
 *
 * Wiek liczy się od CZASU ZDARZENIA (`occurred_at`), a od utworzenia wiersza
 * wyłącznie, gdy zdarzenie go nie niesie (przegląd 3.3). Liczony od
 * `created_at` przepuszczał stare zdarzenia, których wiersz powstał późno:
 * naprawę z uzgadniania sprzed 20 dni albo pierwszą udaną dostawę po kilku
 * dobach odpowiedzi 503.
 */
export const WEBHOOK_SWEEP_HORIZON_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Budżet JEDNEGO wiersza (ms): najdłuższe pojedyncze żądanie do operatora
 * razem z ponowieniem SDK - `STRIPE_REQUEST_TIMEOUT_MS` (10 s) ×
 * (1 + `STRIPE_MAX_NETWORK_RETRIES`).
 *
 * Wartość jest przepisana, a nie importowana z `stripe.server`: ten moduł
 * bywa ładowany obok atrapy `stripe.server` bez stałych SDK. Zgodność
 * z ustawieniami klienta operatora pilnuje test.
 */
export const WEBHOOK_SWEEP_ROW_BUDGET_MS = 20_000;

/**
 * Ile runtime pozwala dokończyć pracę zarejestrowaną „za odpowiedzią" PO
 * zerwaniu połączenia przez wołającego (ms): `ctx.waitUntil` na Workers
 * trzyma izolat do 30 s po odpowiedzi albo rozłączeniu klienta.
 *
 * DLACZEGO TO, A NIE BUDŻET DO TERMINU (przegląd 3.0 i regresja po nim).
 * Każdy wiersz jest od startu zarejestrowany „za odpowiedzią", więc zerwane
 * połączenie (pg_net, scheduler) go nie ucina: wiersz zaczęty przed terminem
 * przebiegu - który wołający ustawia NIE PÓŹNIEJ niż chwilę zerwania - ma
 * co najmniej tyle czasu na dokończenie. Dopóki budżet wiersza mieści się
 * w tym oknie (pilnuje test), wiersz może startować aż do terminu. Bramka
 * „pełny budżet wiersza PRZED terminem" była nadmiarowa i głodziła tick
 * zadań: zamiatarka startująca później niż ~3 s po starcie ticku odkładała
 * wszystko (`deferred`), a log przebiegów pokazywał `ok:true`.
 */
export const WEBHOOK_SWEEP_AFTER_RESPONSE_GRACE_MS = 30_000;

/**
 * Najpóźniejsza chwila startu wiersza dla terminu `deadlineAt`: termin
 * pomniejszony o tę część budżetu wiersza, której nie pokrywa okno pracy
 * „za odpowiedzią" (przy obecnych stałych - zero, czyli sam termin).
 */
export function sweepRowStartCutoff(deadlineAt: number): number {
  return (
    deadlineAt - Math.max(0, WEBHOOK_SWEEP_ROW_BUDGET_MS - WEBHOOK_SWEEP_AFTER_RESPONSE_GRACE_MS)
  );
}

/** Wiersz kandydata - kolumny decyzji + to, czego potrzeba do odtworzenia. */
export interface WebhookSweepRow extends WebhookEventClaimRow {
  event_id: string;
  event_type: string;
  /** Kolumna z `CHECK (environment IN ('sandbox','live'))` od utworzenia tabeli. */
  environment: StripeEnv;
  occurred_at: string | null;
  processed_at: string | null;
}

export interface WebhookSweepResult {
  /** Kandydaci odczytani z dziennika - baza zwraca wyłącznie wiersze do wzięcia. */
  scanned: number;
  /** Kandydaci do wzięcia w tym przebiegu (odstęp minął, w horyzoncie, poniżej sufitu). */
  due: number;
  processed: number;
  skipped: number;
  failed: number;
  /** Przegrany wyścig o przejęcie - zdarzenie obsługuje właśnie ktoś inny. */
  busy: number;
  /** Wiersz, którego nie dało się przejąć ani odczytać (awaria bazy). */
  errors: number;
  /**
   * Do wzięcia, ale termin przebiegu minął przed ich startem (albo poprzedni
   * wiersz go przekroczył) - wrócą w następnym przebiegu (bez przejęcia).
   */
  deferred: number;
  /**
   * Wiersz zaczęty w budżecie, który nie skończył się do terminu przebiegu.
   * Obsługa biegnie dalej „za odpowiedzią" i domknie wiersz własnym
   * pokoleniem; przebieg przestaje na niego czekać.
   */
  timedOut: number;
  /** Odczyt kandydatów padł - jedyny błąd całego przebiegu (log ticku go pokaże). */
  error?: string;
}

export interface WebhookSweepOptions {
  /** Maksymalna liczba wykonań w przebiegu (domyślnie `WEBHOOK_SWEEP_BATCH`). */
  limit?: number;
  /**
   * Termin (ms od epoki), do którego przebieg ZACZYNA wiersze i na nie
   * CZEKA. Wołający ustawia go nie później niż chwila, w której jego wołający
   * (pg_net, scheduler) zrywa połączenie, i nie dalej, niż chce oddać
   * zamiatarce czasu przed własnymi kolejnymi krokami. Wiersz zaczęty przed
   * terminem kończy się „za odpowiedzią" - patrz
   * `WEBHOOK_SWEEP_AFTER_RESPONSE_GRACE_MS`.
   */
  deadlineAt?: number;
}

/** Odstęp przed kolejną próbą po `attempts` przejęciach. */
export function sweepBackoffMs(attempts: number): number {
  return WEBHOOK_SWEEP_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts);
}

/**
 * Czy wiersz jest do automatycznego ponowienia TERAZ (czysta decyzja).
 * Tę samą regułę liczy baza w `payment_webhook_sweep_candidates` - funkcja
 * jest jej specyfikacją i bezpiecznikiem dla odczytów spoza zamiatarki.
 *
 *  - `received` - porzucony: od ostatniego PRZEJĘCIA minęło więcej niż okno
 *    bezpieczeństwa ORAZ odstęp wykładniczy (przegląd 3.1). Sam test
 *    porzucenia przejmował wiersz co 5 minut bez względu na licznik prób:
 *    obsługa ginąca za każdym razem (worker ubity, wyjątek przed
 *    domknięciem) wyczerpywała sufit ośmiu prób w ~40 minut i powtarzała
 *    skutki sprzed awarii co przebieg,
 *  - `failed`   - po odstępie liczonym od ostatniej próby (domknięcie porażki
 *    stempluje `processed_at`), podwajanym z każdą próbą.
 */
export function isDueForSweep(row: WebhookSweepRow, now: number): boolean {
  const attempts = Number(row.retry_count ?? 0);
  if (attempts >= WEBHOOK_SWEEP_MAX_ATTEMPTS) return false;
  if (row.status === "received") {
    const claimedAt = lastClaimedAtMs(row);
    // Bez znacznika przejęcia nie da się dowieść porzucenia - jak w dzienniku.
    if (!Number.isFinite(claimedAt)) return false;
    return now - claimedAt > Math.max(STUCK_AFTER_MS, sweepBackoffMs(attempts));
  }
  if (row.status !== "failed") return false;
  const lastAttempt = Date.parse(row.processed_at ?? row.last_retried_at ?? row.created_at ?? "");
  // Bez żadnego znacznika czasu nie wiemy, kiedy padło - bierzemy od razu,
  // bo sufit prób i tak ogranicza liczbę powtórek.
  if (!Number.isFinite(lastAttempt)) return true;
  return now - lastAttempt >= sweepBackoffMs(attempts);
}

/**
 * Czy zdarzenie mieści się w horyzoncie automatu - liczonym od czasu
 * ZDARZENIA, a od utworzenia wiersza tylko, gdy zdarzenie go nie niesie.
 *
 * Wyjątek: syntetyczne naprawy uzgadniania (`reconcile_…`) są budowane ze
 * stanu operatora odczytanego W CHWILI naprawy (sesja, subskrypcja), a ich
 * `occurred_at` niesie czas zakupu dla `paid_at`. Ich wiek to wiek wiersza -
 * naprawa zamówienia sprzed tygodnia, której pierwsza próba padła, ma wrócić
 * automatycznie, a nie czekać na kolejne kliknięcie „Napraw".
 */
export function isWithinSweepHorizon(
  row: Pick<WebhookSweepRow, "event_id" | "occurred_at" | "created_at">,
  now: number,
): boolean {
  const stamp = row.event_id.startsWith("reconcile_")
    ? row.created_at
    : (row.occurred_at ?? row.created_at);
  const at = Date.parse(stamp ?? "");
  return Number.isFinite(at) && at >= now - WEBHOOK_SWEEP_HORIZON_MS;
}

/**
 * Kandydaci zamiatarki - WYŁĄCZNIE wiersze do wzięcia, policzone w bazie.
 *
 * Wcześniej czytaliśmy 100 NAJSTARSZYCH wierszy `failed`/`received`, a odstęp
 * sprawdzaliśmy dopiero tutaj (przegląd 3.2). Setka starszych wierszy
 * czekających na swój odstęp zasłaniała każdy nowszy wiersz do wzięcia -
 * także realizację zamówienia klienta, który zapłacił - aż starsze dobiły do
 * sufitu prób (~21 h). Funkcja bazy liczy odstęp, sufit i horyzont sama
 * i zwraca wiersze w kolejności „najdłużej czeka". Reguły dostaje
 * PARAMETRAMI z tego modułu - stałe żyją w jednym miejscu.
 */
async function readSweepCandidates(limit: number): Promise<WebhookSweepRow[]> {
  const supabase = await admin();
  const { data, error } = await supabase.rpc("payment_webhook_sweep_candidates", {
    p_limit: limit,
    p_max_attempts: WEBHOOK_SWEEP_MAX_ATTEMPTS,
    p_backoff_base_ms: WEBHOOK_SWEEP_BACKOFF_BASE_MS,
    p_stuck_after_ms: STUCK_AFTER_MS,
    p_horizon_ms: WEBHOOK_SWEEP_HORIZON_MS,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as WebhookSweepRow[];
}

/**
 * Automatyczne ponowienie zdarzeń `failed` i porzuconych `received`.
 *
 * Najdłużej czekające najpierw, mała partia, termin przebiegu. Każdy wiersz
 * jest PRZEJMOWANY tym samym porównaj-i-zamień co dostawa od operatora, więc
 * zamiatarka nigdy nie biegnie równolegle z żywą dostawą tego samego
 * zdarzenia ani z ponowieniem z panelu. NIGDY nie rzuca: awaria jednego
 * wiersza nie zatrzymuje pozostałych, a padnięty odczyt kandydatów wraca jako
 * `error` w wyniku (log przebiegów ticku liczy go jako awarię).
 *
 * TERMIN (przegląd 3.0) działa w dwie strony:
 *   * przed startem - wiersz rusza tylko przed terminem
 *     (`sweepRowStartCutoff`); reszta jest `deferred`. Każdy zaczęty wiersz
 *     jest od startu zarejestrowany „za odpowiedzią", więc zerwane przez
 *     wołającego połączenie go nie ucina,
 *   * w trakcie - przebieg czeka na wiersz najwyżej do terminu. Obsługa,
 *     która go przekroczy (kilka zawieszonych żądań do operatora), biegnie
 *     dalej „za odpowiedzią" i domyka wiersz sama, a przebieg kończy się
 *     z `timedOut` - joby wołającego po zamiatarce i jego zapis w logu
 *     przebiegów nie czekają na operatora.
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
    timedOut: 0,
  };
  const limit = Math.max(1, Math.floor(options.limit ?? WEBHOOK_SWEEP_BATCH));

  let candidates: WebhookSweepRow[];
  try {
    candidates = await readSweepCandidates(limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payments] webhook sweep: candidates unreadable", err);
    return { ...result, error: `webhook sweep read failed: ${message}` };
  }

  result.scanned = candidates.length;
  result.due = candidates.length;

  const startCutoff =
    options.deadlineAt !== undefined ? sweepRowStartCutoff(options.deadlineAt) : undefined;
  let attempted = 0;
  for (const row of candidates) {
    if (attempted >= limit) break;
    if (startCutoff !== undefined && Date.now() >= startCutoff) break;
    attempted += 1;
    try {
      const outcome = await runRowWithinDeadline(row, options.deadlineAt);
      if (outcome === "timed_out") {
        result.timedOut += 1;
        break;
      }
      result[outcome] += 1;
    } catch (err) {
      result.errors += 1;
      console.error("[payments] webhook sweep: row failed", row.event_id, err);
    }
  }
  result.deferred = Math.max(0, Math.min(candidates.length, limit) - attempted);
  return result;
}

type SweepRowOutcome = "processed" | "skipped" | "failed" | "busy";

/**
 * Obsługa wiersza ograniczona terminem przebiegu. Obsługa jest rejestrowana
 * „za odpowiedzią" (`waitUntil` na Workers) OD STARTU, a nie dopiero po
 * przekroczeniu terminu: gdy wołający zerwie połączenie, runtime nie ubija
 * jej w połowie, tylko pozwala dokończyć i domknąć wiersz.
 */
async function runRowWithinDeadline(
  row: WebhookSweepRow,
  deadlineAt: number | undefined,
): Promise<SweepRowOutcome | "timed_out"> {
  const work = sweepOne(row);
  runAfterResponse(work);
  if (deadlineAt === undefined) return work;

  // Wykonawca obietnicy biegnie synchronicznie - licznik istnieje przed `finally`.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), Math.max(0, deadlineAt - Date.now()));
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Przejęcie i odtworzenie jednego wiersza zamiatarki. */
async function sweepOne(row: WebhookSweepRow): Promise<SweepRowOutcome> {
  const { environment } = row;
  const { claim, generation } = await reclaimWebhookEventRowWithGeneration(row);
  if (claim !== "claimed" || generation === null) return "busy";
  const target: WebhookEventTarget = { eventId: row.event_id, environment, generation };

  // Od tej chwili wiersz jest NASZ (`received`, nasze pokolenie). Każda
  // porażka po przejęciu domyka go jako `failed` z przyczyną - wyjątek
  // przepuszczony wyżej zostawiał wiersz w `received`, a ten wracał co
  // przebieg jako „porzucony" (przegląd 3.1).
  try {
    // Ładunek czytamy DOPIERO po przejęciu i tylko dla wiersza, który
    // faktycznie odtwarzamy - pełne zdarzenia operatora potrafią ważyć
    // kilobajty.
    const supabase = await admin();
    const { data, error } = await supabase
      .from("payment_webhook_events")
      .select("payload")
      .eq("id", row.id)
      .maybeSingle();
    if (error) {
      await finishWebhookEvent(target, "failed", {
        error: `webhook sweep payload read failed: ${error.message}`,
      });
      return "failed";
    }

    // Ładunek pusty albo po retencji (`_redacted`) domykamy porażką
    // z przyczyną. Wiersz po retencji trafia tu wyłącznie w wyścigu retencji
    // z odczytem kandydatów - baza pomija go już na liście - i po tym
    // domknięciu nie wraca do automatu; w panelu zostaje z przyczyną.
    const replay = await loggedWebhookEvent({
      event_type: row.event_type,
      payload: data?.payload,
    });
    if (!replay) {
      await finishWebhookEvent(target, "failed", {
        error: unreplayablePayloadError(data?.payload),
      });
      return "failed";
    }

    const outcome = await processClaimedWebhookEvent({
      eventId: row.event_id,
      environment,
      occurredAt: row.occurred_at ?? new Date().toISOString(),
      normalized: replay.normalized,
      generation,
    });
    return outcome.status;
  } catch (err) {
    console.error("[payments] webhook sweep: replay crashed", row.event_id, err);
    const message = err instanceof Error ? err.message : String(err);
    await finishWebhookEvent(target, "failed", {
      error: `webhook sweep replay crashed: ${message}`,
    });
    return "failed";
  }
}
