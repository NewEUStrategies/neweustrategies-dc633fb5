// Live-walidacja kuponu B2B na stronie kasy planu.
//
// PRZEZ SERWER, NIE RPC Z PRZEGLĄDARKI. Odpowiedź walidacji mówi, czy kod
// istnieje, więc stoi za limitem prób (IP + konto) w funkcji serwerowej
// `previewPlanCoupon`; `validate_b2b_coupon` nie jest już wykonywalny dla anon
// (migracja 20261001100000). Wynik jest podglądem - serwer i tak waliduje
// ponownie w `createPlanCheckoutSession` i atomowo rezerwuje użycie przy kasie.
import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { previewPlanCoupon } from "@/lib/billing/couponPreview.functions";
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
  const preview = useServerFn(previewPlanCoupon);

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
      // Dłuższego kodu nie przyjmie ani podgląd, ani kasa (`max(64)`), więc
      // takiego kuponu w praktyce nie ma - mówimy to bez sieci i bez próby z limitu.
      if (normalized.length > 64) {
        const missing: ValidateCouponResult = {
          ok: false,
          error: "not_found",
          coupon_id: null,
          discount_cents: 0,
          final_cents: amountCents,
          label: null,
          discount_kind: null,
          discount_percent: null,
        };
        setResult(missing);
        return missing;
      }
      setLoading(true);
      try {
        // Brak planu idzie jako `null`; serwer zamienia go na zerowy UUID,
        // jak dotąd robiła przeglądarka.
        const row = await preview({
          data: { code: normalized, planId, amountCents, currency },
        });
        setResult(row);
        return row;
      } catch {
        // AWARIA NIE JEST ORZECZENIEM O KUPONIE. Zerwane połączenie, odmowa
        // uprawnień i błąd serwera trafiają tu razem - ale tylko odpowiedź
        // serwera mówi, czy kod istnieje. Wcześniej `catch` mapował KAŻDY
        // wyjątek na `not_found`, więc klient z ważnym kuponem, który trafił
        // na sekundę awarii, dostawał nieprawdziwą informację o pieniądzach
        // i płacił pełną cenę. Kwota końcowa zostaje NIETKNIĘTA (awaria nie ma
        // prawa obniżyć ceny), a autorytetem rabatu i tak jest serwer.
        const failure: ValidateCouponResult = {
          ok: false,
          error: "technical_error",
          coupon_id: null,
          discount_cents: 0,
          final_cents: amountCents,
          label: null,
          discount_kind: null,
          discount_percent: null,
        };
        setResult(failure);
        return failure;
      } finally {
        setLoading(false);
      }
    },
    [preview, planId, amountCents, currency],
  );

  const reset = useCallback(() => setResult(null), []);
  return { result, loading, validate, reset };
}
