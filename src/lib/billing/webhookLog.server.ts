// Rejestr zdarzeń od operatora płatności.
//
// Dwa zadania:
//  1. idempotencja - `claimWebhookEvent` wstawia wiersz z unikalnym
//     (event_id, environment); duplikat oznacza, że zdarzenie już
//     przetworzyliśmy (albo przetwarza je ktoś inny) i handler nie może go
//     wykonać drugi raz,
//  2. audyt - panel `/admin/billing` czyta tę tabelę (RLS: tylko admin).
//
// Z tego samego porównaj-i-zamień (`reclaimWebhookEventRow`) korzystają
// WSZYSCY wykonawcy zdarzenia: trasa webhooka, naprawa z uzgadniania,
// ponowienie z panelu i automatyczna zamiatarka (`webhookReplay.server`).
// Dzięki temu dwóch wykonawców nigdy nie obsługuje tego samego zdarzenia
// równolegle (drugi bilet, drugi mail, podwójny wpis w CRM).
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import type { Json } from "@/integrations/supabase/types";

export type WebhookEventStatus = "received" | "processed" | "skipped" | "failed";

/**
 * Wynik rezerwacji zdarzenia - TRZY stany, nie dwa:
 *  - `claimed`     - zdarzenie jest nasze, wykonujemy obsługę,
 *  - `done`        - domknięte statusem końcowym (`processed`/`skipped`),
 *                    powtórka jest bezpiecznym duplikatem,
 *  - `in_progress` - obsługuje je właśnie ktoś inny (równoległa dostawa,
 *                    zamiatarka, ponowienie z panelu) ALBO nie da się dowieść,
 *                    że skończył. Dla operatora to „spróbuj później", nigdy
 *                    „mam": odpowiedź 2xx na tym stanie kończyła ponawianie,
 *                    a gdy pierwsza obsługa padła, zdarzenie wisiało na zawsze.
 */
export type WebhookClaim = "claimed" | "done" | "in_progress";

export interface WebhookEventRef {
  eventId: string;
  eventType: string;
  environment: "sandbox" | "live";
  occurredAt?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  userId?: string | null;
  payload?: unknown;
}

/** Kolumny wiersza dziennika, na których opiera się decyzja o przejęciu. */
export interface WebhookEventClaimRow {
  id: string;
  status: string;
  created_at: string | null;
  last_retried_at: string | null;
  retry_count: number | null;
}

/** Lista kolumn `WebhookEventClaimRow` - jedna dla wszystkich odczytów przed przejęciem. */
export const WEBHOOK_CLAIM_COLUMNS = "id, status, created_at, last_retried_at, retry_count";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Po tylu ms zdarzenie w stanie `received` uznajemy za porzucone (padł worker). */
export const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Chwila OSTATNIEGO przejęcia wiersza (ms od epoki; `NaN`, gdy nieznana).
 *
 * Liczona od `last_retried_at`, a dopiero bez niego od `created_at`. Wiek
 * liczony wyłącznie od utworzenia sprawiał, że wiersz przejęty ponownie po
 * awarii (utworzony godzinę temu, przejęty przed chwilą) wyglądał na
 * porzucony - równoległa dostawa przejmowała go w trakcie trwającej obsługi
 * i zdarzenie wykonywało się dwa razy.
 */
export function lastClaimedAtMs(
  row: Pick<WebhookEventClaimRow, "created_at" | "last_retried_at">,
): number {
  const stamp = row.last_retried_at ?? row.created_at;
  return stamp ? Date.parse(stamp) : Number.NaN;
}

/**
 * Czy wiersz `received` jest porzucony: od ostatniego przejęcia minęło WIĘCEJ
 * niż okno bezpieczeństwa. Bez znacznika czasu nie da się dowieść porzucenia,
 * więc odpowiedź brzmi „nie" - przejęcie mogłoby zdublować trwającą obsługę.
 */
export function isAbandonedClaim(
  row: Pick<WebhookEventClaimRow, "created_at" | "last_retried_at">,
  now: number = Date.now(),
): boolean {
  const claimedAt = lastClaimedAtMs(row);
  return Number.isFinite(claimedAt) && now - claimedAt > STUCK_AFTER_MS;
}

export interface ReclaimOptions {
  /** Świeży ładunek (ponowna dostawa od operatora); bez niego zapisany zostaje. */
  payload?: unknown;
  /** Autor ponowienia z panelu - stempel audytu w tym samym zapisie co przejęcie. */
  retriedBy?: string | null;
  /** Zakres najemcy zapisu (ponowienie z panelu biegnie spod `service_role`). */
  tenantId?: string;
  /**
   * Czy wolno otworzyć wiersz domknięty (`processed`/`skipped`). Wyłącznie
   * ręczne ponowienie z panelu: admin świadomie odtwarza obsługę, np. gdy plan
   * dodano do katalogu po zdarzeniu. Automaty domkniętego nie ruszają.
   */
  reopenClosed?: boolean;
}

/**
 * Decyzja i PORÓWNAJ-I-ZAMIEŃ na wierszu, który wołający właśnie odczytał.
 *
 * Przejęcie jest warunkowym UPDATE na stanie z odczytu (status + licznik prób;
 * każde przejęcie podbija licznik). Ponowna dostawa od operatora, naprawa
 * z panelu, ponowienie admina i zamiatarka mogą odczytać ten sam wiersz
 * jednocześnie - bezwarunkowy UPDATE dałby wszystkim „nasze" i wielokrotne
 * wykonanie zdarzenia. Postgres serializuje UPDATE-y na wierszu, więc warunek
 * przepuści tylko pierwszego; pozostali dostają 0 wierszy, czyli
 * `in_progress` - zwycięzca właśnie obsługuje zdarzenie.
 */
export async function reclaimWebhookEventRow(
  row: WebhookEventClaimRow,
  options: ReclaimOptions = {},
): Promise<WebhookClaim> {
  const status = row.status as WebhookEventStatus;
  if ((status === "processed" || status === "skipped") && !options.reopenClosed) return "done";
  // Zdarzenie może być obsługiwane właśnie teraz przez równoległego
  // wykonawcę - przejmujemy je dopiero po upływie okna bezpieczeństwa.
  if (status === "received" && !isAbandonedClaim(row)) return "in_progress";

  const supabase = await admin();
  const previousRetries = Number(row.retry_count ?? 0);
  let query = supabase
    .from("payment_webhook_events")
    .update({
      status: "received",
      error: null,
      processed_at: null,
      retry_count: previousRetries + 1,
      last_retried_at: new Date().toISOString(),
      ...(options.payload !== undefined ? { payload: options.payload as Json } : {}),
      ...(options.retriedBy !== undefined ? { retried_by: options.retriedBy } : {}),
    })
    .eq("id", row.id);
  if (options.tenantId !== undefined) query = query.eq("tenant_id", options.tenantId);
  const { data: reclaimed, error } = await query
    .eq("status", row.status)
    .eq("retry_count", previousRetries)
    .select("id");
  if (error) throw new Error(`webhook log reclaim failed: ${error.message}`);
  return (reclaimed ?? []).length > 0 ? "claimed" : "in_progress";
}

/**
 * Rezerwuje zdarzenie do przetworzenia.
 *
 * Duplikat blokuje ponowne wykonanie, gdy poprzednie podejście zakończyło się
 * statusem końcowym (`done`) albo właśnie trwa (`in_progress`). Zdarzenie,
 * które padło (`failed`) albo utknęło w `received` (worker zginął w trakcie),
 * musi dać się przejąć ponownie - inaczej ponowna wysyłka od operatora
 * zostałaby zignorowana i klient zostałby bez uprawnień mimo obciążenia.
 *
 * Awaria bazy na każdym kroku RZUCA (z nazwą kroku) - wołający nie może
 * zgadywać. Trasa webhooka odpowiada wtedy 503 i operator ponawia.
 */
export async function claimWebhookEvent(ref: WebhookEventRef): Promise<WebhookClaim> {
  const supabase = await admin();
  const { error } = await supabase.from("payment_webhook_events").insert({
    event_id: ref.eventId,
    event_type: ref.eventType,
    environment: ref.environment,
    occurred_at: ref.occurredAt ?? null,
    subscription_id: ref.subscriptionId ?? null,
    customer_id: ref.customerId ?? null,
    user_id: ref.userId ?? null,
    payload: (ref.payload ?? {}) as Json,
    status: "received",
  });
  if (!error) return "claimed";
  // 23505 = unique_violation -> zdarzenie już zarejestrowane
  if (error.code !== "23505") throw new Error(`webhook log insert failed: ${error.message}`);

  const { data: existing, error: readErr } = await supabase
    .from("payment_webhook_events")
    .select(WEBHOOK_CLAIM_COLUMNS)
    .eq("event_id", ref.eventId)
    .eq("environment", ref.environment)
    .maybeSingle();
  if (readErr) throw new Error(`webhook log lookup failed: ${readErr.message}`);
  // Konflikt klucza bez widocznego wiersza (wyścig z usunięciem, retencja):
  // NIE wiemy, czy zdarzenie zostało obsłużone. „Spróbuj później" jest tu
  // jedyną bezpieczną odpowiedzią - przy następnej próbie INSERT przejdzie
  // albo wiersz będzie już widoczny. „Duplikat" kończyłby ponawianie
  // zdarzenia, którego nikt nie wykonał.
  if (!existing) return "in_progress";

  return reclaimWebhookEventRow(existing, {
    // Brak ładunku w odwołaniu NIE czyści zapisanego - zamiatarka i panel
    // odtwarzają zdarzenie właśnie z niego.
    ...(ref.payload !== undefined ? { payload: ref.payload } : {}),
  });
}

/**
 * Wiersz do domknięcia: klucz zdarzenia i - dla ścieżek biegnących w imieniu
 * admina - zakres najemcy, który zawęża również ZAPIS (`service_role` omija RLS).
 */
export type WebhookEventTarget = Pick<WebhookEventRef, "eventId" | "environment"> & {
  tenantId?: string;
};

/** Domyka wiersz zdarzenia statusem końcowym. Nigdy nie rzuca. */
export async function finishWebhookEvent(
  ref: WebhookEventTarget,
  status: WebhookEventStatus,
  patch?: {
    error?: string | null;
    subscriptionId?: string | null;
    userId?: string | null;
    /** Czas obsługi zdarzenia w ms - panel diagnostyczny pokazuje go wprost. */
    durationMs?: number | null;
  },
): Promise<void> {
  try {
    const supabase = await admin();
    let query = supabase
      .from("payment_webhook_events")
      .update({
        status,
        error: patch?.error ?? null,
        processed_at: new Date().toISOString(),
        ...(typeof patch?.durationMs === "number"
          ? { duration_ms: Math.max(0, Math.round(patch.durationMs)) }
          : {}),
        ...(patch?.subscriptionId ? { subscription_id: patch.subscriptionId } : {}),
        ...(patch?.userId ? { user_id: patch.userId } : {}),
      })
      .eq("event_id", ref.eventId)
      .eq("environment", ref.environment);
    if (ref.tenantId !== undefined) query = query.eq("tenant_id", ref.tenantId);
    const { error } = await query;
    // supabase-js zwraca błąd bazy w wyniku, a nie jako wyjątek - bez tego
    // odczytu nieudane domknięcie zostawiało wiersz w `received` bez śladu.
    if (error) console.error("[payments] webhook log update failed", error);
  } catch (err) {
    console.error("[payments] webhook log update failed", err);
  }
}
