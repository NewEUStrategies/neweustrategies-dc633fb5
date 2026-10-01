// Odsłonięcie ukrytych biletów kodem - logika server-only dla
// `eventCodeReveal.functions.ts`.
//
// KOLEJNOŚĆ ŚCIAN:
//   1. limit prób (`allowCodeProbe`): kubełek IP, potem kubełek konta, gdy
//      wołający ma sesję - FAIL-CLOSED, odmowa PRZED najemcą i przed bazą;
//   2. najemca z zaufanego hosta (jak raport sponsora), przekazany do RPC
//      JAWNIE - `supabaseAdmin` nie niesie hosta, więc `public_tenant_id()`
//      wskazałby najemcę domyślnego na każdej innej domenie;
//   3. RPC `event_coupon_revealed_tickets` (tylko `service_role`) z kodem po
//      normalizacji (trim + wielkie litery, jak przy zapisie kodu).
//
// JEDNA ODPOWIEDŹ DLA PUDŁA. Kod nieistniejący, z innego wydarzenia albo
// z innego najemcy to ta sama pusta lista - baza nie odróżnia ich w wyniku,
// a ten moduł niczego nie dokleja. Odmowa limitu i awaria mają WŁASNE powody,
// bo „ten kod nic nie odsłania" powiedziane w czasie awarii to nieprawda
// o ważnym kodzie. Kod nie trafia do logów.
import { getRequest } from "@tanstack/react-start/server";

import { optionalUserIdFromRequest } from "@/lib/auth/optionalUser.server";
import { normalizeCouponCode } from "@/lib/billing/coupons";
import { allowCodeProbe } from "@/lib/events/codeProbeLimit.server";
import { currentTenantHost } from "@/lib/http/requestHost";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";

export type EventCodeRevealResult =
  { ok: true; ticketIds: string[] } | { ok: false; reason: "rate_limited" | "error" };

export async function revealTicketsForEventCode(
  eventId: string,
  code: string,
): Promise<EventCodeRevealResult> {
  const request = getRequest();
  const allowed = await allowCodeProbe(request.headers, optionalUserIdFromRequest);
  if (!allowed) return { ok: false, reason: "rate_limited" };

  let tenantId: string | null = null;
  try {
    tenantId = await resolveTenantIdForHost(await currentTenantHost());
  } catch {
    tenantId = null;
  }
  // Bez najemcy nie ma w czym szukać - to awaria hosta, nie orzeczenie o kodzie.
  if (!tenantId) return { ok: false, reason: "error" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_coupon_revealed_tickets", {
    p_tenant: tenantId,
    p_event_id: eventId,
    p_code: normalizeCouponCode(code),
  });
  if (error) return { ok: false, reason: "error" };
  const ticketIds = Array.isArray(data)
    ? data.filter((id): id is string => typeof id === "string")
    : [];
  return { ok: true, ticketIds };
}
