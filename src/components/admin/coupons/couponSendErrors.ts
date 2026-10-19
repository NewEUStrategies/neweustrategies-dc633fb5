// Tłumaczenie kodów błędów kampanii kuponowej (P04) na komunikaty panelu.
//
// DLACZEGO OSOBNY MODUŁ. Serwer kampanii (`newsletter-campaigns.functions.ts`)
// zwraca błąd jako KOD MASZYNOWY w `message` (`COUPON_CODES_INSUFFICIENT:120:80`,
// `COUPON_SEGMENT_INVALID`), bo tę samą wysyłkę odpala też tick bez UI. Edytor
// kampanii newslettera pokazywał go surowo w toaście - operator widział
// „COUPON_SEGMENT_INVALID" zamiast informacji, że kody NIE poszły do całej
// listy i dlaczego. Liść bez importów runtime (poza typem `TFunction`), żeby
// test sprawdzał tłumaczenie bez atrap serwera.
//
// KODY = kontrakt z `COUPON_SEND_ERRORS` serwera. Stoją tu literałem (import
// wciągałby moduł funkcji serwerowych do testu liścia); zgodność pilnuje test
// kontraktu w `__tests__/couponSendErrors.test.ts`, który porównuje oba zbiory.
import type { TFunction } from "i18next";

export const COUPON_SEND_ERROR_CODES = {
  segmentInvalid: "COUPON_SEGMENT_INVALID",
  codesInsufficient: "COUPON_CODES_INSUFFICIENT",
  notLinked: "COUPON_CAMPAIGN_NOT_LINKED",
  ambiguous: "COUPON_CAMPAIGN_AMBIGUOUS",
  missingTag: "COUPON_TAG_MISSING",
} as const;

/** `COUPON_CODES_INSUFFICIENT:<potrzeba>:<dostępne>` - liczby z porcji wysyłki. */
const CODES_INSUFFICIENT = /^COUPON_CODES_INSUFFICIENT:(\d+):(\d+)$/;

/**
 * Komunikat dla błędu wysyłki kampanii kuponowej albo `null`, gdy błąd nie
 * pochodzi z trybu kuponowego (wtedy ekran pokazuje go po staremu).
 */
export function couponSendErrorMessage(message: string, t: TFunction): string | null {
  const codes = CODES_INSUFFICIENT.exec(message.trim());
  if (codes) {
    return t("adminCoupons.newsletterCampaign.errors.codesInsufficient", {
      needed: Number(codes[1]),
      available: Number(codes[2]),
    });
  }
  switch (message.trim()) {
    case COUPON_SEND_ERROR_CODES.segmentInvalid:
      return t("adminCoupons.newsletterCampaign.errors.segmentInvalid");
    case COUPON_SEND_ERROR_CODES.notLinked:
      return t("adminCoupons.newsletterCampaign.errors.notLinked");
    case COUPON_SEND_ERROR_CODES.ambiguous:
      return t("adminCoupons.newsletterCampaign.errors.ambiguous");
    case COUPON_SEND_ERROR_CODES.missingTag:
      return t("adminCoupons.newsletterCampaign.errors.missingTag");
    default:
      return null;
  }
}

/**
 * Komunikat dla błędu „Przygotuj wysyłkę" (`createCouponNewsletterCampaign`)
 * albo `null` dla błędu spoza kontraktu (ekran pokazuje wtedy jego treść).
 */
export function prepareSendErrorMessage(message: string, t: TFunction): string | null {
  switch (message.trim()) {
    case "coupon_campaign_not_generated":
      return t("adminCoupons.campaignsFlow.notGenerated");
    case "campaign_not_found":
      return t("adminCoupons.campaignsFlow.notFound");
    case COUPON_SEND_ERROR_CODES.segmentInvalid:
      return t("adminCoupons.campaignsFlow.segmentInvalid");
    default:
      return null;
  }
}
