// Live-walidacja kuponu B2B po stronie klienta - RPC validate_b2b_coupon jest
// GRANTED do authenticated/anon i stable (bez skutków ubocznych). Serwer i tak
// waliduje ponownie w createCheckoutOrder oraz atomowo rezerwuje przy checkout.
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ValidateCouponResult } from "@/lib/billing/coupons";
import { normalizeCouponCode } from "@/lib/billing/coupons";

interface UseValidateCouponArgs {
  planId: string | null;
  amountCents: number;
  currency: string;
}

interface UseValidateCouponReturn {
  result: ValidateCouponResult | null;
  loading: boolean;
  validate: (code: string) => Promise<ValidateCouponResult | null>;
  reset: () => void;
}

export function useValidateCoupon({
  planId,
  amountCents,
  currency,
}: UseValidateCouponArgs): UseValidateCouponReturn {
  const [result, setResult] = useState<ValidateCouponResult | null>(null);
  const [loading, setLoading] = useState(false);

  const validate = useCallback(
    async (code: string): Promise<ValidateCouponResult | null> => {
      const normalized = normalizeCouponCode(code);
      if (!normalized) {
        const empty: ValidateCouponResult = {
          ok: false,
          error: "empty_code",
          coupon_id: null,
          discount_cents: 0,
          final_cents: amountCents,
          label: null,
          discount_kind: null,
          discount_percent: null,
        };
        setResult(empty);
        return empty;
      }
      setLoading(true);
      try {
        // Typy Supabase widzą _plan_id jako non-nullable; RPC ma OK z NULL,
        // dlatego przekazujemy pusty string dla braku planu jak dla planu.
        const args = {
          _code: normalized,
          _plan_id: planId ?? "00000000-0000-0000-0000-000000000000",
          _amount_cents: amountCents,
          _currency: currency,
        };
        const { data, error } = await supabase.rpc("validate_b2b_coupon", args);
        if (error) throw error;
        const row = ((data ?? []) as ValidateCouponResult[])[0] ?? null;
        setResult(row);
        return row;
      } catch {
        const fail: ValidateCouponResult = {
          ok: false,
          error: "not_found",
          coupon_id: null,
          discount_cents: 0,
          final_cents: amountCents,
          label: null,
          discount_kind: null,
          discount_percent: null,
        };
        setResult(fail);
        return fail;
      } finally {
        setLoading(false);
      }
    },
    [planId, amountCents, currency],
  );

  const reset = useCallback(() => setResult(null), []);
  return { result, loading, validate, reset };
}
