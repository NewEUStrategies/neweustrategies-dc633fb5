// Potwierdzenie zapisu („zgłoszenie przyjęte" / „zgłoszenie zaakceptowane")
// kluczem samoobsługi - logika server-only.
//
// JEDEN WOŁAJĄCY. Od REG-04 potwierdzenie wysyła sam serwer po zapisie
// (`eventRegistration.server.ts`, dostawa „utworzono"); przeglądarka gościa
// bez konta nie dostaje klucza samoobsługi, więc publicznej server function
// do tej wysyłki nie ma.
//
// NAJEMCA Z ARGUMENTU, NIE Z NAGŁÓWKA. `event_registration_notify_payload_for_
// tenant` (A1, 20261012130500, tylko `service_role`) dostaje najemcę jawnie
// i rozstrzyga klucz JEDNĄ regułą (`_event_manage_token_resolve`, cel
// `contact`): klucz wygasły z końcem wydarzenia i klucz zgłoszenia anulowanego
// nie oddają adresu.
//
// BEZ ŚCIEŻKI ZAPASOWEJ. Kod wyszedł przed migracją 20261012130500, więc brak
// tej funkcji (PGRST202/42883) cofał odczyt do starej
// `event_registration_notify_payload` (najemca z `public_tenant_id()`)
// klientem anonimowym z nagłówkiem hosta. To okno jest zamknięte: typy
// regenerowane z bazy produkcji przez bota Lovable (68ba76e1 z 22.10.2026,
// bb61b8b7 z 25.10.2026) usuwały obiekty, których produkcja nie ma, a tę
// funkcję zostawiły z argumentami, które wysyła ten moduł. 20261012160000
// odbiera `anon` i `authenticated` EXECUTE starej funkcji, więc na bazie
// ze wszystkimi migracjami stara ścieżka kończy się 42501 (pomiar kontraktu
// TS<->SQL na PG16). Brak funkcji to teraz odmowa zwrócona wartością, jak
// każdy inny błąd bazy.
//
// RODZAJ MAILA WYNIKA ZE STATUSU, NIE Z ŻYCZENIA KLIENTA. Zapis oczekujący
// dostaje „zgłoszenie przyjęte", zatwierdzony od ręki - „zaakceptowane". Gdyby
// wybierał klient, mógłby wysłać sobie potwierdzenie miejsca, którego nie ma.
//
// FAIL-SOFT. Brak maila nie unieważnia zapisu - każda odmowa jest zwróconą
// wartością, nigdy wyjątkiem.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";

export type SelfNotifyResult =
  | { ok: true; skipped?: "duplicate" | "suppressed" | "not_notifiable" }
  | { ok: false; error: string };

interface PayloadResult {
  data: Json | null;
  error: { message: string; code?: string } | null;
}

/**
 * Klient z kluczem PUBLIKOWALNYM i nagłówkiem hosta (`fetchWithTenantHost`) -
 * dla funkcji, które ustalają najemcę przez `public_tenant_id()`, np.
 * przypięcia atrybucji kluczem samoobsługi. Rola `anon`, bez tokenu
 * wołającego. Klucz serwisowy nagłówka hosta nie niesie i trafiłby w najemcę
 * domyślnego. Brak konfiguracji = `null`.
 */
export async function hostAnonClient(): Promise<SupabaseClient<Database> | null> {
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
    global: { fetch: fetchWithTenantHost },
  });
}

async function notifyPayload(tenantId: string, manageToken: string): Promise<PayloadResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_registration_notify_payload_for_tenant", {
    _tenant_id: tenantId,
    p_payload: { manage_token: manageToken },
  });
  return { data, error };
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
      // Najemca nadawcy z WIERSZA bazy (`tenant_id`), a gdy go nie ma - ten,
      // w którym serwer rozstrzygnął klucz.
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
