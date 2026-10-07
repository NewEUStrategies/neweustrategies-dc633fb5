// Kod rabatowy (na plan i na bilet wydarzenia) i rezerwacja jego użycia -
// JEDNA warstwa dla podglądu kuponu, wyceny biletu i obu silników kasy
// (server-only).
//
// DLACZEGO ROLA SERWISOWA. Od migracji 20261007120200 `validate_b2b_coupon`
// i `redeem_b2b_coupon`, a od 20261007120600 także
// `validate_event_ticket_coupon`, nie są wykonywalne dla `authenticated`
// (audyt ed13 N-13-1): zalogowany wołający PostgREST wprost omijał limit prób
// po adresie, a rezerwacja bez zamówienia zjadała pulę kodu. Baza ma teraz funkcje tylko
// dla `service_role`, które dostają najemcę, konto i solony skrót adresu
// JAWNIE - `supabaseAdmin` nie niesie ani hosta, ani JWT, więc bez tych
// argumentów baza nie miałaby po czym liczyć pudeł ani wiązać zamówienia.
//
// SKĄD TOŻSAMOŚĆ:
//   * najemca walidacji - zaufany host żądania (`currentTenantHost`), ta sama
//     reguła co odsłanianie biletów kodem (`eventCodeReveal.server.ts`);
//   * najemca rezerwacji - `tenant_id` ZAMÓWIENIA, które baza ostemplowała
//     przy wstawieniu; rezerwacja w innym najemcy niż zamówienie to odmowa;
//   * konto - sesja z `requireSupabaseAuth` (wołający podaje `userId`);
//   * adres - `requestRateSubject` (solony skrót, nigdy surowy adres).
//
// OKNO WDROŻENIA. Kod wychodzi przed migracją: dopóki funkcji `*_for_user`
// nie ma (PGRST202/42883), wracamy do starego wywołania JWT kupującego, które
// do wejścia migracji nadal działa. Każdy inny błąd idzie do wołającego.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";
import { currentTenantHost } from "@/lib/http/requestHost";
import { requestRateSubject } from "@/lib/server/rateSubject.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

type UserClient = SupabaseClient<Database>;

/** Odpowiedź RPC w kształcie, który czytają `parseCouponVerdict` i kasa. */
export interface CouponRpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface PlanCouponValidation {
  userId: string;
  /** Kod już po normalizacji (trim + wielkie litery). */
  code: string;
  /** Plan, którego dotyczy zakup; zerowy UUID dla zakupu poza planem. */
  planId: string;
  amountCents: number;
  currency: string;
}

export interface EventTicketCouponValidation {
  userId: string;
  /** Kod już po normalizacji (trim + wielkie litery). */
  code: string;
  eventId: string;
  /** Pozycja cennika; zerowy UUID dla biletu z wiersza wydarzenia. */
  ticketTypeId: string;
  amountCents: number;
  currency: string;
}

/** Zwolnienie użycia kodu na NIEOPŁACONYM zamówieniu tego konta. */
export interface CouponRelease {
  /** `tenant_id` zamówienia - stempel bazy, nie wartość z żądania. */
  tenantId: string;
  userId: string;
  couponId: string;
  orderId: string;
}

export interface CouponRedemption {
  /** `tenant_id` zamówienia - stempel bazy, nie wartość z żądania. */
  tenantId: string;
  userId: string;
  couponId: string;
  orderId: string;
  /** RABAT (nie kwota zapłacona) - semantyka z 20260725090200. */
  appliedCents: number;
  originalCents: number;
  currency: string;
}

function requestHeaders(): Headers | null {
  try {
    return getRequest().headers;
  } catch {
    return null;
  }
}

async function requestTenantId(): Promise<string | null> {
  try {
    return await resolveTenantIdForHost(await currentTenantHost());
  } catch {
    return null;
  }
}

/**
 * Najemca hosta i solony skrót adresu BIEŻĄCEGO żądania - argumenty tożsamości
 * każdej funkcji `*_for_user` sond kodów (także wyceny i zakupu pakietu,
 * `src/lib/events/admissionRpc.server.ts`).
 */
export async function requestProbeIdentity(): Promise<{
  tenantId: string | null;
  probeSubject: string;
}> {
  return { tenantId: await requestTenantId(), probeSubject: requestRateSubject(requestHeaders()) };
}

/** Werdykt `validate_b2b_coupon_for_user` dla konta z sesji (skalar jsonb). */
export async function validatePlanCouponForUser(
  userClient: UserClient,
  input: PlanCouponValidation,
): Promise<CouponRpcResult> {
  const tenantId = await requestTenantId();
  // Bez najemcy nie ma w czym szukać - to awaria hosta, nie orzeczenie o kodzie.
  if (!tenantId) return { data: null, error: { message: "tenant_unresolved: unknown host" } };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("validate_b2b_coupon_for_user", {
    _tenant_id: tenantId,
    _user_id: input.userId,
    _probe_subject: requestRateSubject(requestHeaders()),
    _code: input.code,
    _plan_id: input.planId,
    _amount_cents: input.amountCents,
    _currency: input.currency,
  });
  if (!isMigrationPending(error)) return { data, error };

  const legacy = await userClient.rpc("validate_b2b_coupon", {
    _code: input.code,
    _plan_id: input.planId,
    _amount_cents: input.amountCents,
    _currency: input.currency,
  });
  return { data: legacy.data, error: legacy.error };
}

/**
 * Werdykt `validate_event_ticket_coupon_for_user` dla konta z sesji (skalar
 * jsonb). Pudło liczy się w kubełku konta I adresu - ten sam kubełek adresu co
 * kody planu, więc zmiana ścieżki nie daje nowych prób.
 */
export async function validateEventTicketCouponForUser(
  userClient: UserClient,
  input: EventTicketCouponValidation,
): Promise<CouponRpcResult> {
  const tenantId = await requestTenantId();
  if (!tenantId) return { data: null, error: { message: "tenant_unresolved: unknown host" } };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("validate_event_ticket_coupon_for_user", {
    _tenant_id: tenantId,
    _user_id: input.userId,
    _probe_subject: requestRateSubject(requestHeaders()),
    _code: input.code,
    _event_id: input.eventId,
    _ticket_type_id: input.ticketTypeId,
    _amount_cents: input.amountCents,
    _currency: input.currency,
  });
  if (!isMigrationPending(error)) return { data, error };

  const legacy = await userClient.rpc("validate_event_ticket_coupon", {
    _code: input.code,
    _event_id: input.eventId,
    _ticket_type_id: input.ticketTypeId,
    _amount_cents: input.amountCents,
    _currency: input.currency,
  });
  return { data: legacy.data, error: legacy.error };
}

/** Atomowa rezerwacja użycia kodu na zamówieniu tego konta (`true` = zajęte). */
export async function redeemCouponForUser(
  userClient: UserClient,
  input: CouponRedemption,
): Promise<CouponRpcResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("redeem_b2b_coupon_for_user", {
    _tenant_id: input.tenantId,
    _user_id: input.userId,
    _coupon_id: input.couponId,
    _order_id: input.orderId,
    _applied_cents: input.appliedCents,
    _original_cents: input.originalCents,
    _currency: input.currency,
  });
  if (!isMigrationPending(error)) return { data, error };

  const legacy = await userClient.rpc("redeem_b2b_coupon", {
    _coupon_id: input.couponId,
    _order_id: input.orderId,
    _applied_cents: input.appliedCents,
    _original_cents: input.originalCents,
    _currency: input.currency,
  });
  return { data: legacy.data, error: legacy.error };
}

/**
 * Zwolnienie użycia kodu po odmowie dostawcy płatności (`true` = oddane).
 * Baza oddaje użycie wyłącznie dla nieopłaconego (pending/failed/canceled)
 * zamówienia TEGO konta w TYM najemcy (20261007140200) - wcześniej każdy
 * zalogowany zwalniał realizację także opłaconego zamówienia i kod
 * jednorazowy był znów ważny.
 */
export async function releaseCouponForUser(
  userClient: UserClient,
  input: CouponRelease,
): Promise<CouponRpcResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("release_b2b_coupon_for_user", {
    _tenant_id: input.tenantId,
    _user_id: input.userId,
    _coupon_id: input.couponId,
    _order_id: input.orderId,
  });
  if (!isMigrationPending(error)) return { data, error };

  const legacy = await userClient.rpc("release_b2b_coupon", {
    _coupon_id: input.couponId,
    _order_id: input.orderId,
  });
  return { data: legacy.data, error: legacy.error };
}
