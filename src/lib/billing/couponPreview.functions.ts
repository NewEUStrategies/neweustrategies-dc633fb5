// Podgląd kuponu planu na stronie kasy (`CouponInput` -> `useValidateCoupon`).
//
// DLACZEGO FUNKCJA SERWEROWA, A NIE RPC Z PRZEGLĄDARKI. Odpowiedź walidacji
// mówi, czy kod istnieje - bez limitu prób to wyrocznia do zgadywania kodów.
// Limit po IP zna wyłącznie serwer, a `validate_b2b_coupon` od migracji
// 20261001100000 nie jest już wykonywalny dla anon. Serwer woła RPC klientem
// z JWT kupującego (ten sam najemca i ten sam limit na osobę co
// `createPlanCheckoutSession`), a do przeglądarki oddaje wynik BEZ coupon_id
// i nazwy kodu - ekran ich nie czyta, a coupon_id nie ma czego szukać poza
// serwerem.
//
// Strona kasy stoi za `GuestCheckoutGate`, więc wołający zawsze ma sesję.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split). Logika: `couponPreview.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  /** Kod w bazie ma najwyżej 64 znaki - dłuższy nie ma czego szukać. */
  code: z.string().trim().min(1).max(64),
  planId: z.string().uuid().nullable(),
  /** Kwota <= 0 przechodzi - odpowiedź `invalid_amount` składa serwer, jak dawniej RPC. */
  amountCents: z.number().int(),
  currency: z.string().trim().length(3),
});

export const previewPlanCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { previewPlanCouponForUser } = await import("@/lib/billing/couponPreview.server");
    return previewPlanCouponForUser(context.supabase, context.userId, data);
  });
