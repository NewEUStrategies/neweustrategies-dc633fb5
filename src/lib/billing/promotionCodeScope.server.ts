// Kody promocyjne operatora wpisane przez kupującego w kasie Stripe - czyje są
// i czy wolno nimi opłacić TO zamówienie (S8, przegląd 7.5 i 0.5).
//
// DLACZEGO TO W OGÓLE JEST PROBLEM. Konto Stripe jest WSPÓLNE dla wszystkich
// najemców, a katalog produktów też. Kod zsynchronizowany przez najemcę A
// (`syncCouponDiscounts`) działa więc w kasie najemcy B, który ma włączone
// pole kodu - a sama flaga „rozjazd kwoty" po zapłacie nadawała dostęp mimo
// wszystko: kod 100% najemcy A otwierał płatne treści najemcy B. Stripe nie
// umie zawęzić kodu do najemcy ani do INTERWAŁU planu (miesięczny i roczny
// dzielą produkt), więc jedynym miejscem, które to rozstrzyga, jest realizacja.
//
// REGUŁY (metadane kodu zapisuje synchronizacja: `{ source, tenant_id,
// coupon_id }`):
//   - `tenant_id` INNY niż najemca zamówienia -> `foreign_promotion_code`
//     (wstrzymanie: pieniądze pobrane, dostępu nie ma do decyzji człowieka);
//   - brak `tenant_id` -> kod operatora zrobiony ręcznie w panelu Stripe:
//     przepuszczamy i zapisujemy ślad (`promotion_code_unscoped`);
//   - `tenant_id` najemcy zamówienia + `coupon_id` -> kupon z NASZEJ bazy
//     (w zakresie najemcy zamówienia) musi istnieć, być aktywny i obejmować
//     plan / wydarzenie zamówienia; inaczej `promotion_code_out_of_scope`.
//     Kod przypięty w Stripe do produktu planu miesięcznego przechodzi też
//     w kasie planu rocznego (wspólny produkt) - tę lukę zamyka dopiero to
//     porównanie z `plan_ids`.
//
// Błąd odczytu (operator albo baza) RZUCA - webhook wróci przy ponowieniu.
// Cicha decyzja „przepuść" przy awarii otwierałaby dokładnie tę furtkę, którą
// moduł zamyka, a „wstrzymaj" karałaby uczciwego kupującego za chwilową awarię.
//
// Moduł server-only (klient Stripe i klient roli serwisowej).
import type { StripeEnv } from "@/lib/stripe.server";

export type PromotionHoldReason = "foreign_promotion_code" | "promotion_code_out_of_scope";

export interface PromotionCodeReview {
  /** Kod, którym nie wolno było opłacić zamówienia - realizacja do przeglądu. */
  readonly hold: {
    readonly reason: PromotionHoldReason;
    readonly promotionCodeIds: readonly string[];
  } | null;
  /** Kody operatora bez najemcy (utworzone ręcznie w panelu Stripe). */
  readonly unscopedIds: readonly string[];
}

export const NO_PROMOTION_CODE_REVIEW: PromotionCodeReview = { hold: null, unscopedIds: [] };

/** Zamówienie w zakresie potrzebnym do oceny kodu - wartości z NASZEGO wiersza. */
export interface PromotionScopeOrder {
  readonly id: string;
  readonly tenantId: string | null;
  readonly planId: string | null;
  readonly eventId: string | null;
}

/** Identyfikator kuponu z bazy - zapisuje go synchronizacja (`b2b_coupons.id`). */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Czy kupon najemcy zamówienia obejmuje to zamówienie. Odczyt zawężony do
 * najemcy ZAMÓWIENIA (R-TS): kupon o tym identyfikatorze w innym najemcy to
 * dla tego zamówienia kupon nieistniejący.
 */
async function couponCovers(couponId: string, order: PromotionScopeOrder): Promise<boolean> {
  if (!order.tenantId || !UUID_SHAPE.test(couponId)) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("b2b_coupons")
    .select("id, active, plan_ids, event_ids")
    .eq("id", couponId)
    .eq("tenant_id", order.tenantId)
    .maybeSingle();
  if (error) {
    throw new Error(`promotion code scope: coupon lookup failed (${couponId}): ${error.message}`);
  }
  if (!data || data.active !== true) return false;
  const planIds = data.plan_ids ?? [];
  if (planIds.length > 0 && (!order.planId || !planIds.includes(order.planId))) return false;
  const eventIds = data.event_ids ?? [];
  if (eventIds.length > 0 && (!order.eventId || !eventIds.includes(order.eventId))) return false;
  return true;
}

/**
 * Ocena kodów promocyjnych sesji wobec zamówienia. Pusta lista (nasz kupon
 * jedzie jako `discounts[].coupon` bez kodu) nie dotyka ani operatora, ani
 * bazy. Kod obcego najemcy wygrywa z kodem spoza zakresu - to cięższy przypadek.
 */
export async function reviewPromotionCodes(
  env: StripeEnv,
  promotionCodeIds: readonly string[] | null | undefined,
  order: PromotionScopeOrder,
): Promise<PromotionCodeReview> {
  const ids = [
    ...new Set((promotionCodeIds ?? []).map(text).filter((id): id is string => id !== null)),
  ];
  if (ids.length === 0) return NO_PROMOTION_CODE_REVIEW;

  const { getStripeClient } = await import("@/lib/stripe.server");
  const stripe = await getStripeClient(env);

  const foreign: string[] = [];
  const outOfScope: string[] = [];
  const unscoped: string[] = [];
  for (const id of ids) {
    let metadata: Record<string, unknown>;
    try {
      const code = await stripe.promotionCodes.retrieve(id);
      metadata = (code.metadata ?? {}) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`promotion code scope: lookup failed (${id}): ${errorText(error)}`);
    }
    const codeTenant = text(metadata["tenant_id"]);
    if (!codeTenant) {
      unscoped.push(id);
      continue;
    }
    if (codeTenant !== order.tenantId) {
      foreign.push(id);
      continue;
    }
    const couponId = text(metadata["coupon_id"]);
    if (couponId && !(await couponCovers(couponId, order))) outOfScope.push(id);
  }

  const hold =
    foreign.length > 0
      ? { reason: "foreign_promotion_code" as const, promotionCodeIds: foreign }
      : outOfScope.length > 0
        ? { reason: "promotion_code_out_of_scope" as const, promotionCodeIds: outOfScope }
        : null;
  if (hold) {
    console.error("[payments] promotion code outside order scope", order.id, hold);
  }
  return { hold, unscopedIds: unscoped };
}
