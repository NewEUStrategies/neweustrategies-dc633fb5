// Bilety z kodem QR dla bezpłatnego zapisu grupowego - logika server-only
// (deklaracja server function: `groupTicketCodes.functions.ts`).
//
// UWIERZYTELNIENIE KLUCZEM `manage_token` PROWADZĄCEGO, jak potwierdzenie
// zapisu (`registrationSelfNotify.server`). Serwer nie ufa niczemu poza nim:
// zgłoszenie, goście i adresy biorą się z bazy. Kto zna klucz, może najwyżej
// wyzwolić wysyłkę biletów na adresy podane przy zapisie - i tylko raz, bo
// baza wydaje kod jednorazowo (`ticket_code_sent_at`).
//
// NAJEMCA Z ZAUFANEGO HOSTA, KLUCZ JEDNĄ REGUŁĄ (REG-17). Bramką przed kluczem
// serwisowym (`issueAndSendTicketCodes` omija RLS) jest
// `event_registration_notify_payload_for_tenant` (A1, tylko `service_role`):
// najemca przychodzi argumentem z `resolveTenantIdForHost`, a klucz rozstrzyga
// `_event_manage_token_resolve` (cel `contact`) - klucz wygasły z końcem
// wydarzenia i klucz zgłoszenia anulowanego nie wydają już biletów. Stara
// funkcja (`event_registration_notify_payload`, najemca z nagłówka hosta) jest
// wołana WYŁĄCZNIE w oknie wdrożenia (PGRST202/42883), klientem anonimowym
// z nagłówkiem hosta.
//
// Zapis płatny przechodzi tędy bez skutku: miejsca nieopłacone nie dostają
// biletu, a wyda je webhook po zaksięgowaniu płatności.
import type { Json } from "@/integrations/supabase/types";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

export type GroupTicketCodesResult = { ok: true; sent: number } | { ok: false; error: string };

interface PayloadResult {
  data: Json | null;
  error: { message: string; code?: string } | null;
}

async function notifyPayload(tenantId: string, manageToken: string): Promise<PayloadResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_registration_notify_payload_for_tenant", {
    _tenant_id: tenantId,
    p_payload: { manage_token: manageToken },
  });
  if (!isMigrationPending(error)) return { data, error };

  const { hostAnonClient } = await import("@/lib/events/registrationSelfNotify.server");
  const legacy = await hostAnonClient();
  if (legacy === null) return { data: null, error: { message: "server_misconfigured" } };
  return legacy.rpc("event_registration_notify_payload", {
    p_payload: { manage_token: manageToken },
  });
}

/** Najemca z hosta bieżącego żądania albo `null` (awaria hosta, nie orzeczenie o kluczu). */
async function requestTenantId(): Promise<string | null> {
  try {
    const [{ currentTenantHost }, { resolveTenantIdForHost }] = await Promise.all([
      import("@/lib/http/requestHost"),
      import("@/lib/server/tenant.server"),
    ]);
    return (await resolveTenantIdForHost(await currentTenantHost())) ?? null;
  } catch {
    return null;
  }
}

/**
 * Wydaje i wysyła bilety gości grupy prowadzącego wskazanego kluczem. Odmowa
 * bramki (cudzy najemca, nieznany, wygasły albo zamknięty klucz) jest
 * zwróconą wartością i NIE dociera do klucza serwisowego.
 */
export async function sendGroupTicketCodesForRequest(
  manageToken: string,
): Promise<GroupTicketCodesResult> {
  const tenantId = await requestTenantId();
  if (!tenantId) return { ok: false, error: "tenant_unresolved" };

  const { data: payload, error } = await notifyPayload(tenantId, manageToken);
  if (error) return { ok: false, error: error.message };

  const row =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  const registrationId = typeof row?.registration_id === "string" ? row.registration_id : "";
  if (registrationId === "") return { ok: false, error: "not_found" };

  const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
  return { ok: true, sent: await issueAndSendTicketCodes(registrationId) };
}
