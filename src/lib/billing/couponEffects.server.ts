// Efekty kuponu B2B (warstwa członkowska + notatka/score CRM) - strona serwera.
//
// Kupon może nadawać warstwę członkostwa (`b2b_coupons.grants_tier_key`, pole
// edytowalne w /admin/coupons i pokazywane w kolumnie „Plan"). Funkcja bazy
// `redeem_b2b_coupon_with_effects` realizowała to nadanie od 21.07, ale NIC jej
// nie wywoływało - checkout woła `redeem_b2b_coupon` (tylko rezerwacja limitu),
// więc obietnica z panelu nie miała żadnego wykonawcy.
//
// Przepięcie checkoutu na wariant `_with_effects` byłoby gorsze niż brak
// funkcji: ten wariant nadawał warstwę już przy SKŁADANIU zamówienia
// (`status='pending'`), czyli przed jakąkolwiek płatnością - kod kuponu stawał
// się darmowym tokenem premium. Dlatego efekty odpalamy z tej samej ścieżki,
// która zamienia potwierdzoną płatność w dostęp (webhook Stripe + finalizacja
// trybu mock), przez `apply_b2b_coupon_effects` - a ta fail-closed sprawdza
// `payment_orders.status = 'paid'`.
//
// Idempotencja jest po stronie bazy (zatrzask `effects_applied_at`), więc
// wywołanie przy każdej dostawie webhooka jest bezpieczne i samonaprawiające:
// ponowna dostawa po nieudanej próbie dokończy nadanie.

export interface CouponEffectsOutcome {
  /** Czy ten przebieg zabrał zatrzask i wykonał efekty. */
  readonly applied: boolean;
  /** Powód pominięcia (order_not_paid, already_applied, no_redemption, ...). */
  readonly reason?: string;
  readonly tierGranted?: boolean;
  readonly tierKey?: string | null;
}

interface RawOutcome {
  applied?: unknown;
  reason?: unknown;
  tier_granted?: unknown;
  tier_key?: unknown;
}

function parseOutcome(raw: unknown): CouponEffectsOutcome {
  if (raw === null || typeof raw !== "object") return { applied: false, reason: "no_result" };
  const o = raw as RawOutcome;
  return {
    applied: o.applied === true,
    ...(typeof o.reason === "string" ? { reason: o.reason } : {}),
    ...(typeof o.tier_granted === "boolean" ? { tierGranted: o.tier_granted } : {}),
    ...(typeof o.tier_key === "string" || o.tier_key === null ? { tierKey: o.tier_key } : {}),
  };
}

/**
 * Stosuje efekty kuponu dla ZAPŁACONEGO zamówienia. Best-effort: nieudane
 * efekty nie mogą wywrócić księgowania płatności ani nadanego uprawnienia -
 * dlatego logujemy i zwracamy wynik, nie rzucamy.
 *
 * Wołać PO ustawieniu `payment_orders.status = 'paid'` - wcześniej RPC świadomie
 * odmawia (`order_not_paid`).
 */
export async function applyCouponEffectsForOrder(orderId: string): Promise<CouponEffectsOutcome> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("apply_b2b_coupon_effects", {
      _order_id: orderId,
    });
    if (error) {
      console.error("[billing] coupon effects failed", orderId, error.message);
      return { applied: false, reason: "rpc_error" };
    }
    const outcome = parseOutcome(data);
    if (outcome.applied && outcome.tierGranted === false && outcome.reason !== undefined) {
      // Kupon obiecuje warstwę, której nie ma w membership_tiers tego tenanta -
      // redakcja musi to zobaczyć, bo klient zapłacił za obiecany plan.
      console.warn(
        "[billing] coupon tier grant skipped",
        orderId,
        outcome.reason,
        outcome.tierKey ?? "",
      );
    }
    return outcome;
  } catch (e) {
    console.error("[billing] coupon effects threw", orderId, e);
    return { applied: false, reason: "exception" };
  }
}
