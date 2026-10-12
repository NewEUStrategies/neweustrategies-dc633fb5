// Odsłonięcie ukrytych biletów kodem - logika server-only dla
// `eventCodeReveal.functions.ts`.
//
// KOLEJNOŚĆ ŚCIAN:
//   1. limit prób (`allowCodeProbe`): kubełek IP, potem kubełek konta, gdy
//      wołający ma sesję - FAIL-CLOSED, odmowa PRZED najemcą i przed bazą;
//   2. najemca z zaufanego hosta (jak raport sponsora), przekazany do RPC
//      JAWNIE - `supabaseAdmin` nie niesie hosta, więc `public_tenant_id()`
//      wskazałby najemcę domyślnego na każdej innej domenie;
//   3. RPC `event_registration_revealed_tickets` (B1a, tylko `service_role`)
//      z kodem po normalizacji (trim + wielkie litery, jak przy zapisie kodu),
//      kontem z sesji (blokada poziomu członkostwa liczona dla wołającego)
//      i solonym skrótem adresu.
//
// PEŁNE WIERSZE, NIE SAME IDENTYFIKATORY (REG-05, decyzja D6). Od B1a
// formularz publiczny nie oddaje biletów ukrytych wcale, więc identyfikator
// nie miałby do czego się odnieść - odsłonięty bilet przychodzi tym samym
// obiektem co bilet formularza (`parseRegistrationFormTickets`). W oknie
// wdrożenia (PGRST202/42883) pytamy starą `event_coupon_revealed_tickets`,
// która oddaje identyfikatory, a wiersze ma jeszcze stary formularz.
//
// JEDNA ODPOWIEDŹ DLA PUDŁA. Kod nieistniejący, z innego wydarzenia albo
// z innego najemcy to ta sama pusta lista - baza nie odróżnia ich w wyniku,
// a ten moduł niczego nie dokleja. Odmowa limitu i awaria mają WŁASNE powody,
// bo „ten kod nic nie odsłania" powiedziane w czasie awarii to nieprawda
// o ważnym kodzie. Kod nie trafia do logów.
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";
import { optionalUserIdFromRequest } from "@/lib/auth/optionalUser.server";
import { normalizeCouponCode } from "@/lib/billing/coupons";
import { allowCodeProbe } from "@/lib/events/codeProbeLimit.server";
import {
  parseRegistrationFormTickets,
  type RegistrationFormTicket,
} from "@/lib/events/registrationFormSurface";
import { currentTenantHost } from "@/lib/http/requestHost";
import { requestRateSubject } from "@/lib/server/rateSubject.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

export type EventCodeRevealResult =
  | { ok: true; ticketIds: string[]; tickets: RegistrationFormTicket[] }
  | { ok: false; reason: "rate_limited" | "error" };

type RevealArgs = Database["public"]["Functions"]["event_registration_revealed_tickets"]["Args"];

export async function revealTicketsForEventCode(
  eventId: string,
  code: string,
): Promise<EventCodeRevealResult> {
  const request = getRequest();
  // Konto czytamy RAZ: limit potrzebuje go do kubełka konta, a baza - do
  // blokady poziomu członkostwa odsłoniętego biletu.
  let resolvedUser: Promise<string | null> | null = null;
  const callerId = (): Promise<string | null> => (resolvedUser ??= optionalUserIdFromRequest());
  const allowed = await allowCodeProbe(request.headers, callerId);
  if (!allowed) return { ok: false, reason: "rate_limited" };

  let tenantId: string | null = null;
  try {
    tenantId = await resolveTenantIdForHost(await currentTenantHost());
  } catch {
    tenantId = null;
  }
  // Bez najemcy nie ma w czym szukać - to awaria hosta, nie orzeczenie o kodzie.
  if (!tenantId) return { ok: false, reason: "error" };

  const normalized = normalizeCouponCode(code);
  const userId = await callerId();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_registration_revealed_tickets", {
    _tenant_id: tenantId,
    // NULL = gość - wygenerowany typ argumentu go nie zna (jak `club_set_cover`).
    _user_id: userId as RevealArgs["_user_id"],
    _probe_subject: requestRateSubject(request.headers),
    p_event_id: eventId,
    p_code: normalized,
  });
  if (!error) {
    const tickets = parseRegistrationFormTickets(data);
    return { ok: true, ticketIds: tickets.map((ticket) => ticket.id), tickets };
  }
  if (!isMigrationPending(error)) return { ok: false, reason: "error" };

  const legacy = await supabaseAdmin.rpc("event_coupon_revealed_tickets", {
    p_tenant: tenantId,
    p_event_id: eventId,
    p_code: normalized,
  });
  if (legacy.error) return { ok: false, reason: "error" };
  const ticketIds = Array.isArray(legacy.data)
    ? legacy.data.filter((id): id is string => typeof id === "string")
    : [];
  return { ok: true, ticketIds, tickets: [] };
}
