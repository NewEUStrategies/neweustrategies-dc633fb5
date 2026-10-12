// Potwierdzenie zapisu („zgłoszenie przyjęte" / „zgłoszenie zaakceptowane")
// kluczem samoobsługi - logika server-only.
//
// DWAJ WOŁAJĄCY, JEDNA REGUŁA. Od REG-04 potwierdzenie wysyła sam serwer po
// zapisie (`eventRegistration.server.ts`, dostawa „utworzono"), a publiczna
// funkcja `confirmEventRegistrationEmail` zostaje cienką obwódką dla starszych
// wywołań. Obie drogi kończą się tutaj, więc rodzaj maila, adres i klucz
// idempotencji nie mogą się rozjechać.
//
// NAJEMCA Z ARGUMENTU, NIE Z NAGŁÓWKA. `event_registration_notify_payload_for_
// tenant` (A1, 20261012100000, tylko `service_role`) dostaje najemcę jawnie
// i rozstrzyga klucz JEDNĄ regułą (`_event_manage_token_resolve`, cel
// `contact`): klucz wygasły z końcem wydarzenia i klucz zgłoszenia anulowanego
// nie oddają adresu. Stara funkcja (`event_registration_notify_payload`, anon,
// najemca z `public_tenant_id()`) jest wołana WYŁĄCZNIE w oknie wdrożenia
// (PGRST202/42883) - klientem anonimowym z nagłówkiem hosta, bo klucz
// serwisowy nagłówka nie niesie.
//
// RODZAJ MAILA WYNIKA ZE STATUSU, NIE Z ŻYCZENIA KLIENTA. Zapis oczekujący
// dostaje „zgłoszenie przyjęte", zatwierdzony od ręki - „zaakceptowane". Gdyby
// wybierał klient, mógłby wysłać sobie potwierdzenie miejsca, którego nie ma.
//
// FAIL-SOFT. Brak maila nie unieważnia zapisu - każda odmowa jest zwróconą
// wartością, nigdy wyjątkiem.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

export type SelfNotifyResult =
  | { ok: true; skipped?: "duplicate" | "suppressed" | "not_notifiable" }
  | { ok: false; error: string };

interface PayloadResult {
  data: Json | null;
  error: { message: string; code?: string } | null;
}

/**
 * Klient z kluczem PUBLIKOWALNYM i nagłówkiem hosta (`fetchWithTenantHost`) -
 * dla funkcji, które ustalają najemcę przez `public_tenant_id()`: starych
 * funkcji w oknie wdrożenia i przypięcia atrybucji kluczem samoobsługi.
 * Klucz serwisowy nagłówka hosta nie niesie i trafiłby w najemcę domyślnego.
 *
 * `bearer` - token wołającego, przekazany dalej BEZ interpretacji (podpis
 * sprawdza PostgREST); `null` = gość. Brak konfiguracji = `null`.
 */
export async function hostAnonClient(
  bearer: string | null = null,
): Promise<SupabaseClient<Database> | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const [{ createClient }, { fetchWithTenantHost }] = await Promise.all([
    import("@supabase/supabase-js"),
    import("@/integrations/supabase/tenant-host-fetch"),
  ]);
  return createClient<Database>(url, key, {
    // Proces serwerowy obsługuje wielu gości naraz - sesja nie może się
    // utrwalić ani przeciec między żądaniami.
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global:
      bearer === null
        ? { fetch: fetchWithTenantHost }
        : { fetch: fetchWithTenantHost, headers: { Authorization: `Bearer ${bearer}` } },
  });
}

async function notifyPayload(tenantId: string, manageToken: string): Promise<PayloadResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_registration_notify_payload_for_tenant", {
    _tenant_id: tenantId,
    p_payload: { manage_token: manageToken },
  });
  if (!isMigrationPending(error)) return { data, error };

  const legacy = await hostAnonClient();
  if (legacy === null) return { data: null, error: { message: "server_misconfigured" } };
  return legacy.rpc("event_registration_notify_payload", {
    p_payload: { manage_token: manageToken },
  });
}

/**
 * Mail o zgłoszeniu pod kluczem `manageToken` w najemcy `tenantId`. Adres,
 * imię, język i rodzaj wiadomości biorą się z bazy. Nigdy nie rzuca.
 */
export async function sendRegistrationNoticeForManageToken(
  tenantId: string,
  manageToken: string,
): Promise<SelfNotifyResult> {
  try {
    const { data: payload, error } = await notifyPayload(tenantId, manageToken);
    if (error) return { ok: false, error: error.message };

    const row =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const email = typeof row?.email === "string" ? row.email.trim() : "";
    if (row === null || email === "") return { ok: false, error: "not_found" };

    const status = typeof row.status === "string" ? row.status : "";
    const notice =
      status === "pending" || status === "waitlist"
        ? ("received" as const)
        : status === "approved" || status === "attended"
          ? ("approved" as const)
          : null;
    if (notice === null) return { ok: true, skipped: "not_notifiable" };

    const { buildRegistrationNotice } = await import("@/lib/events/registrationNotify.server");
    // Klucz jawny wędruje do treści maila: to JEDYNY moment, w którym serwis
    // go widzi (baza trzyma sam skrót), a gość bez konta nie ma go skąd odtworzyć.
    const content = buildRegistrationNotice(notice, row, manageToken);
    const registrationId = typeof row.registration_id === "string" ? row.registration_id : "";

    const { sendTxEmail } = await import("@/lib/email/transactional.server");
    const result = await sendTxEmail({
      type: notice === "received" ? "event_registration_received" : "event_registration_approved",
      to: email,
      lang: content.lang,
      subjectName: content.eventTitle,
      details: content.details,
      ctaPath: content.ctaPath,
      ctaLabel: content.ctaLabel ?? undefined,
      metaName: content.firstName,
      // Najemca nadawcy z WIERSZA bazy (stara funkcja go oddaje), a gdy go
      // nie ma - ten, w którym serwer rozstrzygnął klucz.
      tenantId: content.tenantId ?? tenantId,
      idempotencyKey: `event-registration:${registrationId}:${notice}`,
    });

    if (!result.ok) return { ok: false, error: result.reason ?? result.error ?? "send_failed" };
    return result.skipped === "duplicate" ? { ok: true, skipped: "duplicate" } : { ok: true };
  } catch (err) {
    console.error("[events] registration notice failed", err);
    return { ok: false, error: "send_failed" };
  }
}

/**
 * Obwódka publicznej funkcji `confirmEventRegistrationEmail`: najemca z
 * zaufanego hosta bieżącego żądania. Host bez najemcy to awaria hosta, nie
 * orzeczenie o kluczu - bez pytania bazy.
 */
export async function confirmRegistrationNoticeForRequest(
  manageToken: string,
): Promise<SelfNotifyResult> {
  let tenantId: string | null = null;
  try {
    const [{ currentTenantHost }, { resolveTenantIdForHost }] = await Promise.all([
      import("@/lib/http/requestHost"),
      import("@/lib/server/tenant.server"),
    ]);
    tenantId = await resolveTenantIdForHost(await currentTenantHost());
  } catch {
    tenantId = null;
  }
  if (!tenantId) return { ok: false, error: "tenant_unresolved" };
  return sendRegistrationNoticeForManageToken(tenantId, manageToken);
}
