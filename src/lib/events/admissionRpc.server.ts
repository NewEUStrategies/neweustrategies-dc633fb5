// Wycena wejściówki/pakietu i zakup pakietu z SERWERA (server-only).
//
// DLACZEGO NIE Z PRZEGLĄDARKI. Każde wywołanie z kodem rabatowym to sonda
// „czy ten kod istnieje". Do migracji 20261007120600 ekran zakupu wołał
// `event_admission_quote` i `event_package_purchase` wprost przez PostgREST
// JWT kupującego, więc limit prób miał tylko kubełek KONTA - farma kont za
// jednym adresem zgadywała kody wydarzeń bez sufitu na adres. Teraz obie
// funkcje są tylko dla `service_role` i dostają najemcę hosta, konto z sesji
// (`requireSupabaseAuth`) i solony skrót adresu (`requestRateSubject`); baza
// liczy pudła w kubełku konta I adresu (wspólnym z kodami planu i biletu).
//
// OKNO WDROŻENIA. Kod wychodzi przed migracją: dopóki funkcji `*_for_user` nie
// ma (PGRST202/42883), wracamy do starego wywołania JWT kupującego, które do
// wejścia migracji nadal działa. Każdy inny błąd idzie do wołającego -
// z kodem i treścią, które ekran mapuje tym samym słownikiem co dotąd.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { requestProbeIdentity } from "@/lib/billing/couponRpc.server";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

type UserClient = SupabaseClient<Database>;

/** Odpowiedź RPC w kształcie PostgREST - przechodzi przez granicę funkcji serwerowej. */
export interface AdmissionRpcResult {
  data: Json | null;
  error: { message: string; code?: string } | null;
}

function plainError(error: { message: string; code?: string } | null): AdmissionRpcResult["error"] {
  if (error === null) return null;
  // Obiekt błędu supabase-js niesie też `details`/`hint` - ekran czyta tylko
  // treść i kod, a reszta nie powinna wychodzić poza serwer.
  return error.code === undefined
    ? { message: error.message }
    : { message: error.message, code: error.code };
}

const TENANT_UNRESOLVED: AdmissionRpcResult = {
  data: null,
  error: { message: "tenant_unresolved: unknown host" },
};

/** `event_admission_quote_for_user` dla konta z sesji (skalar jsonb). */
export async function quoteAdmissionForUser(
  userClient: UserClient,
  userId: string,
  payload: { [key: string]: Json | undefined },
): Promise<AdmissionRpcResult> {
  const { tenantId, probeSubject } = await requestProbeIdentity();
  // Bez najemcy nie ma w czym szukać - to awaria hosta, nie orzeczenie o kodzie.
  if (!tenantId) return TENANT_UNRESOLVED;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_admission_quote_for_user", {
    _tenant_id: tenantId,
    _user_id: userId,
    _probe_subject: probeSubject,
    p_payload: payload,
  });
  if (!isMigrationPending(error)) return { data, error: plainError(error) };

  const legacy = await userClient.rpc("event_admission_quote", { p_payload: payload });
  return { data: legacy.data, error: plainError(legacy.error) };
}

/** `event_package_purchase_for_user` dla konta z sesji (skalar jsonb). */
export async function purchasePackageForUser(
  userClient: UserClient,
  userId: string,
  payload: { [key: string]: Json | undefined },
): Promise<AdmissionRpcResult> {
  const { tenantId, probeSubject } = await requestProbeIdentity();
  if (!tenantId) return TENANT_UNRESOLVED;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_package_purchase_for_user", {
    _tenant_id: tenantId,
    _user_id: userId,
    _probe_subject: probeSubject,
    p_payload: payload,
  });
  if (!isMigrationPending(error)) return { data, error: plainError(error) };

  const legacy = await userClient.rpc("event_package_purchase", { p_payload: payload });
  return { data: legacy.data, error: plainError(legacy.error) };
}

/**
 * `event_ticket_checkout_quote_for_user` dla konta z sesji (skalar jsonb) -
 * wycena wejściówki dla kasy, podglądu i odbioru biletu z planu.
 *
 * Kod dostępu do biletu (prasa, partnerzy) to też sonda „czy ten kod
 * istnieje": od migracji 20261007140400 baza liczy jego pudła w kubełku
 * biletu, konta i adresu, a pudło oddaje WARTOŚCIĄ (`{ ok: false, error }`),
 * bo wyjątek wycofałby zliczenie. Stara funkcja z JWT kupującego była dla
 * zalogowanego wyrocznią bez żadnego licznika.
 */
export async function quoteTicketCheckoutForUser(
  userClient: UserClient,
  userId: string,
  input: { ticketTypeId: string; accessCode?: string },
): Promise<AdmissionRpcResult> {
  const { tenantId, probeSubject } = await requestProbeIdentity();
  if (!tenantId) return TENANT_UNRESOLVED;

  // `undefined` = brak klucza w żądaniu; RPC ma wtedy własny default.
  const accessCode = input.accessCode === "" ? undefined : input.accessCode;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_ticket_checkout_quote_for_user", {
    _tenant_id: tenantId,
    _user_id: userId,
    _probe_subject: probeSubject,
    p_ticket_type_id: input.ticketTypeId,
    p_access_code: accessCode,
  });
  if (!isMigrationPending(error)) return { data, error: plainError(error) };

  const legacy = await userClient.rpc("event_ticket_checkout_quote", {
    p_ticket_type_id: input.ticketTypeId,
    p_access_code: accessCode,
  });
  return { data: legacy.data, error: plainError(legacy.error) };
}
