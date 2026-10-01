// Podgląd kuponu planu - logika server-only dla `couponPreview.functions.ts`.
//
// KOLEJNOŚĆ ŚCIAN:
//   1. limit prób (`allowCodeProbe`): kubełek IP, potem kubełek konta -
//      FAIL-CLOSED, odmowa PRZED bazą;
//   2. `validate_b2b_coupon` klientem z JWT kupującego (baza dokłada własny
//      kubełek pudeł na konto - `_coupon_probe_guard`);
//   3. wynik oczyszczony: bez coupon_id i nazwy kodu NAWET przy sukcesie.
//
// ODMOWA LIMITU I AWARIA TO NIE ORZECZENIE O KODZIE. Obie wracają jako własne
// powody (`rate_limited`, `technical_error`), a kwota zostaje nietknięta -
// „nie ma takiego kodu" powiedziane w czasie blokady albo awarii to nieprawda
// o ważnym kuponie. Powód, którego ekran nie zna (np. `event_not_eligible`
// z bazy sprzed 20261001100000), mówi to samo co pudło. Kod nie trafia do logów.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";
import {
  COUPON_ERROR_I18N_KEY,
  isCodeProbeRateLimited,
  normalizeCouponCode,
  parseCouponVerdict,
  type ValidateCouponResult,
} from "@/lib/billing/coupons";
import { allowCodeProbe } from "@/lib/events/codeProbeLimit.server";

type CouponError = NonNullable<ValidateCouponResult["error"]>;

export interface PlanCouponPreviewInput {
  code: string;
  planId: string | null;
  amountCents: number;
  currency: string;
}

/** Typy Supabase widzą `_plan_id` jako niepusty; RPC traktuje zerowy UUID jak dotąd. */
const NO_PLAN = "00000000-0000-0000-0000-000000000000";

function refusal(error: CouponError, amountCents: number): ValidateCouponResult {
  return {
    ok: false,
    error,
    coupon_id: null,
    discount_cents: 0,
    final_cents: amountCents,
    label: null,
    discount_kind: null,
    discount_percent: null,
  };
}

function isCouponError(raw: string): raw is CouponError {
  return Object.hasOwn(COUPON_ERROR_I18N_KEY, raw);
}

function knownError(raw: string | null): CouponError {
  return raw !== null && isCouponError(raw) ? raw : "not_found";
}

function requestHeaders(): Headers | null {
  try {
    return getRequest().headers;
  } catch {
    return null;
  }
}

export async function previewPlanCouponForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: PlanCouponPreviewInput,
): Promise<ValidateCouponResult | null> {
  // Kwota, której nie da się zrabatować, to ta sama odpowiedź, którą dawało RPC
  // - bez pytania bazy i bez próby z limitu (kod nie jest tu w ogóle oceniany).
  if (input.amountCents <= 0) {
    return refusal("invalid_amount", Math.max(input.amountCents, 0));
  }
  const allowed = await allowCodeProbe(requestHeaders(), async () => userId);
  if (!allowed) return refusal("rate_limited", input.amountCents);

  const { data, error } = await supabase.rpc("validate_b2b_coupon", {
    _code: normalizeCouponCode(input.code),
    _plan_id: input.planId ?? NO_PLAN,
    _amount_cents: input.amountCents,
    _currency: input.currency,
  });
  if (error) {
    return refusal(
      isCodeProbeRateLimited(error) ? "rate_limited" : "technical_error",
      input.amountCents,
    );
  }
  const row = parseCouponVerdict(data);
  if (!row) return null;
  if (!row.ok) return refusal(knownError(row.error), input.amountCents);
  return {
    ok: true,
    error: null,
    coupon_id: null,
    discount_cents: row.discount_cents,
    final_cents: row.final_cents,
    label: null,
    discount_kind: row.discount_kind === "fixed" ? "fixed" : "percent",
    discount_percent: row.discount_percent,
  };
}
