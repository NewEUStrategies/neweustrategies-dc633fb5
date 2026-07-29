// Kody promocyjne w nakładce płatności (etap 4).
//
// Źródłem prawdy o kuponach pozostaje baza (`b2b_coupons` + RPC
// `validate_b2b_coupon`) - dostawca płatności musi jedynie znać odpowiadający
// mu rabat, żeby overlay pokazał poprawną kwotę i żeby faktura się zgadzała.
//
// Dlatego mapowanie jest leniwe i samonaprawiające: szukamy rabatu po kodzie,
// a gdy go nie ma - tworzymy go z definicji kuponu z bazy. Kod jest tu kluczem
// naturalnym, więc powtórne wywołania nie tworzą duplikatów.
//
// Moduł server-only - importuj wyłącznie z handlera serwerowego.
import type { PaddleEnv } from "@/lib/paddle.server";

export interface PaddleDiscountResolution {
  readonly ok: boolean;
  /** Identyfikator rabatu u dostawcy (do przekazania do overlaya). */
  readonly discountId: string | null;
  /** Kod błędu walidacji kuponu (spójny z `validate_b2b_coupon`). */
  readonly error: string | null;
  /** Rabat w groszach - do podglądu w podsumowaniu zamówienia. */
  readonly discountCents: number;
}

export interface CouponDefinition {
  discount_kind: "percent" | "fixed";
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string | null;
  valid_until: string | null;
  max_redemptions: number | null;
}

const fail = (error: string): PaddleDiscountResolution => ({
  ok: false,
  discountId: null,
  error,
  discountCents: 0,
});

export async function findDiscountByCode(env: PaddleEnv, code: string): Promise<string | null> {
  const { gatewayFetch } = await import("@/lib/paddle.server");
  const res = await gatewayFetch(env, `/discounts?code=${encodeURIComponent(code)}&status=active`);
  if (!res.ok) {
    console.error("[payments] discount lookup failed", res.status, await res.text());
    return null;
  }
  const body = (await res.json()) as { data?: Array<{ id: string; code?: string }> };
  const match = body.data?.find((d) => (d.code ?? "").toUpperCase() === code);
  return match?.id ?? null;
}

export async function createDiscount(
  env: PaddleEnv,
  code: string,
  def: CouponDefinition,
): Promise<string | null> {
  const { gatewayFetch } = await import("@/lib/paddle.server");
  const isPercent = def.discount_kind === "percent";
  const payload: Record<string, unknown> = {
    description: `NES coupon ${code}`,
    type: isPercent ? "percentage" : "flat",
    amount: isPercent
      ? String(def.discount_percent ?? 0)
      : String(Math.max(0, def.discount_cents ?? 0)),
    enabled_for_checkout: true,
    code,
    recur: false,
    ...(isPercent ? {} : { currency_code: (def.currency ?? "PLN").toUpperCase() }),
    ...(def.valid_until ? { expires_at: new Date(def.valid_until).toISOString() } : {}),
    ...(def.max_redemptions ? { usage_limit: def.max_redemptions } : {}),
    custom_data: { source: "nes_b2b_coupons" },
  };
  const res = await gatewayFetch(env, "/discounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("[payments] discount create failed", res.status, await res.text());
    return null;
  }
  const body = (await res.json()) as { data?: { id?: string } };
  return body.data?.id ?? null;
}

/**
 * Waliduje kupon w bazie i zwraca odpowiadający mu rabat u dostawcy.
 * Zwraca `ok:false` z kodem błędu, gdy kupon jest nieaktywny / wyczerpany /
 * nie obejmuje planu - overlay nie zostaje wtedy otwarty z rabatem.
 */
export async function resolveDiscountForCoupon(params: {
  environment: PaddleEnv;
  code: string;
  planId: string;
  amountCents: number;
  currency: string;
}): Promise<PaddleDiscountResolution> {
  const code = params.code.trim().toUpperCase();
  if (!code) return fail("empty_code");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error } = await supabaseAdmin.rpc("validate_b2b_coupon", {
    _code: code,
    _plan_id: params.planId,
    _amount_cents: params.amountCents,
    _currency: params.currency,
  });
  if (error) {
    console.error("[payments] coupon validation failed", error.message);
    return fail("not_found");
  }
  const row = (rows ?? [])[0];
  if (!row || !row.ok) return fail(String(row?.error ?? "not_found"));

  const { data: coupon } = await supabaseAdmin
    .from("b2b_coupons")
    .select("discount_kind, discount_percent, discount_cents, currency, valid_until, max_redemptions")
    .eq("id", row.coupon_id)
    .maybeSingle();
  if (!coupon) return fail("not_found");

  const existing = await findDiscountByCode(params.environment, code);
  const discountId =
    existing ?? (await createDiscount(params.environment, code, coupon as CouponDefinition));
  if (!discountId) return fail("provider_unavailable");

  return { ok: true, discountId, error: null, discountCents: row.discount_cents ?? 0 };
}
