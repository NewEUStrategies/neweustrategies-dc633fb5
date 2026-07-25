// Warstwa serwerowa listy wykluczeń (suppression list).
//
// JEDNO miejsce, przez które przechodzi każde pytanie "czy wolno wysłać na ten
// adres?" i każdy zapis blokady. Wszystkie ścieżki wychodzącej poczty
// (kampanie newslettera, double opt-in, digesty powiadomień, transakcyjne)
// pytają tutaj - dzięki temu nowa ścieżka wysyłki nie może przez przypadek
// ominąć higieny listy.
//
// Wywołania idą przez SECURITY DEFINER RPC z migracji
// 20260725120000_email_suppression_bounce_complaint.sql, dostępne wyłącznie dla
// service_role. RPC są nowsze niż wygenerowane typy Supabase, więc nazwa i
// argumenty są rzutowane w JEDNYM miejscu (poniżej), a API modułu pozostaje
// w pełni otypowane (precedens: chat_check_upload_quota).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BounceClass, DeliveryEventKind } from "./deliveryEvents";

type DbClient = SupabaseClient<Database>;

export type SuppressionReason =
  | "hard_bounce"
  | "soft_bounce"
  | "complaint"
  | "manual"
  | "unsubscribe"
  | "invalid"
  | "blocked";

export type SuppressionScope = "permanent" | "transient";

export interface SuppressionHit {
  email: string;
  reason: SuppressionReason;
  scope: SuppressionScope;
  expiresAt: string | null;
}

/**
 * Rzutowanie na granicy niewygenerowanych typów. Trzymane w jednym miejscu,
 * żeby reszta modułu (i cała reszta aplikacji) pracowała na typach.
 */
type RpcCallable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function rpcClient(admin: DbClient): RpcCallable {
  return admin as unknown as RpcCallable;
}

/** Adresy przetwarzamy porcjami - jedno zapytanie na całą listę byłoby zbyt duże. */
const FILTER_CHUNK = 500;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function isSuppressionRow(value: unknown): value is {
  email: string;
  reason: SuppressionReason;
  scope: SuppressionScope;
  expires_at: string | null;
} {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.email === "string" && typeof row.reason === "string";
}

/**
 * Zwraca mapę zablokowanych adresów spośród podanych (klucz: adres znormalizowany).
 * Fail-closed byłoby tu błędem: awaria odczytu listy nie może zatrzymać całej
 * kampanii, więc przy błędzie zwracamy pustą mapę i logujemy - wysyłka idzie
 * dalej, a webhooki i tak zablokują adres przy najbliższym odbiciu.
 */
export async function fetchSuppressedEmails(
  admin: DbClient,
  tenantId: string,
  emails: readonly string[],
): Promise<Map<string, SuppressionHit>> {
  const found = new Map<string, SuppressionHit>();
  const unique = Array.from(new Set(emails.map(normalize).filter(Boolean)));
  if (!tenantId || unique.length === 0) return found;

  for (let i = 0; i < unique.length; i += FILTER_CHUNK) {
    const chunk = unique.slice(i, i + FILTER_CHUNK);
    const { data, error } = await rpcClient(admin).rpc("email_filter_suppressed", {
      p_tenant: tenantId,
      p_emails: chunk,
    });
    if (error) {
      console.error("[suppression] filter failed", error.message);
      continue;
    }
    if (!Array.isArray(data)) continue;
    for (const row of data) {
      if (!isSuppressionRow(row)) continue;
      found.set(normalize(row.email), {
        email: normalize(row.email),
        reason: row.reason,
        scope: row.scope,
        expiresAt: row.expires_at ?? null,
      });
    }
  }
  return found;
}

/** Pojedyncze sprawdzenie (double opt-in, wysyłki transakcyjne 1:1). */
export async function isEmailSuppressed(
  admin: DbClient,
  tenantId: string,
  email: string,
): Promise<boolean> {
  if (!tenantId || !email) return false;
  const { data, error } = await rpcClient(admin).rpc("email_is_suppressed", {
    p_tenant: tenantId,
    p_email: normalize(email),
  });
  if (error) {
    console.error("[suppression] check failed", error.message);
    return false;
  }
  return data === true;
}

export interface RecordSuppressionInput {
  tenantId: string;
  email: string;
  reason: SuppressionReason;
  source?: "resend_webhook" | "manual" | "import" | "system";
  provider?: string;
  providerMessageId?: string | null;
  eventId?: string | null;
  campaignId?: string | null;
  subscriberId?: string | null;
  diagnostic?: string | null;
  meta?: Record<string, string>;
}

/** Zapisuje blokadę (eskalacja soft -> hard i pierwszeństwo powagi żyją w SQL). */
export async function recordSuppression(
  admin: DbClient,
  input: RecordSuppressionInput,
): Promise<boolean> {
  const { data, error } = await rpcClient(admin).rpc("email_record_suppression", {
    p_tenant: input.tenantId,
    p_email: normalize(input.email),
    p_reason: input.reason,
    p_source: input.source ?? "system",
    p_provider: input.provider ?? "resend",
    p_provider_message_id: input.providerMessageId ?? null,
    p_event_id: input.eventId ?? null,
    p_campaign: input.campaignId ?? null,
    p_subscriber: input.subscriberId ?? null,
    p_diagnostic: input.diagnostic ?? null,
    p_meta: input.meta ?? {},
  });
  if (error) {
    console.error("[suppression] record failed", error.message);
    return false;
  }
  return isRecord(data) && data.ok === true;
}

export interface ApplyDeliveryEventInput {
  provider: string;
  eventId: string;
  eventType: string;
  kind: DeliveryEventKind;
  email: string | null;
  providerMessageId: string | null;
  bounceClass: BounceClass | null;
  diagnostic: string | null;
  occurredAt: string;
  tenantHint?: string | null;
  campaignHint?: string | null;
  subscriberHint?: string | null;
  payload?: unknown;
}

export interface ApplyDeliveryEventResult {
  ok: boolean;
  duplicate: boolean;
  tenantId: string | null;
  campaignId: string | null;
  subscriberId: string | null;
  suppressed: boolean;
}

const EMPTY_APPLY_RESULT: ApplyDeliveryEventResult = {
  ok: false,
  duplicate: false,
  tenantId: null,
  campaignId: null,
  subscriberId: null,
  suppressed: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Księguje zdarzenie dostawcy: log (idempotentny po eventId), stan dostawy
 * odbiorcy kampanii i - dla odbić/skarg - wpis na listę wykluczeń. Cała
 * logika skutków ubocznych żyje w SQL, żeby retry webhooka był atomowy.
 */
export async function applyDeliveryEvent(
  admin: DbClient,
  input: ApplyDeliveryEventInput,
): Promise<ApplyDeliveryEventResult> {
  const { data, error } = await rpcClient(admin).rpc("email_apply_delivery_event", {
    p_provider: input.provider,
    p_event_id: input.eventId,
    p_event_type: input.eventType,
    p_kind: input.kind,
    p_email: input.email,
    p_provider_message_id: input.providerMessageId,
    p_bounce_class: input.bounceClass,
    p_diagnostic: input.diagnostic,
    p_occurred_at: input.occurredAt,
    p_tenant_hint: input.tenantHint ?? null,
    p_campaign_hint: input.campaignHint ?? null,
    p_subscriber_hint: input.subscriberHint ?? null,
    p_payload: input.payload ?? {},
  });
  if (error) {
    console.error("[suppression] apply event failed", error.message);
    return EMPTY_APPLY_RESULT;
  }
  if (!isRecord(data)) return EMPTY_APPLY_RESULT;
  const suppression = isRecord(data.suppression) ? data.suppression : null;
  return {
    ok: data.ok === true,
    duplicate: data.duplicate === true,
    tenantId: typeof data.tenant_id === "string" ? data.tenant_id : null,
    campaignId: typeof data.campaign_id === "string" ? data.campaign_id : null,
    subscriberId: typeof data.subscriber_id === "string" ? data.subscriber_id : null,
    suppressed: suppression?.ok === true,
  };
}
