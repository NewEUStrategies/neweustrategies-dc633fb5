// Reguła blokady wysyłki kampanii KUPONOWEJ w edytorze kampanii newslettera
// (P04, R-25). Liść bez importów: czyta ją panel kampanii kuponowej
// (`NewsletterCouponPanel`) i trasa edytora, która wyłącza przycisk wysyłki -
// jedna reguła, więc panel i przycisk nigdy nie mówią co innego.

/** Kampania kuponowa z `getCampaign().coupon` (kontrakt PLAN S1 §4.8). */
export interface NewsletterCouponInfo {
  couponCampaignId: string;
  name: string;
  /** Kody aktywne, jeszcze nieprzypisane odbiorcy. */
  codesAvailable: number;
  codesTotal: number;
  status: string;
}

/**
 * Powód blokady wysyłki kampanii kuponowej albo `null`:
 *   - `counting` - liczba odbiorców jeszcze nieznana (R-25: wysyłka dopiero,
 *     gdy operator widzi, do ilu osób pójdą kody),
 *   - `short` - wolnych kodów mniej niż odbiorców.
 * Kampania, która już coś wysłała (wznowienie po awarii), część kodów ma
 * przypisaną odbiorcom - porównanie „wolne < wszyscy odbiorcy" fałszywie by ją
 * blokowało; wtedy decyduje serwer (liczy wolne + przypisane w porcji).
 */
export function couponSendBlock(args: {
  coupon: NewsletterCouponInfo | null;
  recipients: number | undefined;
  sentCount: number;
}): "counting" | "short" | null {
  if (!args.coupon || args.sentCount > 0) return null;
  if (args.recipients === undefined) return "counting";
  return args.coupon.codesAvailable < args.recipients ? "short" : null;
}
