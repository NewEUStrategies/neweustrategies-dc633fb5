import { formatMoney } from "@/lib/billing/types";

/** Plan prices retain their billing currency; language only changes formatting. */
export function planDisplayCurrency(currency: string): string {
  return currency.toUpperCase();
}

export function formatPlanMoney(cents: number, currency: string, lang: string): string {
  return formatMoney(cents, planDisplayCurrency(currency), lang);
}
