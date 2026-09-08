/**
 * Oferty bez publicznej ceny i bez samoobsługowego checkoutu.
 *
 * Decision Lab wycenia się indywidualnie (zakres cyklu, liczba miejsc,
 * zobowiązania raportowe), więc karta i strona planu nie mogą ujawniać kwoty -
 * jedyną ścieżką jest formularz zgłoszeniowy (Contact Center).
 */
const ENQUIRY_TIER_KEYS = new Set<string>(["decision_lab"]);

export function isEnquiryOnlyPlan(plan: { tier_key?: string | null } | null | undefined): boolean {
  if (!plan) return false;
  return ENQUIRY_TIER_KEYS.has(plan.tier_key ?? "");
}
