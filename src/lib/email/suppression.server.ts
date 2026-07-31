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
import {
  suppressionBlocks,
  type EmailCategory,
  type SuppressionReason,
  type SuppressionScope,
} from "./suppressionPolicy";

type DbClient = SupabaseClient<Database>;

// Domena powodów/zakresów żyje w czystym module polityki (importowalnym też
// przez panel); re-eksport zachowuje istniejące importy z tego pliku.
export type { EmailCategory, SuppressionReason, SuppressionScope };

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

/**
 * Tenant dla adresu poza kontekstem żądania (wypis, webhook dostawcy, mail
 * transakcyjny z workera). Lista wykluczeń jest tenant-scoped, a te ścieżki
 * biegną na service_role - nie mają ani sesji, ani nagłówka hosta. Kolejność
 * rozstrzygania i fallback na tenanta domyślnego żyją w SQL
 * (email_resolve_tenant_for_address), żeby trigger widoku zgodności i kod
 * aplikacji nie mogły się rozjechać.
 */
export async function resolveTenantForAddress(
  admin: DbClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await rpcClient(admin).rpc("email_resolve_tenant_for_address", {
    p_email: normalize(email),
  });
  if (error) {
    console.error("[suppression] tenant resolve failed", error.message);
    return null;
  }
  return typeof data === "string" && data ? data : null;
}

export interface SendGateInput {
  email: string;
  category: EmailCategory;
  /** Znany tenant (pomija zapytanie rozwiązujące). */
  tenantId?: string | null;
}

export interface SendGateResult {
  allowed: boolean;
  /** Trafiona blokada - także wtedy, gdy polityka przepuszcza wiadomość. */
  hit: SuppressionHit | null;
  tenantId: string | null;
}

/**
 * JEDNA brama, przez którą przechodzi każda wysyłka 1:1 (transakcyjna, digest,
 * potwierdzenie zapisu, wysyłka z kolejki). Łączy dwa pytania, które wcześniej
 * odpowiadano osobno i niespójnie: "czy adres jest zablokowany?" oraz "czy TA
 * kategoria wiadomości respektuje TEN powód blokady?".
 *
 * Fail-open na błędzie odczytu jest świadomy i zgodny z resztą modułu: awaria
 * bazy nie może zamilczeć poczty transakcyjnej, a webhooki i tak zablokują
 * adres przy najbliższym odbiciu. Twarda blokada bez potwierdzenia z bazy
 * kosztowałaby więcej niż jedna wysyłka na adres, który może być już czysty.
 */
export async function checkSendAllowed(
  admin: DbClient,
  input: SendGateInput,
): Promise<SendGateResult> {
  const email = normalize(input.email);
  if (!email) return { allowed: false, hit: null, tenantId: input.tenantId ?? null };

  const tenantId = input.tenantId ?? (await resolveTenantForAddress(admin, email));
  if (!tenantId) return { allowed: true, hit: null, tenantId: null };

  const found = await fetchSuppressedEmails(admin, tenantId, [email]);
  const hit = found.get(email) ?? null;
  if (!hit) return { allowed: true, hit: null, tenantId };

  return {
    allowed: !suppressionBlocks({
      reason: hit.reason,
      scope: hit.scope,
      category: input.category,
    }),
    hit,
    tenantId,
  };
}

export interface UnsubscribeResult {
  ok: boolean;
  alreadyUnsubscribed: boolean;
  tenantId: string | null;
  error?: string;
}

/**
 * Wypis jednym kliknięciem. Cała praca (zużycie tokenu, blokada na liście
 * kanonicznej, zdjęcie subskrypcji przez trigger) dzieje się w JEDNEJ
 * transakcji SQL - inaczej przerwanie w połowie zostawiałoby adres wypisany z
 * newslettera, ale bez blokady zatrzymującej digesty, albo odwrotnie.
 */
export async function unsubscribeByToken(
  admin: DbClient,
  token: string,
): Promise<UnsubscribeResult> {
  const { data, error } = await rpcClient(admin).rpc("email_unsubscribe_by_token", {
    p_token: token,
  });
  if (error) {
    console.error("[suppression] unsubscribe failed", error.message);
    return { ok: false, alreadyUnsubscribed: false, tenantId: null, error: error.message };
  }
  if (!isRecord(data)) {
    return { ok: false, alreadyUnsubscribed: false, tenantId: null, error: "invalid_response" };
  }
  return {
    ok: data.ok === true,
    alreadyUnsubscribed: data.already_unsubscribed === true,
    tenantId: typeof data.tenant_id === "string" ? data.tenant_id : null,
    error: typeof data.error === "string" ? data.error : undefined,
  };
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
